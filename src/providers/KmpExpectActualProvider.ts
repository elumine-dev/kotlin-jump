import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';

// `/androidMain/`, `/iosMain/`, `/jsMain/`… anywhere in the path.
const SOURCE_SET_RE = /\/([a-zA-Z][a-zA-Z0-9]*)Main\//;

/** Target of a file's source set, or null (commonMain and non-KMP paths). */
export function targetOf(uriString: string): string | null {
  const m = SOURCE_SET_RE.exec(uriString);
  if (!m || m[1] === 'common') return null;
  return m[1];
}

/**
 * All platform targets observed in the indexed project, derived from the
 * source set directories instead of parsing build.gradle.kts: a target the
 * build declares but no file uses cannot host an `actual` anyway.
 */
export function collectProjectTargets(uriStrings: Iterable<string>): Set<string> {
  const targets = new Set<string>();
  for (const uri of uriStrings) {
    const t = targetOf(uri);
    if (t) targets.add(t);
  }
  return targets;
}

/** Coverage row for one expect declaration: `[android ✓] [ios ✓] [js ✗]`. */
export function coverageLabel(covered: Set<string>, expected: Set<string>): string {
  return [...expected].sort()
    .map(t => `[${t} ${covered.has(t) ? '✓' : '✗'}]`)
    .join(' ');
}

/**
 * Target coverage badges on `expect` declarations in KMP projects:
 *
 *   expect fun platformName(): String     [android ✓] [ios ✓] [js ✗]
 *
 * Expected targets come from the source sets present in the index, covered
 * targets from the `actual` declarations sharing the expect's FQN. Click
 * opens the actual (QuickPick when several targets implement it). Non-KMP
 * projects have no `*Main` source sets, so no lenses appear at all.
 * Toggle with `kotlinJump.kmpTargetBadges`.
 */
export class KmpExpectActualProvider implements vscode.CodeLensProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('kmpTargetBadges', true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const symbols = this.index.getFileSymbols(document.uri.toString())
      .filter(s => s.isExpect);
    if (symbols.length === 0) return [];

    const expected = collectProjectTargets(this.index.fileUriStrings());
    if (expected.size === 0) return [];

    const lenses: vscode.CodeLens[] = [];
    for (const entry of symbols) {
      const actuals = this.index.lookup(entry.name)
        .filter(e => e.isActual && e.fqn === entry.fqn);
      const covered = new Set<string>();
      for (const a of actuals) {
        const t = targetOf(a.uri.toString());
        if (t) covered.add(t);
      }
      lenses.push(new vscode.CodeLens(
        new vscode.Range(entry.line, 0, entry.line, 0),
        {
          title: coverageLabel(covered, expected),
          command: 'kotlin-jump.showActuals',
          arguments: [entry.fqn, entry.name],
        },
      ));
    }
    return lenses;
  }
}

/** Command handler: jump to the actual, or pick one when several exist. */
export async function showActuals(index: SymbolIndex, fqn: string, name: string): Promise<void> {
  const actuals = index.lookup(name).filter(e => e.isActual && e.fqn === fqn);
  if (actuals.length === 0) {
    vscode.window.showInformationMessage(`Kotlin Jump: no actual found for ${name}`);
    return;
  }

  const open = async (entry: SymbolEntry) => {
    const doc = await vscode.workspace.openTextDocument(entry.uri);
    const pos = new vscode.Position(entry.line, entry.character);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
  };

  if (actuals.length === 1) { await open(actuals[0]); return; }

  const picked = await vscode.window.showQuickPick(
    actuals.map(a => ({
      label: targetOf(a.uri.toString()) ?? 'unknown',
      description: a.uri.toString().split('/').pop(),
      entry: a,
    })),
    { placeHolder: `actual ${name} — pick a target` },
  );
  if (picked) await open(picked.entry);
}
