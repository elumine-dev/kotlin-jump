import * as vscode from 'vscode';
import { SymbolIndex } from './indexer/SymbolIndex';
import { FileScanner } from './indexer/FileScanner';
import { FileWatcher } from './watcher/FileWatcher';
import { KotlinDefinitionProvider, getPendingDeclNav, clearPendingDeclNav } from './providers/DefinitionProvider';
import { KotlinDocumentSymbolProvider } from './providers/DocumentSymbolProvider';
import { KotlinHoverProvider } from './providers/HoverProvider';
import { KotlinReferenceProvider } from './providers/ReferenceProvider';
import { invalidateContentCache, clearContentCache } from './providers/FindUsagesEngine';
import { KotlinFileProvider } from './providers/FileProvider';
import { KotlinImplementationProvider } from './providers/ImplementationProvider';
import { FindUsagesPanel } from './providers/FindUsagesPanel';
import { KotlinCodeLensProvider } from './providers/CodeLensProvider';
import { KotlinTypeHierarchyProvider } from './providers/TypeHierarchyProvider';
import { KotlinCallHierarchyProvider } from './providers/CallHierarchyProvider';
import { KotlinRenameProvider } from './providers/RenameProvider';
import { OrganizeImportsProvider, organizeImports, buildOrganizeEdit } from './providers/OrganizeImportsProvider';
import { AutoImportProvider } from './providers/AutoImportProvider';
import { KotlinDocumentHighlightProvider } from './providers/DocumentHighlightProvider';
import { KotlinInlayHintsProvider } from './providers/InlayHintsProvider';
import { KotlinSignatureHelpProvider } from './providers/SignatureHelpProvider';
import { KotlinSelectionRangeProvider } from './providers/SelectionRangeProvider';
import { KotlinFoldingRangeProvider } from './providers/FoldingRangeProvider';
import { KotlinSemanticTokensProvider, TOKEN_TYPES, TOKEN_MODIFIERS } from './providers/SemanticTokensProvider';
import { Logger } from './util/logger';
import { resolveCompanionMode } from './util/companionMode';
import { resolveAll as resolveModules } from './gradle/ModuleResolver';
import { resolveBest } from './util/ImportResolver';
import { readProjectConfigs } from './util/ProjectConfig';
import { inferPackage, buildMoveEdit } from './providers/MoveFileProvider';
import * as path from 'path';
import * as IndexStore from './indexer/IndexStore';
import { KotlinJarContentProvider, KOTLIN_JAR_SCHEME, closeAllCachedZips } from './providers/KotlinJarContentProvider';
import { GradleSourcesScanner } from './gradle/GradleSourcesScanner';
import { MavenSourcesScanner }  from './gradle/MavenSourcesScanner';
import { resolveSourceJarPaths } from './gradle/GradleToolingResolver';
import { KotlinTestController } from './testing/KotlinTestController';
import { registerChatParticipant } from './ai/KotlinJumpChatParticipant';
import { StringResourceIndex } from './indexer/StringResourceIndex';
import { StringResourceFoldingProvider } from './providers/StringResourceFoldingProvider';
import { StringResourceHoverProvider } from './providers/StringResourceHoverProvider';
import { StringResourceDefinitionProvider } from './providers/StringResourceDefinitionProvider';
import { StringXmlDefinitionProvider } from './providers/StringXmlDefinitionProvider';
import { RResourceIndex } from './indexer/RResourceIndex';
import { runCodeLensAction } from './providers/CodeLensAction';
import { WhatsNewPanel } from './providers/WhatsNewPanel';

const WORD_RE = /[A-Za-z_]\w*/;

// Module-level refs so deactivate() can save the snapshot
let _index:            SymbolIndex | undefined;
let _context:          vscode.ExtensionContext | undefined;
let _stats:            Map<string, { mtime: number; size: number }> = new Map();
let _semanticTokens:   KotlinSemanticTokensProvider | undefined;
let _signatureHelp:    KotlinSignatureHelpProvider  | undefined;
let _snapshotEnabled:  boolean = true;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  _context = context;

  const log   = new Logger('Kotlin Jump');
  const version = context.extension.packageJSON.version as string ?? '?';
  log.info(`Extension activated — v${version}`);

  // ── First install / update handling ─────────────────────────────────────
  const lastSeen = context.globalState.get<string>('lastSeenVersion');
  if (!lastSeen) {
    void vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      'elumine.kotlin-jump#kotlinJumpGettingStarted',
      false,
    );
  } else if (lastSeen !== version) {
    void vscode.window.showInformationMessage(
      `Kotlin Jump updated to v${version}`,
      "See What's New",
    ).then(choice => {
      if (choice === "See What's New") {
        void WhatsNewPanel.show(context);
      }
    });
  }
  void context.globalState.update('lastSeenVersion', version);

  const index = new SymbolIndex();
  _index = index;

  // ── Register providers FIRST — Cmd+Click works even during indexing ───────
  const cfg0 = vscode.workspace.getConfiguration('kotlinJump');
  _snapshotEnabled = cfg0.get<boolean>('snapshotEnabled', true);
  const statusBarEnabled = cfg0.get<boolean>('statusBarEnabled', true);

  const companionMode = cfg0.get<string>('companionMode', 'auto');
  const isCompanion = resolveCompanionMode(
    companionMode,
    vscode.extensions.getExtension('JetBrains.kotlin-lsp') !== undefined,
  );

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

  const codeLens = new KotlinCodeLensProvider(index);

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
    vscode.languages.registerReferenceProvider(KT_JAVA, new KotlinReferenceProvider(index, log)),
    vscode.languages.registerImplementationProvider(KT_JAVA, new KotlinImplementationProvider(index)),
    vscode.languages.registerTypeHierarchyProvider(KT_JAVA, new KotlinTypeHierarchyProvider(index)),
    vscode.languages.registerCallHierarchyProvider(KT_JAVA, new KotlinCallHierarchyProvider(index)),
    ...(!isCompanion ? [
      vscode.languages.registerRenameProvider(KT_JAVA, new KotlinRenameProvider(index)),
      vscode.languages.registerCodeActionsProvider(
        KT_JAVA,
        new OrganizeImportsProvider(),
        { providedCodeActionKinds: OrganizeImportsProvider.providedCodeActionKinds },
      ),
      vscode.languages.registerCodeActionsProvider(
        KT_JAVA,
        new AutoImportProvider(index),
        { providedCodeActionKinds: AutoImportProvider.providedCodeActionKinds },
      ),
    ] : []),
    vscode.languages.registerDocumentHighlightProvider(KT_JAVA, new KotlinDocumentHighlightProvider(index)),
    vscode.languages.registerSelectionRangeProvider(KT_JAVA, new KotlinSelectionRangeProvider(index)),
    (() => {
      const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('foldingEnabled', true);
      if (!enabled) return { dispose: () => {} };
      return vscode.languages.registerFoldingRangeProvider(KT_JAVA, new KotlinFoldingRangeProvider(index));
    })(),

    // ── Inlay Hints — parameter names + inferred types ───────────────────────
    // Settings are read dynamically inside provideInlayHints so changes take
    // effect immediately without Reload Window. The onDidChangeConfiguration
    // listener fires onDidChangeInlayHints so VS Code re-requests hints.
    (() => {
      if (isCompanion) return { dispose: () => {} };
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      const showParamNames    = cfg.get<boolean>('inlayHints.parameterNames', true);
      const showInferredTypes = cfg.get<boolean>('inlayHints.inferredTypes', false);
      log.info(`[InlayHints] registered — showParamNames=${showParamNames} showInferredTypes=${showInferredTypes}`);
      const provider = new KotlinInlayHintsProvider(index, log);
      return vscode.Disposable.from(
        vscode.languages.registerInlayHintsProvider(KT_JAVA, provider),
        vscode.workspace.onDidChangeConfiguration(e => {
          if (e.affectsConfiguration('kotlinJump.inlayHints')) {
            const c = vscode.workspace.getConfiguration('kotlinJump');
            log.info(`[InlayHints] settings changed — showParamNames=${c.get('inlayHints.parameterNames')} showInferredTypes=${c.get('inlayHints.inferredTypes')} — firing refresh`);
            provider.fireChange();
          }
        }),
      );
    })(),

    // ── Signature Help — popup on `(` and `,` ────────────────────────────────
    (() => {
      if (isCompanion) return { dispose: () => {} };
      const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('signatureHelp', true);
      if (!enabled) return { dispose: () => {} };
      _signatureHelp = new KotlinSignatureHelpProvider(index);
      return vscode.Disposable.from(
        vscode.languages.registerSignatureHelpProvider(
          KT_JAVA,
          _signatureHelp,
          { triggerCharacters: ['(', ','], retriggerCharacters: [')'] },
        ),
        _signatureHelp,
      );
    })(),

    vscode.languages.registerWorkspaceSymbolProvider(new KotlinFileProvider(index, log)),
    vscode.workspace.registerFileSystemProvider(KOTLIN_JAR_SCHEME, new KotlinJarContentProvider(), { isReadonly: true, isCaseSensitive: true }),

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
    // Hoisted so codeLens.refresh() can be called after scan/snapshot completes.
    // File-level updates go through evictFile() (surgical cache eviction).
    // onDidSaveTextDocument is not needed — FileWatcher.onFileIndexed covers saves.
    codeLens,
    vscode.languages.registerCodeLensProvider(KT_JAVA, codeLens),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kotlinJump.codeLens')) codeLens.refresh();
    }),

    vscode.commands.registerCommand('kotlin-jump.codeLensAction',
      async (uri: vscode.Uri, line: number, character: number, name: string, fqn: string) => {
        await runCodeLensAction(uri, line, character, name, fqn, {
          getCachedResults: lensFqn => codeLens.getCachedResults(lensFqn),
          usagesPanel,
        });
      },
    ),

    vscode.commands.registerCommand('kotlin-jump.goToMethodImpl',
      async (uri: vscode.Uri, line: number, name: string, _implUriStrings: string[]) => {
        clearPendingDeclNav();
        const impls = index.lookupMethodImplementations(name, uri.toString(), line);
        if (impls.length === 0) return;

        if (impls.length === 1) {
          const m = impls[0];
          await vscode.commands.executeCommand('vscode.open', m.uri, {
            preview: true,
            selection: new vscode.Range(m.line, m.character, m.line, m.character + name.length),
          } as vscode.TextDocumentShowOptions);
          return;
        }

        // Multiple implementations → show quick pick
        const items = impls.map(m => ({
          label:  m.fqn.split('.').slice(-2).join('.'),
          detail: m.uri.path.split('/').pop(),
          impl:   m,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Go to implementation of ${name}`,
        });
        if (picked) {
          const m = picked.impl;
          await vscode.commands.executeCommand('vscode.open', m.uri, {
            preview: true,
            selection: new vscode.Range(m.line, m.character, m.line, m.character + name.length),
          } as vscode.TextDocumentShowOptions);
        }
      },
    ),

    vscode.commands.registerCommand('kotlin-jump.whatsNew', () => {
      void WhatsNewPanel.show(context);
    }),

    vscode.commands.registerCommand('kotlin-jump.openWalkthrough', () => {
      void vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        'elumine.kotlin-jump#kotlinJumpGettingStarted',
        false,
      );
    }),

    vscode.commands.registerCommand('kotlin-jump.findUsages', async (args?: { excludeUri?: string; excludeLine?: number }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lang = editor.document.languageId;
      if (lang !== 'kotlin' && lang !== 'java') return;
      const smartNav = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('smartNavigation', false);
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
      } else if (!smartNav && !args) {
        // Multiple results, no code-lens context → fall back to native references
        await vscode.commands.executeCommand('editor.action.goToReferences');
      } else if (!smartNav && args) {
        // Code lens click with multiple results → show panel
        await vscode.commands.executeCommand('kotlinJump.findUsages.focus');
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

      const smartNav = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('smartNavigation', false);
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

  const [gradleModules, { moduleMap: jsonModules, sourceRoots }, allUris] = await Promise.all([
    resolveModules(),
    readProjectConfigs(),
    vscode.workspace.findFiles('**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles),
  ]);

  // Gradle takes precedence over kotlin-jump.json when both define the same module
  const moduleMap = new Map([...jsonModules, ...gradleModules]);
  log.info(`[moduleMap] ${moduleMap.size} module(s) from settings.gradle + kotlin-jump.json`);
  for (const [name, dir] of moduleMap) log.debug(`[moduleMap]   ${name} → ${dir}`);

  const scanner = new FileScanner(index, log, moduleMap);

  const watcher = new FileWatcher(scanner, index, uri => {
    _semanticTokens?.invalidate(uri.toString());
    codeLens.evictFile(uri.toString());     // surgical: only evict symbols in the changed file
    _signatureHelp?.evictFile(uri.toString());
    invalidateContentCache(uri.toString()); // file changed — next scan re-reads from disk
    testCtrl.notifyFileIndexed(uri);    // index is fresh — safe to refresh test tree now
  }, log);
  context.subscriptions.push(watcher, { dispose: () => scanner.destroy() });

  // ── String Resource Folding ────────────────────────────────────────────────
  context.subscriptions.push((() => {
    const stringIndex     = new StringResourceIndex();
    const foldingProvider = new StringResourceFoldingProvider(stringIndex, log);

    // ── R.string usage index (XML → Kotlin navigation) ──────────────────────
    // Pre-indexes R.(string|plurals|array).KEY usages from all Kotlin/Java files
    // so that provideDefinition() is O(1) instead of O(N files × I/O).
    const rIndex = new RResourceIndex();
    void Promise.all(allUris.map(async u => {
      try {
        const bytes = await vscode.workspace.fs.readFile(u);
        rIndex.reindexFile(u.toString(), new TextDecoder().decode(bytes));
      } catch { /* skip unreadable files */ }
    }));
    const rW = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts,java}');
    const handleRChanged = async (uri: vscode.Uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        rIndex.reindexFile(uri.toString(), new TextDecoder().decode(bytes));
      } catch { /* skip */ }
    };
    rW.onDidChange(handleRChanged);
    rW.onDidCreate(handleRChanged);
    rW.onDidDelete(uri => rIndex.removeFile(uri.toString()));

    // Initial scan of all strings.xml files
    vscode.workspace.findFiles(
      '**/res/values*/strings.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => {
      log.info(`[StringFolding] found ${uris.length} strings.xml file(s)`);
      for (const u of uris) log.debug(`[StringFolding]   ${u.fsPath}`);
      return Promise.all(uris.map(async u => {
        const bytes = await vscode.workspace.fs.readFile(u);
        stringIndex.reindexFile(u, new TextDecoder().decode(bytes));
        log.debug(`[StringFolding] indexed ${u.fsPath}`);
      }));
    }).then(() => {
      log.info('[StringFolding] initial scan done — invalidating all editors');
      foldingProvider.invalidateAll();
    });

    if (vscode.window.activeTextEditor) foldingProvider.invalidateAll();

    const handleChanged = async (uri: vscode.Uri) => {
      log.info(`[StringFolding] strings.xml changed — reindexing ${uri.fsPath}`);
      const bytes = await vscode.workspace.fs.readFile(uri);
      stringIndex.reindexFile(uri, new TextDecoder().decode(bytes));
      foldingProvider.invalidateAll();
    };
    const handleDeleted = (uri: vscode.Uri) => {
      log.info(`[StringFolding] strings.xml deleted — removing ${uri.fsPath}`);
      stringIndex.removeFile(uri);
      foldingProvider.invalidateAll();
    };
    const strW1 = vscode.workspace.createFileSystemWatcher('**/res/values/strings.xml');
    const strW2 = vscode.workspace.createFileSystemWatcher('**/res/values-*/strings.xml');
    for (const w of [strW1, strW2]) {
      w.onDidCreate(handleChanged);
      w.onDidChange(handleChanged);
      w.onDidDelete(handleDeleted);
    }

    const syncFoldingContext = (): void => {
      const enabled = vscode.workspace.getConfiguration('kotlinJump')
        .get<boolean>('stringResourceFolding', true);
      vscode.commands.executeCommand('setContext', 'kotlinJump.stringFoldingEnabled', enabled);
    };
    syncFoldingContext();

    return vscode.Disposable.from(
      foldingProvider,
      strW1,
      strW2,
      rW,
      vscode.languages.registerHoverProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new StringResourceHoverProvider(stringIndex),
      ),
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new StringResourceDefinitionProvider(stringIndex),
      ),
      vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        new StringXmlDefinitionProvider(rIndex),
      ),
      vscode.commands.registerCommand('kotlinJump.enableStringFolding', () => {
        vscode.workspace.getConfiguration('kotlinJump')
          .update('stringResourceFolding', true, vscode.ConfigurationTarget.Global);
      }),
      vscode.commands.registerCommand('kotlinJump.disableStringFolding', () => {
        vscode.workspace.getConfiguration('kotlinJump')
          .update('stringResourceFolding', false, vscode.ConfigurationTarget.Global);
      }),
      vscode.commands.registerCommand('kotlinJump.toggleStringFolding', () => {
        const cfg = vscode.workspace.getConfiguration('kotlinJump');
        cfg.update(
          'stringResourceFolding',
          !cfg.get<boolean>('stringResourceFolding', true),
          vscode.ConfigurationTarget.Global,
        );
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.stringResourceFolding')) {
          syncFoldingContext();
          foldingProvider.invalidateAll();
        }
      }),
    );
  })());

  // ── Test Explorer ─────────────────────────────────────────────────────────
  const testCtrl = new KotlinTestController(index, context, log);

  // ── JAR / Maven scanners ──────────────────────────────────────────────────
  // Scans are serialised via a promise chain so concurrent calls (startup,
  // reindex, build.gradle watcher) never overlap on the same index.
  let gradleScanner: GradleSourcesScanner | undefined;
  let mavenScanner:  MavenSourcesScanner  | undefined;
  let _scanChain: Promise<void> = Promise.resolve();

  /** Cancel any in-flight scans and queue a fresh one. */
  const runJarScan = () => {
    gradleScanner?.cancel();
    mavenScanner?.cancel();
    if (!gradleScanner) return;

    _scanChain = _scanChain.then(async () => {
      statusBar.text = '$(sync~spin) Kotlin Jump: indexing library sources…';
      try {
        const cfg = vscode.workspace.getConfiguration('kotlinJump');

        // Optionally use Gradle Tooling API to get the precise source JAR list
        let toolingJarPaths: string[] | null = null;
        if (cfg.get<boolean>('useGradleTooling', false)) {
          const folders  = vscode.workspace.workspaceFolders ?? [];
          const timeout  = cfg.get<number>('gradleToolingTimeoutMs', 30_000);
          for (const folder of folders) {
            toolingJarPaths = await resolveSourceJarPaths(folder.uri.fsPath, timeout);
            if (toolingJarPaths) break;
          }
        }

        const [gradle, maven] = await Promise.all([
          gradleScanner!.scanAll(toolingJarPaths ?? undefined),
          mavenScanner!.scanAll(),
        ]);
        const totalJars  = gradle.jars  + maven.jars;
        const totalFiles = gradle.files + maven.files;

        const { symbols: totalSymbols } = index.stats();
        statusBar.text    = `$(symbol-class) Kotlin Jump: ${totalSymbols.toLocaleString()} symbols`;
        statusBar.tooltip = `${totalSymbols.toLocaleString()} symbols (incl. ${totalFiles} library files from ${totalJars} JARs)`;
        _semanticTokens?.invalidate();
      } catch (err) {
        log.warn(`[jarscan] ${err}`);
        const { symbols: s, files: f } = index.stats();
        statusBar.text    = `$(symbol-class) Kotlin Jump: ${s.toLocaleString()} symbols`;
        statusBar.tooltip = `${s.toLocaleString()} symbols in ${f} files`;
      }
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.runTest', async (fqn: string, moduleName?: string) => {
      let item = testCtrl.findMethodItem(fqn);
      if (!item) {
        const entry = index.lookupFqn(fqn);
        if (entry) { testCtrl.refreshFileTests(entry.uri); item = testCtrl.findMethodItem(fqn); }
      }
      if (!item) { vscode.window.showWarningMessage(`Kotlin Jump: test not found in index: ${fqn}`); return; }
      vscode.commands.executeCommand('workbench.view.testing.focus');
      vscode.commands.executeCommand('testing.showMostRecentOutput');
      await testCtrl.runItems([item]);
    }),

    vscode.commands.registerCommand('kotlin-jump.runTestClass', async (fqn: string, moduleName?: string) => {
      let classItem = testCtrl.findClassItem(fqn);
      if (!classItem) {
        const entry = index.lookupFqn(fqn);
        if (entry) { testCtrl.refreshFileTests(entry.uri); classItem = testCtrl.findClassItem(fqn); }
      }
      if (!classItem) { vscode.window.showWarningMessage(`Kotlin Jump: test class not found: ${fqn}`); return; }
      vscode.commands.executeCommand('workbench.view.testing.focus');
      vscode.commands.executeCommand('testing.showMostRecentOutput');
      await testCtrl.runItems([classItem]);
    }),

    vscode.commands.registerCommand('kotlin-jump.debugTest', () => { /* removed */ }),

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

    vscode.commands.registerCommand('kotlin-jump.organizeImports', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lang = editor.document.languageId;
      if (lang !== 'kotlin' && lang !== 'java') return;

      const cfg = vscode.workspace.getConfiguration('kotlinJump.organizeImports');
      const removeUnused = cfg.get<boolean>('removeUnused', true);
      const result = organizeImports(editor.document.getText(), { removeUnused });

      if (!result) {
        vscode.window.showInformationMessage('No imports to organize.');
        return;
      }

      const edit = buildOrganizeEdit(editor.document);
      if (edit) await vscode.workspace.applyEdit(edit);

      if (result.removed.length > 0) {
        const n = result.removed.length;
        vscode.window.showInformationMessage(
          `Organize imports: removed ${n} unused import${n === 1 ? '' : 's'}.`,
        );
      }
    }),

    vscode.commands.registerCommand('kotlin-jump.moveFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      if (!doc.uri.fsPath.endsWith('.kt')) {
        vscode.window.showWarningMessage('Kotlin Jump: Move File only works on .kt files.');
        return;
      }

      const dest = await vscode.window.showOpenDialog({
        canSelectFiles:   false,
        canSelectFolders: true,
        canSelectMany:    false,
        title:            'Move file to…',
        openLabel:        'Move here',
        defaultUri:       vscode.Uri.file(path.dirname(doc.uri.fsPath)),
      });
      if (!dest || dest.length === 0) return;

      const destDir  = dest[0].fsPath;
      const fileName = path.basename(doc.uri.fsPath);
      const newPath  = path.join(destDir, fileName);
      if (newPath === doc.uri.fsPath) return;

      const oldPkg = /^(?:\s*package\s+)([\w.]+)/m.exec(doc.getText())?.[1] ?? '';
      let newPkg = inferPackage(doc.uri.fsPath, destDir, oldPkg, sourceRoots);

      if (newPkg === null) {
        const input = await vscode.window.showInputBox({
          prompt:        'New package name (could not be inferred from path)',
          value:         oldPkg,
          validateInput: v => /^[\w.]*$/.test(v) ? null : 'Invalid package name',
        });
        if (input === undefined) return;
        newPkg = input;
      }

      const newUri = vscode.Uri.file(newPath);
      const edit   = await buildMoveEdit(doc, newUri, newPkg, index);
      await vscode.workspace.applyEdit(edit);
    }),

    vscode.commands.registerCommand('kotlin-jump.reindex', async () => {
      statusBar.text    = '$(sync~spin) Kotlin Jump: re-indexing…';
      statusBar.tooltip = 'Kotlin Jump is rebuilding the symbol index';
      // Cancel any in-flight JAR scan, then drain the chain so removeExternal()
      // runs only after the previous scan has fully stopped.
      gradleScanner?.cancel();
      mavenScanner?.cancel();
      await _scanChain;
      scanner.cancel();
      index.clear();
      clearContentCache(); // workspace re-indexed — cached content is stale
      await scanner.scanAll();
      const freshUris = await vscode.workspace.findFiles(
        '**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles,
      );
      await collectStats(freshUris);
      const { files, symbols } = index.stats();
      statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
      statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files`;
      index.removeExternal();
      runJarScan();
    }),

    // ── Watcher build.gradle — mise à jour des sources JAR en live ───────────
    (() => {
      let debounceId: ReturnType<typeof setTimeout> | undefined;
      const gradleWatcher = vscode.workspace.createFileSystemWatcher('**/build.gradle{,.kts}');
      const onGradleChange = () => {
        if (debounceId) clearTimeout(debounceId);
        // Délai 30s : laisser Gradle terminer le téléchargement des nouveaux JARs
        debounceId = setTimeout(async () => {
          const action = await vscode.window.showInformationMessage(
            'Kotlin Jump: Gradle files changed — new library sources may be available.',
            'Index now',
            'Later',
          );
          if (action === 'Index now') {
            gradleScanner?.cancel();
            mavenScanner?.cancel();
            await _scanChain;
            index.removeExternal();
            runJarScan();
          }
        }, 30_000);
      };
      gradleWatcher.onDidChange(onGradleChange);
      gradleWatcher.onDidCreate(onGradleChange);
      return gradleWatcher;
    })(),
  );

  const t0 = Date.now();

  // ── Priority scan — index visible editors in parallel with snapshot load ────
  // Gives near-instant lenses (~50-100ms) for the active file regardless of
  // whether a snapshot exists. index.add() is idempotent so the snapshot
  // restore below safely overwrites these entries if they were stale.
  const visibleUris = vscode.window.visibleTextEditors
    .map(e => e.document.uri)
    .filter(u => /\.(kt|kts|java)$/.test(u.fsPath));

  // ── Try snapshot first (near-zero re-activation cost) ─────────────────────
  const [snapshot] = await Promise.all([
    _snapshotEnabled ? IndexStore.load(context) : Promise.resolve(null),
    ...visibleUris.map(u => scanner.scanFile(u)),
  ]);

  if (snapshot) {
    // Restore full index from snapshot
    IndexStore.restore(snapshot, index);
    // Re-apply priority scan AFTER restore so open files are never stale
    // (restore() would have overwritten the fresh priority-scanned data)
    if (visibleUris.length > 0) {
      await Promise.all(visibleUris.map(u => scanner.scanFile(u)));
      log.info(`[startup] priority scan re-applied over snapshot for ${visibleUris.length} visible editor(s)`);
    }
    codeLens.refresh(); // single refresh with correct data

    const { files, symbols } = index.stats();
    log.info(`[startup] snapshot restored: ${symbols.toLocaleString()} symbols in ${files} files`);
    statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
    statusBar.tooltip = `Restored from snapshot: ${symbols.toLocaleString()} symbols in ${files} files`;

    // Check staleness and re-scan only changed files in background
    const report = await IndexStore.checkStaleness(snapshot, allUris);
    _stats = report.stats;

    if (report.toRemove.length > 0) {
      log.info(`[startup] removed ${report.toRemove.length} deleted files from index`);
      report.toRemove.forEach(uriStr => index.remove(vscode.Uri.parse(uriStr)));
    }

    if (report.toScan.length > 0) {
      log.info(`[startup] ${report.toScan.length} stale files — rescanning…`);
      statusBar.text = `$(sync~spin) Kotlin Jump: updating ${report.toScan.length} files…`;
      await scanner.rescan(report.toScan);
      codeLens.refresh();
    } else {
      log.info('[startup] snapshot up to date — no rescan needed');
    }

  } else {
    // No snapshot — full scan (visible files already indexed above)
    log.info(`[startup] no snapshot — full scan of ${allUris.length} files`);
    await scanner.scanAll();
    codeLens.refresh();

    await collectStats(allUris);
  }

  // Index is now fully populated — trigger test discovery regardless of whether
  // resolveHandler already ran on an empty/partial index during startup.
  testCtrl.notifyScanComplete();

  const elapsed = Date.now() - t0;
  const { files, symbols } = index.stats();
  statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
  statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files — ${elapsed}ms`;
  log.info(`Index ready: ${symbols} symbols in ${files} files (${elapsed}ms)`);
  _semanticTokens?.invalidate();

  gradleScanner = new GradleSourcesScanner(index, log);
  mavenScanner  = new MavenSourcesScanner(index, log);
  runJarScan();

  // ── Chat Participant (F7) ─────────────────────────────────────────────────
  registerChatParticipant(context, index);

  // ── MCP Server Definition Provider (F8) ──────────────────────────────────
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const mcpProvider: vscode.McpServerDefinitionProvider = {
      onDidChangeMcpServerDefinitions: new vscode.EventEmitter<void>().event,
      async provideMcpServerDefinitions() {
        // process.execPath = VS Code's bundled Node.js (correct per vscode API docs)
        return [new vscode.McpStdioServerDefinition(
          'Kotlin Jump',
          process.execPath,
          [context.asAbsolutePath('dist/server.js'), '--mcp', workspaceRoot],
          {},
          '1.0.0',
        )];
      },
    };
    context.subscriptions.push(
      vscode.lm.registerMcpServerDefinitionProvider('kotlin-jump', mcpProvider),
    );
  }
}

export async function deactivate(): Promise<void> {
  closeAllCachedZips();
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
