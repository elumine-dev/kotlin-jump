import * as vscode from 'vscode';
import { isInsideCommentOrString, countTripleQuotes } from '../util/textUtils';
import { moveDecorationsToLine, shiftLineState } from '../util/decorationShift';

export class NullAssertionProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private _editor:     vscode.TextEditor | undefined;
  private _lineDecos = new Map<number, vscode.DecorationOptions[]>();
  private _rawState:  boolean[] = [];
  private _blockState: boolean[] = [];
  /** Par ligne, l etat AVANT la frappe : une frontiere supprimee ne se lit
   *  plus nulle part apres coup, l evenement ne portant pas le texte retire. */
  private _boundary: boolean[] = [];
  private _flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._decorType = vscode.window.createTextEditorDecorationType({
      light: { color: '#B45309', fontWeight: 'bold' },  // amber-700, readable on white
      dark:  { color: '#FCD34D', fontWeight: 'bold' },  // amber-300, readable on dark backgrounds
    });

    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        this._editor = e;
        if (e) this._fullScan(e);
        else { this._lineDecos.clear(); this._rawState = []; this._blockState = []; this._boundary = []; }
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (this._editor && e.document === this._editor.document)
          this._applyChanges(e);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.nullAssertionHighlight'))
          this.invalidateAll();
      }),
    ];

    this.invalidateAll();
  }

  invalidateAll(): void {
    // The active editor is scanned LAST so _lineDecos describes the editor
    // the next keystroke repaints (same fix as HexColorFoldingProvider).
    const active = vscode.window.activeTextEditor;
    const others = vscode.window.visibleTextEditors.filter(e => e !== active);
    for (const editor of [...others, ...(active ? [active] : [])]) {
      this._editor = editor;
      this._fullScan(editor);
    }
    this._editor = active;
  }

  // ── Layer 1: raw-string oracle ─────────────────────────────────────────────
  private _buildRawState(doc: vscode.TextDocument): void {
    this._rawState = new Array(doc.lineCount).fill(false);
    // Meme oracle pour les blocs de commentaire : la garde par ligne ne voit
    // pas un `/*` ouvert plus haut, donc la prose d un KDoc recevait la
    // decoration d assertion. Mesure sur un vrai projet : 2 occurrences,
    // « NB: this implementation is temporary!! » et un marqueur « |!!| ».
    this._blockState = new Array(doc.lineCount).fill(false);
    this._boundary = new Array(doc.lineCount).fill(false);
    let inRaw = false;
    let inBlock = false;
    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      this._rawState[i] = inRaw;
      this._blockState[i] = inBlock;
      this._boundary[i] = deplaceUneFrontiere(text);
      if (inRaw) {
        if (countTripleQuotes(text) % 2 !== 0) inRaw = false;
        continue;
      }
      if (inBlock) {
        const fin = text.indexOf('*' + '/');
        if (fin < 0) continue;
        inBlock = false;
        inBlock = blocOuvertApres(text.slice(fin + 2));
        continue;
      }
      if (countTripleQuotes(text) % 2 !== 0) { inRaw = true; continue; }
      inBlock = blocOuvertApres(text);
    }
  }

  // ── Layer 2: per-line rescan ───────────────────────────────────────────────
  private _rescanLine(lineNum: number, text: string): void {
    if (this._rawState[lineNum]) { this._lineDecos.delete(lineNum); return; }
    // Ligne commencee DANS un bloc : on masque jusqu a sa fermeture, en
    // gardant la longueur, pour que le code qui suit `*/` sur la meme
    // ligne garde ses colonnes et reste scanne.
    let scan = text;
    if (this._blockState[lineNum]) {
      const fin = text.indexOf('*' + '/');
      if (fin < 0) { this._lineDecos.delete(lineNum); return; }
      scan = ' '.repeat(fin + 2) + text.slice(fin + 2);
    }
    const decos: vscode.DecorationOptions[] = [];
    let idx = 0;
    while ((idx = scan.indexOf('!!', idx)) !== -1) {
      if (!isInsideCommentOrString(scan, idx))
        decos.push({ range: new vscode.Range(lineNum, idx, lineNum, idx + 2) });
      idx += 2;
    }
    decos.length ? this._lineDecos.set(lineNum, decos) : this._lineDecos.delete(lineNum);
  }

  // ── Line-index shift after Enter / Backspace ───────────────────────────────
  private _shiftDecos(fromLine: number, delta: number): void {
    const next = new Map<number, vscode.DecorationOptions[]>();
    for (const [line, decos] of this._lineDecos) {
      if (line < fromLine)               next.set(line, decos);
      else if (line + delta >= fromLine) next.set(line + delta, decos);
      // else: line deleted — drop
    }
    this._lineDecos = next;
  }

  /** Les oracles par ligne suivent le meme deplacement que les decorations. */
  private _shiftStates(fromLine: number, delta: number): void {
    this._rawState   = shiftLineState(this._rawState,   fromLine, delta);
    this._blockState = shiftLineState(this._blockState, fromLine, delta);
    this._boundary   = shiftLineState(this._boundary,   fromLine, delta);
  }

  // ── Layer 3: 16ms render throttle ─────────────────────────────────────────
  private _scheduleFlush(): void {
    if (this._flushTimer !== undefined) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = undefined;
      if (this._editor) this._flush(this._editor);
    }, 16);
  }

  private _flush(editor: vscode.TextEditor): void {
    const all: vscode.DecorationOptions[] = [];
    for (const k of [...this._lineDecos.keys()].sort((a, b) => a - b)) {
      // La cle n est que de la comptabilite : ce que VS Code peint, c est le
      // Range porte par chaque option. Reindexer seul laissait chaque
      // decoration sous le curseur dessinee une ligne trop haut.
      const decos = moveDecorationsToLine(this._lineDecos.get(k)!, k);
      this._lineDecos.set(k, decos);
      all.push(...decos);
    }
    editor.setDecorations(this._decorType, all);
  }

  // ── Incremental orchestrator (per keystroke) ───────────────────────────────
  private _applyChanges(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document;
    // A keystroke used to bring the highlight back with the setting off, and
    // to paint `!!` in a Java file (a boolean double negation there).
    if (doc.languageId !== 'kotlin') return;
    if (!vscode.workspace.getConfiguration('kotlinJump').get<boolean>('nullAssertionHighlight', true)) return;

    // Sort bottom→top so line-number shifts don't cascade
    const sorted = [...e.contentChanges].sort(
      (a, b) => b.range.start.line - a.range.start.line,
    );

    // A multi-line boundary moved: everything below it changes meaning, so the
    // incremental path cannot be trusted. Raw strings were covered from the
    // start; the comment-block oracle added later needs the same trigger, or
    // typing `/*` above a highlighted `!!` leaves the highlight standing on
    // code that has just become documentation.
    let needsFullRebuild = false;
    for (const change of sorted) {
      if (deplaceUneFrontiere(change.text)) { needsFullRebuild = true; break; }
      // Le plafond ne vaut que pour `lineAt`, qui lit le NOUVEAU document. La
      // memoire des lignes d avant, elle, se lit jusqu au bout de l ancienne
      // plage : sinon effacer trois lignes pres de la fin du fichier raccourcit
      // le document sous `end.line` et la frontiere supprimee sort du balayage.
      const dernierLu = Math.min(change.range.end.line, doc.lineCount - 1);
      for (let i = change.range.start.line; i <= change.range.end.line; i++) {
        if (this._boundary[i] || (i <= dernierLu && deplaceUneFrontiere(doc.lineAt(i).text))) {
          needsFullRebuild = true;
          break;
        }
      }
      if (needsFullRebuild) break;
    }

    if (needsFullRebuild) {
      // Raw-string boundaries changed — full rescan (happens rarely, e.g. on """ typing)
      this._lineDecos.clear();
      this._buildRawState(doc);
      for (let i = 0; i < doc.lineCount; i++)
        this._rescanLine(i, doc.lineAt(i).text);
      this._scheduleFlush();
      return;
    }

    // Normal incremental path (no """ involved)
    for (const change of sorted) {
      const addedLines   = (change.text.match(/\n/g) ?? []).length;
      const removedLines = change.range.end.line - change.range.start.line;
      const delta        = addedLines - removedLines;
      if (delta !== 0) {
        this._shiftDecos(change.range.start.line + 1, delta);
        this._shiftStates(change.range.start.line + 1, delta);
      }

      const endLine = change.range.start.line + addedLines;
      // `_boundary` n est pas recalcule ici : on n arrive sur ce chemin que si
      // aucune des lignes touchees ne porte de marqueur, et les lignes nees de
      // la frappe heritent deja de la ligne coupee.
      for (let i = change.range.start.line; i <= endLine && i < doc.lineCount; i++)
        this._rescanLine(i, doc.lineAt(i).text);
    }

    this._scheduleFlush();
  }

  // ── Full scan (on file open / editor switch) ───────────────────────────────
  private _fullScan(editor: vscode.TextEditor): void {
    const lang = editor.document.languageId;
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('nullAssertionHighlight', true);
    // Kotlin only — `!!` does not exist as a null-assertion in Java; in Java
    // it is just a boolean double-negation. Highlighting it with the same
    // amber NPE-warning paint mis-leads Java readers into thinking they're
    // looking at unsafe code when they aren't.
    if (lang !== 'kotlin' || !enabled) {
      this._lineDecos.clear();
      editor.setDecorations(this._decorType, []);
      return;
    }
    this._lineDecos.clear();
    this._buildRawState(editor.document);
    for (let i = 0; i < editor.document.lineCount; i++)
      this._rescanLine(i, editor.document.lineAt(i).text);
    this._flush(editor); // immediate — no throttle on open
  }

  dispose(): void {
    clearTimeout(this._flushTimer);
    this._lineDecos.clear();
    this._decorType.dispose();
    for (const s of this._subs) s.dispose();
  }
}

/**
 * Un `/*` reste-t-il ouvert a la fin de cette ligne ?
 *
 * Les chaines et le commentaire de ligne masquent leurs `/*`, sinon un
 * `val s = "/*"` ouvrirait un bloc qui n existe pas.
 */
function blocOuvertApres(ligne: string): boolean {
  let ouvert = false;
  let dansChaine = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (dansChaine) {
      if (c === '\\') { i++; continue; }
      if (c === '"') dansChaine = false;
      continue;
    }
    if (ouvert) {
      if (c === '*' && ligne[i + 1] === '/') { ouvert = false; i++; }
      continue;
    }
    if (c === '"') { dansChaine = true; continue; }
    if (c === '/' && ligne[i + 1] === '/') return false;
    if (c === '/' && ligne[i + 1] === '*') { ouvert = true; i++; }
  }
  return ouvert;
}

/** Un texte qui peut ouvrir ou fermer une portee multiligne suivie par les oracles. */
function deplaceUneFrontiere(texte: string): boolean {
  return texte.includes('"""') || texte.includes('/' + '*') || texte.includes('*' + '/');
}
