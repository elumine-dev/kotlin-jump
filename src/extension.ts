import * as vscode from 'vscode';
import { SymbolIndex } from './indexer/SymbolIndex';
import { FileScanner } from './indexer/FileScanner';
import { FileWatcher } from './watcher/FileWatcher';
import { KotlinDefinitionProvider, getPendingDeclNav, clearPendingDeclNav } from './providers/DefinitionProvider';
import { KotlinDocumentSymbolProvider } from './providers/DocumentSymbolProvider';
import { KotlinHoverProvider } from './providers/HoverProvider';
import { KotlinReferenceProvider } from './providers/ReferenceProvider';
import { KotlinFileProvider } from './providers/FileProvider';
import { KotlinImplementationProvider } from './providers/ImplementationProvider';
import { FindUsagesPanel } from './providers/FindUsagesPanel';
import { KotlinCodeLensProvider } from './providers/CodeLensProvider';
import { KotlinTypeHierarchyProvider } from './providers/TypeHierarchyProvider';
import { KotlinCallHierarchyProvider } from './providers/CallHierarchyProvider';
import { KotlinRenameProvider } from './providers/RenameProvider';
import { KotlinSemanticTokensProvider, TOKEN_TYPES, TOKEN_MODIFIERS } from './providers/SemanticTokensProvider';
import { Logger } from './util/logger';
import { resolveAll as resolveModules } from './gradle/ModuleResolver';
import { resolveBest } from './util/ImportResolver';
import * as IndexStore from './indexer/IndexStore';

const WORD_RE = /[A-Za-z_]\w*/;

// Module-level refs so deactivate() can save the snapshot
let _index:            SymbolIndex | undefined;
let _context:          vscode.ExtensionContext | undefined;
let _stats:            Map<string, { mtime: number; size: number }> = new Map();
let _semanticTokens:   KotlinSemanticTokensProvider | undefined;
let _snapshotEnabled:  boolean = true;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  _context = context;

  const log   = new Logger('Kotlin Jump');
  log.info('Extension activated — v0.5.0-debug');
  const index = new SymbolIndex();
  _index = index;

  // ── Register providers FIRST — Cmd+Click works even during indexing ───────
  const cfg0 = vscode.workspace.getConfiguration('kotlinJump');
  _snapshotEnabled = cfg0.get<boolean>('snapshotEnabled', true);
  const statusBarEnabled = cfg0.get<boolean>('statusBarEnabled', true);

  const companionMode = cfg0.get<string>('companionMode', 'auto');
  const isCompanion = companionMode === 'always'
    || (companionMode === 'auto' && !!vscode.extensions.getExtension('JetBrains.kotlin-lsp'));

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text    = '$(sync~spin) Kotlin Jump: indexing…';
  statusBar.tooltip = 'Kotlin Jump is building the symbol index';
  if (statusBarEnabled) statusBar.show();

  const KT_JAVA = [{ language: 'kotlin' }, { language: 'java' }];

  // ── Find Usages panel (tree view in the bottom panel area) ───────────────
  const usagesPanel = new FindUsagesPanel(index);
  const usagesView  = vscode.window.createTreeView('kotlinJump.findUsages', {
    treeDataProvider: usagesPanel,
    showCollapseAll:  true,
  });
  usagesPanel.attachTreeView(usagesView);

  // Initialise context keys so the toolbar icons show the correct state on first load
  vscode.commands.executeCommand('setContext', 'kotlinJump.findUsages.showTests', true);
  vscode.commands.executeCommand('setContext', 'kotlinJump.findUsages.showPreviews', true);

  context.subscriptions.push(
    log,
    statusBar,
    usagesPanel,
    usagesView,
    vscode.languages.registerDefinitionProvider(KT_JAVA, new KotlinDefinitionProvider(index, log)),
    // Outline, hover, rename, and semantic tokens are skipped in companion mode
    // (the JetBrains Kotlin LSP or another full LSP provides these).
    ...(!isCompanion ? [
      vscode.languages.registerDocumentSymbolProvider(KT_JAVA, new KotlinDocumentSymbolProvider(index)),
    ] : []),
    (() => {
      if (isCompanion) return { dispose: () => {} };
      const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('hoverEnabled', true);
      if (!enabled) return { dispose: () => {} };
      return vscode.languages.registerHoverProvider(KT_JAVA, new KotlinHoverProvider(index));
    })(),
    vscode.languages.registerReferenceProvider(KT_JAVA, new KotlinReferenceProvider(index)),
    vscode.languages.registerImplementationProvider(KT_JAVA, new KotlinImplementationProvider(index)),
    vscode.languages.registerTypeHierarchyProvider(KT_JAVA, new KotlinTypeHierarchyProvider(index)),
    vscode.languages.registerCallHierarchyProvider(KT_JAVA, new KotlinCallHierarchyProvider(index)),
    ...(!isCompanion ? [
      vscode.languages.registerRenameProvider(KT_JAVA, new KotlinRenameProvider(index)),
    ] : []),
    vscode.languages.registerWorkspaceSymbolProvider(new KotlinFileProvider(index)),

    // ── Semantic Highlighting ─────────────────────────────────────────────
    (() => {
      if (isCompanion) return { dispose: () => {} };
      const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('semanticHighlighting', true);
      if (!enabled) return { dispose: () => {} };
      const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);
      const sp = new KotlinSemanticTokensProvider(index, legend);
      _semanticTokens = sp;
      return vscode.Disposable.from(
        sp,
        vscode.languages.registerDocumentSemanticTokensProvider({ language: 'kotlin' }, sp, legend),
        vscode.languages.registerDocumentRangeSemanticTokensProvider({ language: 'kotlin' }, sp, legend),
      );
    })(),

    // ── Code Lens — "N usages | M implementations" above declarations ──────
    (() => {
      const codeLens = new KotlinCodeLensProvider(index);
      context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(KT_JAVA, codeLens),
        codeLens,
        vscode.workspace.onDidChangeConfiguration(e => {
          if (e.affectsConfiguration('kotlinJump.codeLens')) codeLens.refresh();
        }),
        vscode.workspace.onDidSaveTextDocument(() => {
          // Refresh lenses after file save (index updates via FileWatcher)
          setTimeout(() => codeLens.refresh(), 300);
        }),
      );
      return codeLens;
    })(),

    vscode.commands.registerCommand('kotlin-jump.codeLensAction',
      async (uri: vscode.Uri, line: number, character: number) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const pos = new vscode.Position(line, character);
        editor.selection = new vscode.Selection(pos, pos);
        await vscode.commands.executeCommand('kotlin-jump.findUsages');
      }
    ),

    vscode.commands.registerCommand('kotlin-jump.findUsages', async (args?: { excludeUri?: string; excludeLine?: number }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lang = editor.document.languageId;
      if (lang !== 'kotlin' && lang !== 'java') return;
      const smartNav = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('smartNavigation', true);
      if (!smartNav && !args) {
        await vscode.commands.executeCommand('editor.action.goToReferences');
        return;
      }
      if (smartNav) {
        await vscode.commands.executeCommand('kotlinJump.findUsages.focus');
      }
      const navigated = await usagesPanel.search(editor.document, editor.selection.active, args);
      if (navigated) {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      } else if (!smartNav) {
        // Multiple results with smartNav off → fall back to native references
        await vscode.commands.executeCommand('editor.action.goToReferences');
      }
    }),

    vscode.commands.registerCommand('kotlin-jump.findUsages.toggleTests', () => {
      usagesPanel.toggleTests();
    }),
    vscode.commands.registerCommand('kotlin-jump.findUsages.showTests', () => {
      usagesPanel.toggleTests();
    }),

    vscode.commands.registerCommand('kotlin-jump.findUsages.togglePreviews', () => {
      usagesPanel.togglePreviews();
    }),
    vscode.commands.registerCommand('kotlin-jump.findUsages.showPreviews', () => {
      usagesPanel.togglePreviews();
    }),

    vscode.commands.registerCommand('kotlin-jump.goToTest', async () => {
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

    vscode.commands.registerCommand('kotlin-jump.goToComposablePreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, WORD_RE);
      if (!wordRange) return;
      const word = editor.document.getText(wordRange);

      const fileEntries = index.getFileSymbols(editor.document.uri.toString());
      const cursorLine  = editor.selection.active.line;
      const entry = fileEntries.find(e => e.name === word && Math.abs(e.line - cursorLine) <= 1);

      const isComposable = entry?.isComposable ?? false;
      const isPreview    = entry?.isPreview    ?? false;

      if (!isComposable && !isPreview) {
        vscode.window.showInformationMessage(`"${word}" is not a @Composable or @Preview function.`);
        return;
      }

      const all = index.allEntries();
      let candidates: typeof all;
      if (isComposable) {
        candidates = all.filter(e => e.isPreview && e.name.includes(word));
      } else {
        candidates = all.filter(e => e.isComposable && word.includes(e.name));
      }

      if (candidates.length === 0) {
        const direction = isComposable ? 'preview' : 'composable';
        vscode.window.showInformationMessage(`No ${direction} found for "${word}".`);
        return;
      }

      let target: (typeof candidates)[0];
      if (candidates.length === 1) {
        target = candidates[0];
      } else {
        const items = candidates.map(e => ({
          label: e.name,
          description: e.uri.path,
          entry: e,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Multiple matches — pick ${isComposable ? 'preview' : 'composable'}`,
        });
        if (!picked) return;
        target = picked.entry;
      }

      const doc = await vscode.workspace.openTextDocument(target.uri);
      const ed  = await vscode.window.showTextDocument(doc, { preview: false });
      const pos = new vscode.Position(target.line, target.character);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }),

    // ── Detect Cmd+Click on declaration → fire Find Usages ────────────────
    // provideDefinition sets pendingDeclNavigation when at a declaration.
    // On hover: VS Code shows the link but doesn't navigate → no selection change.
    // On click: VS Code navigates to self → selection change with kind=Command.
    vscode.window.onDidChangeTextEditorSelection(e => {
      const pending = getPendingDeclNav();
      if (!pending) return;
      if (e.kind !== vscode.TextEditorSelectionChangeKind.Command) {
        clearPendingDeclNav();
        return;
      }
      clearPendingDeclNav();

      const pos = e.selections[0]?.active;
      if (!pos || pos.line !== pending.line) return;
      if (e.textEditor.document.uri.toString() !== pending.uri) return;

      const smartNav = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('smartNavigation', true);
      if (smartNav) {
        const excl = { excludeUri: pending.uri, excludeLine: pending.line };
        vscode.commands.executeCommand('kotlin-jump.findUsages', excl);
      } else {
        vscode.commands.executeCommand('editor.action.goToReferences');
      }
    }),
  );

  // ── Resolve Gradle modules and find all .kt files ─────────────────────────
  const cfg         = vscode.workspace.getConfiguration('kotlinJump');
  const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
  const maxFiles    = cfg.get<number>('maxIndexedFiles') ?? 10000;

  const [moduleMap, allUris] = await Promise.all([
    resolveModules(),
    vscode.workspace.findFiles('**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles),
  ]);

  const scanner = new FileScanner(index, log, moduleMap);

  const watcher = new FileWatcher(scanner, index, uri => _semanticTokens?.invalidate(uri.toString()));
  context.subscriptions.push(watcher, { dispose: () => scanner.destroy() });

  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.copyFqn', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'kotlin') return;

      const doc = editor.document;
      const wordRange = doc.getWordRangeAtPosition(editor.selection.active, WORD_RE);
      if (!wordRange) { vscode.window.showInformationMessage('No symbol at cursor.'); return; }

      const word = doc.getText(wordRange);

      // FQN via import resolution first, then name fallback
      let fqn: string | undefined;
      const resolved = resolveBest(word, doc, candidate => index.lookupFqn(candidate));
      if (resolved.matches.length === 1) {
        fqn = resolved.matches[0].fqn;
      } else if (resolved.matches.length > 1) {
        const items = resolved.matches.map(entry => ({
          label: entry.fqn,
          description: entry.uri.path,
          fqn: entry.fqn,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Multiple matches for ${word} — pick the FQN to copy`,
        });
        if (!picked) return;
        fqn = picked.fqn;
      }
      if (!fqn) {
        const hits = index.lookup(word);
        if (hits.length === 1) fqn = hits[0].fqn;
      }

      if (!fqn) { vscode.window.showInformationMessage(`No indexed symbol: ${word}`); return; }

      await vscode.env.clipboard.writeText(fqn);
      vscode.window.showInformationMessage(`Copied: ${fqn}`);
    }),

    vscode.commands.registerCommand('kotlin-jump.reindex', async () => {
      statusBar.text    = '$(sync~spin) Kotlin Jump: re-indexing…';
      statusBar.tooltip = 'Kotlin Jump is rebuilding the symbol index';
      scanner.cancel(); // stop any in-flight scan before clearing the index
      index.clear();
      await scanner.scanAll();
      const freshUris = await vscode.workspace.findFiles(
        '**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles,
      );
      await collectStats(freshUris);
      const { files, symbols } = index.stats();
      statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
      statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files`;
    }),
  );

  const t0 = Date.now();

  // ── Try snapshot first (near-zero re-activation cost) ─────────────────────
  const snapshot = _snapshotEnabled ? await IndexStore.load(context) : null;

  if (snapshot) {
    // Restore snapshot immediately — no I/O, no regex
    IndexStore.restore(snapshot, index);

    const { files, symbols } = index.stats();
    statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
    statusBar.tooltip = `Restored from snapshot: ${symbols.toLocaleString()} symbols in ${files} files`;

    // Check staleness and re-scan only changed files in background
    const report = await IndexStore.checkStaleness(snapshot, allUris);

    // Reuse the stats already collected during staleness check
    _stats = report.stats;

    report.toRemove.forEach(uriStr => index.remove(vscode.Uri.parse(uriStr)));

    if (report.toScan.length > 0) {
      statusBar.text = `$(sync~spin) Kotlin Jump: updating ${report.toScan.length} files…`;
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
  statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
  statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files — ${elapsed}ms`;
  log.info(`Index ready: ${symbols} symbols in ${files} files (${elapsed}ms)`);
  _semanticTokens?.invalidate();
}

export async function deactivate(): Promise<void> {
  if (_snapshotEnabled && _index && _context && _stats.size > 0) {
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
