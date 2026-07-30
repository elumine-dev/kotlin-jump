import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';
import { stripKotlinComments, stripXmlComments } from '../util/xmlRefs';
import { UnusedResourceKeyProvider } from './UnusedResourceKeyProvider';

// Re-exported: KJ-024 and the KJ-021 suites import them from here.
export { stripKotlinComments, stripXmlComments };

/**
 * KJ-021: usage badges in res XML. Every entry of strings.xml /
 * colors.xml / dimens.xml shows its usage count as ghost text;
 * "0 usages" = grayed line. Counted: R.<kind>.name (Kotlin/Java) and
 * @<kind>/name (res XML), EXCEPT tools: attributes and comments.
 */

export type ResKind = 'string' | 'color' | 'dimen';

export interface UsageSource {
  path: string;
  text: string;
}

export function countResourceUsages(
  kind: ResKind,
  name: string,
  sources: UsageSource[],
): number {
  let count = 0;

  for (const src of sources) {
    if (/\.(kt|kts|java)$/.test(src.path)) {
      const code = stripKotlinComments(src.text);
      const re = new RegExp(`\\bR\\.${kind}\\.${name}\\b`, 'g');
      count += (code.match(re) ?? []).length;
      continue;
    }
    if (/\.xml$/.test(src.path)) {
      const xml = stripXmlComments(src.text);
      // Attributes: prefix:attr="@kind/name", tools: excluded.
      const attrRe = /([A-Za-z_][\w]*)(?::([A-Za-z_][\w.]*))?\s*=\s*"([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(xml)) !== null) {
        const nsPrefix = m[2] !== undefined ? m[1] : undefined;
        if (nsPrefix === 'tools') continue;
        if (m[3] === `@${kind}/${name}`) count++;
      }
      // Element text: <item>@string/x</item>, <color name="brand">@color/x</color>
      const textRe = new RegExp(`>\\s*@${kind}/${name}\\s*<`, 'g');
      count += (xml.match(textRe) ?? []).length;
    }
  }
  return count;
}

/**
 * SINGLE pass over the sources for every entry at once. The per-entry
 * call was O(entries × files) with a regex compiled per pair; on a large
 * workspace the badge became the number 1 cost center.
 * Result keys: `${kind}/${name}`.
 */
export function countAllResourceUsages(
  names: { kind: ResKind; name: string }[],
  sources: UsageSource[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(`${n.kind}/${n.name}`, 0);
  const bump = (kind: string, name: string) => {
    const key = `${kind}/${name}`;
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  };

  const KT_RE = /\bR\.(string|color|dimen)\.(\w+)\b/g;
  const XML_TEXT_RE = />\s*@(string|color|dimen)\/(\w+)\s*</g;
  const XML_REF = /^@(string|color|dimen)\/(\w+)$/;
  const ATTR_RE = /([A-Za-z_][\w]*)(?::([A-Za-z_][\w.]*))?\s*=\s*"([^"]*)"/g;

  for (const src of sources) {
    if (/\.(kt|kts|java)$/.test(src.path)) {
      const code = stripKotlinComments(src.text);
      let m: RegExpExecArray | null;
      KT_RE.lastIndex = 0;
      while ((m = KT_RE.exec(code)) !== null) bump(m[1], m[2]);
      continue;
    }
    if (/\.xml$/.test(src.path)) {
      const xml = stripXmlComments(src.text);
      let m: RegExpExecArray | null;
      ATTR_RE.lastIndex = 0;
      while ((m = ATTR_RE.exec(xml)) !== null) {
        const nsPrefix = m[2] !== undefined ? m[1] : undefined;
        if (nsPrefix === 'tools') continue;
        const ref = XML_REF.exec(m[3]);
        if (ref) bump(ref[1], ref[2]);
      }
      XML_TEXT_RE.lastIndex = 0;
      while ((m = XML_TEXT_RE.exec(xml)) !== null) bump(m[1], m[2]);
    }
  }
  return counts;
}

const ENTRY_RE: Record<ResKind, RegExp> = {
  string: /<string\s+name="([^"]+)"/g,
  color: /<color\s+name="([^"]+)"/g,
  dimen: /<dimen\s+name="([^"]+)"/g,
};

const CACHE_MS = 20_000;

export class ResourceUsageBadgeProvider implements vscode.Disposable {
  private readonly _badge = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 2em',
      color: new vscode.ThemeColor('editorLineNumber.foreground'),
    },
  });
  private readonly _dead = vscode.window.createTextEditorDecorationType({ opacity: '0.45' });
  private readonly _subs: vscode.Disposable[];
  private _cache: { at: number; sources: UsageSource[] } | undefined;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => void this._refresh()),
      vscode.workspace.onDidSaveTextDocument(() => {
        this._cache = undefined;
        void this._refresh();
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.resourceUsageBadges')) void this._refresh();
      }),
    ];
    void this._refresh();
  }

  private async _sources(): Promise<UsageSource[]> {
    if (this._cache && Date.now() - this._cache.at < CACHE_MS) return this._cache.sources;
    const uris = await vscode.workspace.findFiles(
      '**/*.{kt,java,xml}', '**/{build,.gradle,node_modules}/**', 4000,
    );
    const sources: UsageSource[] = [];
    for (const uri of uris) {
      try {
        sources.push({
          path: uri.fsPath,
          text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        });
      } catch {
        continue;
      }
    }
    this._cache = { at: Date.now(), sources };
    return sources;
  }

  private async _refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const path = editor.document.uri.fsPath;
    if (!/[\\/]res[\\/]values[^\\/]*[\\/][^\\/]+\.xml$/.test(path)) return;

    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('resourceUsageBadges', true);
    if (!enabled) {
      editor.setDecorations(this._badge, []);
      editor.setDecorations(this._dead, []);
      return;
    }

    // Exclude the active file: the definition is not a usage.
    const sources = (await this._sources()).filter(s => s.path !== path);
    const text = editor.document.getText();
    const lines = text.split('\n');

    const badges: vscode.DecorationOptions[] = [];
    const dead: vscode.Range[] = [];

    // Collect the entries, then a SINGLE pass over the sources.
    const entries: { kind: ResKind; name: string; line: number }[] = [];
    for (const [kind, re] of Object.entries(ENTRY_RE) as [ResKind, RegExp][]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const line = (text.slice(0, m.index).match(/\n/g) ?? []).length;
        entries.push({ kind, name: m[1], line });
      }
    }
    const counts = countAllResourceUsages(entries, sources);

    for (const e of entries) {
      const n = counts.get(`${e.kind}/${e.name}`) ?? 0;
      badges.push({
        range: new vscode.Range(e.line, lines[e.line].length, e.line, lines[e.line].length),
        renderOptions: {
          after: { contentText: n === 0 ? '0 usages' : `${n} usage${n > 1 ? 's' : ''}` },
        },
      });
      if (n === 0 && !UnusedResourceKeyProvider.isEnabled()) {
        // KJ-031 grays through DiagnosticTag.Unnecessary, and two stacked
        // graying mechanisms read as a rendering bug. The count stays: it is
        // information, and "0 usages" without graying is the honest render for
        // a key KJ-031 refuses to call dead, like an SDK config key.
        dead.push(new vscode.Range(e.line, 0, e.line, lines[e.line].length));
      }
    }
    editor.setDecorations(this._badge, badges);
    reportDecorations('resourceUsageBadges', badges.length);
    editor.setDecorations(this._dead, dead);
  }

  dispose(): void {
    this._badge.dispose();
    this._dead.dispose();
    for (const s of this._subs) s.dispose();
  }
}
