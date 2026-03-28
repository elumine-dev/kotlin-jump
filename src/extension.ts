import * as vscode from 'vscode';
import { SymbolIndex } from './indexer/SymbolIndex';
import { FileScanner } from './indexer/FileScanner';
import { FileWatcher } from './watcher/FileWatcher';
import { KotlinDefinitionProvider } from './providers/DefinitionProvider';
import { KotlinDocumentSymbolProvider } from './providers/DocumentSymbolProvider';
import { KotlinHoverProvider } from './providers/HoverProvider';
import { KotlinReferenceProvider } from './providers/ReferenceProvider';
import { KotlinFileProvider } from './providers/FileProvider';
import { KotlinImplementationProvider } from './providers/ImplementationProvider';
import { FindUsagesPanel } from './providers/FindUsagesPanel';
import { Logger } from './util/logger';
import { resolveAll as resolveModules } from './gradle/ModuleResolver';
import { resolve as resolveImports } from './util/ImportResolver';
import * as IndexStore from './indexer/IndexStore';

const WORD_RE = /[A-Za-z_]\w*/;

// Module-level refs so deactivate() can save the snapshot
let _index:   SymbolIndex | undefined;
let _context: vscode.ExtensionContext | undefined;
let _stats:   Map<string, { mtime: number; size: number }> = new Map();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  _context = context;

  const log   = new Logger('Kotlin Nav');
  const index = new SymbolIndex();
  _index = index;

  // ── Register providers FIRST — Cmd+Click works even during indexing ───────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text    = '$(sync~spin) Kotlin Nav: indexing…';
  statusBar.tooltip = 'Kotlin Nav is building the symbol index';
  statusBar.show();

  const KT_JAVA = [{ language: 'kotlin' }, { language: 'java' }];

  // ── Find Usages panel (tree view in the bottom panel area) ───────────────
  const usagesPanel = new FindUsagesPanel(index);
  const usagesView  = vscode.window.createTreeView('kotlinNav.findUsages', {
    treeDataProvider: usagesPanel,
    showCollapseAll:  true,
  });
  usagesPanel.attachTreeView(usagesView);

  // Initialise context keys so the toolbar icons show the correct state on first load
  vscode.commands.executeCommand('setContext', 'kotlinNav.findUsages.showTests', true);
  vscode.commands.executeCommand('setContext', 'kotlinNav.findUsages.showPreviews', true);

  context.subscriptions.push(
    log,
    statusBar,
    usagesPanel,
    usagesView,
    vscode.languages.registerDefinitionProvider(KT_JAVA, new KotlinDefinitionProvider(index)),
    vscode.languages.registerDocumentSymbolProvider(KT_JAVA, new KotlinDocumentSymbolProvider(index)),
    vscode.languages.registerHoverProvider(KT_JAVA, new KotlinHoverProvider(index)),
    vscode.languages.registerReferenceProvider(KT_JAVA, new KotlinReferenceProvider(index)),
    vscode.languages.registerImplementationProvider(KT_JAVA, new KotlinImplementationProvider(index)),
    vscode.languages.registerWorkspaceSymbolProvider(new KotlinFileProvider(index)),

    vscode.commands.registerCommand('kotlin-nav.findUsages', async (args?: { excludeUri?: string; excludeLine?: number }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lang = editor.document.languageId;
      if (lang !== 'kotlin' && lang !== 'java') return;
      const smartNav = vscode.workspace.getConfiguration('kotlinNav').get<boolean>('smartNavigation', true);
      if (!smartNav && !args) {
        await vscode.commands.executeCommand('editor.action.goToReferences');
        return;
      }
      // Reveal the panel immediately so the user sees it open while the search runs
      await vscode.commands.executeCommand('kotlinNav.findUsages.focus');
      const navigated = await usagesPanel.search(editor.document, editor.selection.active, args);
      if (navigated) {
        // Single result — panel not needed, refocus the editor
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      }
    }),

    vscode.commands.registerCommand('kotlin-nav.findUsages.toggleTests', () => {
      usagesPanel.toggleTests();
    }),
    vscode.commands.registerCommand('kotlin-nav.findUsages.showTests', () => {
      usagesPanel.toggleTests();
    }),

    vscode.commands.registerCommand('kotlin-nav.findUsages.togglePreviews', () => {
      usagesPanel.togglePreviews();
    }),
    vscode.commands.registerCommand('kotlin-nav.findUsages.showPreviews', () => {
      usagesPanel.togglePreviews();
    }),

    vscode.commands.registerCommand('kotlin-nav.goToTest', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const uri = editor.document.uri;
      const path = uri.path;
      const basename = path.split('/').pop() ?? '';
      const ext = basename.endsWith('.java') ? '.java' : '.kt';
      const nameNoExt = basename.replace(/\.(kt|java)$/, '');

      // Determine direction: test → implementation or implementation → test
      const isTest = nameNoExt.endsWith('Test');
      const targetName = isTest
        ? nameNoExt.slice(0, -4) + ext           // FooTest.kt → Foo.kt
        : nameNoExt + 'Test' + ext;               // Foo.kt → FooTest.kt

      // Also check cross-language: .kt ↔ .java
      const altExt = ext === '.kt' ? '.java' : '.kt';
      const altTargetName = isTest
        ? nameNoExt.slice(0, -4) + altExt
        : nameNoExt + 'Test' + altExt;

      const candidates: vscode.Uri[] = [];
      for (const uriStr of index.fileUriStrings()) {
        const file = uriStr.split('/').pop() ?? '';
        if (file === targetName || file === altTargetName) {
          candidates.push(vscode.Uri.parse(uriStr));
        }
      }

      if (candidates.length === 0) {
        const direction = isTest ? 'implementation' : 'test';
        vscode.window.showInformationMessage(`No ${direction} file found for ${nameNoExt}`);
        return;
      }

      let target: vscode.Uri;
      if (candidates.length === 1) {
        target = candidates[0];
      } else {
        // Multiple matches — let user pick
        const items = candidates.map(u => ({
          label: u.path.split('/').pop() ?? '',
          description: u.path,
          uri: u,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Multiple matches — pick ${isTest ? 'implementation' : 'test'} file`,
        });
        if (!picked) return;
        target = picked.uri;
      }

      await vscode.commands.executeCommand('vscode.open', target);
    }),
  );

  // ── Resolve Gradle modules and find all .kt files ─────────────────────────
  const cfg         = vscode.workspace.getConfiguration('kotlinNav');
  const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
  const maxFiles    = cfg.get<number>('maxIndexedFiles') ?? 10000;

  const [moduleMap, allUris] = await Promise.all([
    resolveModules(),
    vscode.workspace.findFiles('**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles),
  ]);

  const scanner = new FileScanner(index, log, moduleMap);

  const watcher = new FileWatcher(scanner, index);
  context.subscriptions.push(watcher, { dispose: () => scanner.destroy() });

  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-nav.copyFqn', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'kotlin') return;

      const doc = editor.document;
      const wordRange = doc.getWordRangeAtPosition(editor.selection.active, WORD_RE);
      if (!wordRange) { vscode.window.showInformationMessage('No symbol at cursor.'); return; }

      const word = doc.getText(wordRange);

      // FQN via import resolution first, then name fallback
      let fqn: string | undefined;
      for (const candidate of resolveImports(word, doc)) {
        const entry = index.lookupFqn(candidate);
        if (entry) { fqn = entry.fqn; break; }
      }
      if (!fqn) {
        const hits = index.lookup(word);
        if (hits.length > 0) fqn = hits[0].fqn;
      }

      if (!fqn) { vscode.window.showInformationMessage(`No indexed symbol: ${word}`); return; }

      await vscode.env.clipboard.writeText(fqn);
      vscode.window.showInformationMessage(`Copied: ${fqn}`);
    }),

    vscode.commands.registerCommand('kotlin-nav.reindex', async () => {
      statusBar.text    = '$(sync~spin) Kotlin Nav: re-indexing…';
      statusBar.tooltip = 'Kotlin Nav is rebuilding the symbol index';
      scanner.cancel(); // stop any in-flight scan before clearing the index
      index.clear();
      await scanner.scanAll();
      const freshUris = await vscode.workspace.findFiles(
        '**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles,
      );
      await collectStats(freshUris);
      const { files, symbols } = index.stats();
      statusBar.text    = `$(symbol-class) Kotlin Nav: ${symbols.toLocaleString()} symbols`;
      statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files`;
    }),
  );

  const t0 = Date.now();

  // ── Try snapshot first (near-zero re-activation cost) ─────────────────────
  const snapshot = await IndexStore.load(context);

  if (snapshot) {
    // Restore snapshot immediately — no I/O, no regex
    IndexStore.restore(snapshot, index);

    const { files, symbols } = index.stats();
    statusBar.text    = `$(symbol-class) Kotlin Nav: ${symbols.toLocaleString()} symbols`;
    statusBar.tooltip = `Restored from snapshot: ${symbols.toLocaleString()} symbols in ${files} files`;

    // Check staleness and re-scan only changed files in background
    const report = await IndexStore.checkStaleness(snapshot, allUris);

    // Reuse the stats already collected during staleness check
    _stats = report.stats;

    report.toRemove.forEach(uriStr => index.remove(vscode.Uri.parse(uriStr)));

    if (report.toScan.length > 0) {
      statusBar.text = `$(sync~spin) Kotlin Nav: updating ${report.toScan.length} files…`;
      await scanner.rescan(report.toScan);
    }

  } else {
    // No snapshot — full scan
    await scanner.scanAll();

    // Collect stats (mtime + size) for snapshot save on deactivate
    await collectStats(allUris);
  }

  const elapsed = Date.now() - t0;
  const { files, symbols } = index.stats();
  statusBar.text    = `$(symbol-class) Kotlin Nav: ${symbols.toLocaleString()} symbols`;
  statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files — ${elapsed}ms`;
  log.info(`Index ready: ${symbols} symbols in ${files} files (${elapsed}ms)`);
}

export async function deactivate(): Promise<void> {
  if (_index && _context && _stats.size > 0) {
    await IndexStore.save(_index, _stats, _context);
  }
}

async function collectStats(uris: vscode.Uri[]): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < uris.length) {
      const uri = uris[cursor++];
      try {
        const s = await vscode.workspace.fs.stat(uri);
        _stats.set(uri.toString(), { mtime: s.mtime, size: s.size });
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 50 }, worker));
}
