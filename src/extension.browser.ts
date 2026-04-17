// Browser entry point — omits Node.js-only features:
//   - JAR scanning (GradleSourcesScanner, MavenSourcesScanner, KotlinJarContentProvider)
//   - Test runner (KotlinTestController) and Android run / ADB commands
//   - MCP server definition provider (requires process.execPath)
// All pure-JS features work normally: navigation, highlighting, folding, chat.
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
import { buildAllowFilter } from './util/testFilter';
import * as IndexStore from './indexer/IndexStore';
import { runCodeLensAction } from './providers/CodeLensAction';
import { WhatsNewPanel } from './providers/WhatsNewPanel';
import { NullAssertionProvider } from './providers/NullAssertionProvider';
import { HexColorFoldingProvider } from './providers/HexColorFoldingProvider';
import { HexColorDocumentColorProvider } from './providers/HexColorDocumentColorProvider';
import { ApiLevelProvider } from './providers/ApiLevelProvider';
import { StringResourceIndex } from './indexer/StringResourceIndex';
import { ColorResourceIndex } from './indexer/ColorResourceIndex';
import { VersionCatalogIndex } from './indexer/VersionCatalogIndex';
import { StringResourceFoldingProvider } from './providers/StringResourceFoldingProvider';
import { StringResourceHoverProvider } from './providers/StringResourceHoverProvider';
import { StringResourceDefinitionProvider } from './providers/StringResourceDefinitionProvider';
import { StringXmlDefinitionProvider } from './providers/StringXmlDefinitionProvider';
import { RResourceIndex } from './indexer/RResourceIndex';
import { ColorFoldingProvider } from './providers/ColorFoldingProvider';
import { ConstValFoldingProvider } from './providers/ConstValFoldingProvider';
import { SuspendMarkerProvider } from './providers/SuspendMarkerProvider';
import { ResourceDiagnosticProvider } from './providers/ResourceDiagnosticProvider';
import { VersionCatalogHoverProvider } from './providers/VersionCatalogHoverProvider';
import { OverrideGutterProvider } from './providers/OverrideGutterProvider';
import { NavigationHistoryProvider } from './providers/NavigationHistoryProvider';
import { registerChatParticipant } from './ai/KotlinJumpChatParticipant';

const WORD_RE = /[A-Za-z_]\w*/;
const WEB_UNAVAILABLE = 'Not available in VS Code for the Web.';

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

  const usagesPanel = new FindUsagesPanel(index);
  const usagesView  = vscode.window.createTreeView('kotlinJump.findUsages', {
    treeDataProvider: usagesPanel,
    showCollapseAll:  true,
  });
  usagesPanel.attachTreeView(usagesView);

  vscode.commands.executeCommand('setContext', 'kotlinJump.findUsages.showTests', true);
  vscode.commands.executeCommand('setContext', 'kotlinJump.findUsages.showPreviews', true);

  const codeLens = new KotlinCodeLensProvider(index);

  context.subscriptions.push(
    log,
    statusBar,
    usagesPanel,
    usagesView,
    vscode.languages.registerDefinitionProvider(KT_JAVA, new KotlinDefinitionProvider(index, log)),
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

    vscode.commands.registerCommand('kotlin-jump.goToClassImpl',
      async (name: string, packageName: string) => {
        const CLASS_LIKE_SET = new Set(['class', 'dataClass', 'sealedClass', 'enum', 'object', 'interface', 'annotation']);
        clearPendingDeclNav();
        const parentCandidates = index.lookup(name).filter((e: { kind: string }) => CLASS_LIKE_SET.has(e.kind));
        const parentEntry = parentCandidates.find((e: { packageName?: string }) => e.packageName === packageName)
          ?? (parentCandidates.length === 1 ? parentCandidates[0] : undefined);
        const allow = buildAllowFilter(
          parentEntry?.uri.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath ?? '',
        );
        const rawImpls = index.lookupImplementations(name).filter((e: any) => allow(e.uri.path));
        const allParents = parentCandidates.filter((e: any) => allow(e.uri.path));
        const impls = allParents.length <= 1 ? rawImpls : rawImpls.filter((impl: { packageName: string }) =>
          impl.packageName === packageName ||
          !allParents.some((p: { packageName: string }) => p.packageName === impl.packageName)
        );
        if (impls.length === 0) return;
        const isAnon = (m: { name: string }) => m.name.startsWith('$anon$');
        const openImpl = async (m: { name: string; uri: vscode.Uri; line: number; character: number }) => {
          const selLen = isAnon(m) ? 0 : name.length;
          const doc = await vscode.workspace.openTextDocument(m.uri);
          const editor = await vscode.window.showTextDocument(doc, { preview: true });
          const start = new vscode.Position(m.line, m.character);
          const end = new vscode.Position(m.line, m.character + selLen);
          const selection = new vscode.Selection(start, end);
          editor.selection = selection;
          editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        };
        if (impls.length === 1) {
          await openImpl(impls[0]);
          return;
        }
        const items = impls.map((m: { name: string; fqn: string; uri: vscode.Uri; line: number; character: number }) => ({
          label:  isAnon(m)
            ? `Anonymous object (line ${m.line + 1})`
            : m.fqn.split('.').slice(-2).join('.'),
          detail: m.uri.path.split('/').pop(),
          impl:   m,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Go to implementation of ${name}`,
        });
        if (picked) {
          await openImpl((picked as any).impl);
        }
      },
    ),

    vscode.commands.registerCommand('kotlin-jump.goToMethodImpl',
      async (uri: vscode.Uri, line: number, name: string, _implUriStrings: string[]) => {
        clearPendingDeclNav();
        const allow = buildAllowFilter(uri.fsPath);
        const impls = index.lookupMethodImplementations(name, uri.toString(), line).filter((e: any) => allow(e.uri.path));
        if (impls.length === 0) return;

        if (impls.length === 1) {
          const m = impls[0];
          await vscode.commands.executeCommand('vscode.open', m.uri, {
            preview: true,
            selection: new vscode.Range(m.line, m.character, m.line, m.character + name.length),
          } as vscode.TextDocumentShowOptions);
          return;
        }

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
        await vscode.commands.executeCommand('editor.action.goToReferences');
      } else if (!smartNav && args) {
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
      const filePath = uri.path;
      const basename = filePath.split('/').pop() ?? '';
      const ext = basename.endsWith('.java') ? '.java' : '.kt';
      const nameNoExt = basename.replace(/\.(kt|java)$/, '');

      const isTest = nameNoExt.endsWith('Test');
      const targetName = isTest
        ? nameNoExt.slice(0, -4) + ext
        : nameNoExt + 'Test' + ext;

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

  const cfg         = vscode.workspace.getConfiguration('kotlinJump');
  const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
  const maxFiles    = cfg.get<number>('maxIndexedFiles') ?? 10000;

  const [gradleModules, { moduleMap: jsonModules, sourceRoots }, allUris] = await Promise.all([
    resolveModules(),
    readProjectConfigs(),
    vscode.workspace.findFiles('**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles),
  ]);

  const moduleMap = new Map([...jsonModules, ...gradleModules]);
  log.info(`[moduleMap] ${moduleMap.size} module(s) from settings.gradle + kotlin-jump.json`);

  const scanner = new FileScanner(index, log, moduleMap);

  const watcher = new FileWatcher(scanner, index, uri => {
    _semanticTokens?.invalidate(uri.toString());
    codeLens.evictFile(uri.toString());
    _signatureHelp?.evictFile(uri.toString());
    invalidateContentCache(uri.toString());
  }, log);
  context.subscriptions.push(watcher, { dispose: () => scanner.destroy() });

  // ── String Resource Folding ────────────────────────────────────────────────
  const stringIndex = new StringResourceIndex();
  context.subscriptions.push((() => {
    const foldingProvider = new StringResourceFoldingProvider(stringIndex, log);

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

    vscode.workspace.findFiles(
      '**/res/values*/strings.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => {
      log.info(`[StringFolding] found ${uris.length} strings.xml file(s)`);
      return Promise.all(uris.map(async u => {
        const bytes = await vscode.workspace.fs.readFile(u);
        stringIndex.reindexFile(u, new TextDecoder().decode(bytes));
      }));
    }).then(() => {
      foldingProvider.invalidateAll();
    });

    if (vscode.window.activeTextEditor) foldingProvider.invalidateAll();

    const handleChanged = async (uri: vscode.Uri) => {
      const bytes = await vscode.workspace.fs.readFile(uri);
      stringIndex.reindexFile(uri, new TextDecoder().decode(bytes));
      foldingProvider.invalidateAll();
    };
    const handleDeleted = (uri: vscode.Uri) => {
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
        const c = vscode.workspace.getConfiguration('kotlinJump');
        c.update(
          'stringResourceFolding',
          !c.get<boolean>('stringResourceFolding', true),
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

  context.subscriptions.push(new NullAssertionProvider());
  context.subscriptions.push(new HexColorFoldingProvider());
  context.subscriptions.push(
    vscode.languages.registerColorProvider(KT_JAVA, new HexColorDocumentColorProvider()),
  );

  (() => {
    const apiProvider = new ApiLevelProvider();
    context.subscriptions.push(
      apiProvider,
      vscode.languages.registerInlayHintsProvider(KT_JAVA, apiProvider),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.apiLevelInlayHints')) {
          apiProvider.fireChange();
        }
      }),
    );
  })();

  context.subscriptions.push(new ConstValFoldingProvider(index));
  context.subscriptions.push(new NavigationHistoryProvider());

  (() => {
    const sp = new SuspendMarkerProvider(index);
    context.subscriptions.push(
      sp,
      vscode.languages.registerInlayHintsProvider(KT_JAVA, sp),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.suspendCallMarkers')) sp.fireChange();
      }),
    );
  })();

  const colorIndex = new ColorResourceIndex();
  (() => {
    const colorProvider = new ColorFoldingProvider(colorIndex);
    const resourceDiag  = new ResourceDiagnosticProvider(stringIndex, colorIndex);

    const handleColorChanged = async (uri: vscode.Uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        colorIndex.reindexFile(uri, new TextDecoder().decode(bytes));
        colorProvider.invalidateAll();
        resourceDiag.invalidateAll();
      } catch { /* skip */ }
    };

    vscode.workspace.findFiles(
      '**/res/values*/colors.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => Promise.all(uris.map(handleColorChanged)));

    const cW1 = vscode.workspace.createFileSystemWatcher('**/res/values/colors.xml');
    const cW2 = vscode.workspace.createFileSystemWatcher('**/res/values-*/colors.xml');
    for (const w of [cW1, cW2]) {
      w.onDidCreate(handleColorChanged);
      w.onDidChange(handleColorChanged);
      w.onDidDelete(uri => { colorIndex.removeFile(uri); colorProvider.invalidateAll(); resourceDiag.invalidateAll(); });
    }

    context.subscriptions.push(colorProvider, resourceDiag, cW1, cW2);
  })();

  (() => {
    const vcIndex = new VersionCatalogIndex();
    const GRADLE_FILES = [{ language: 'kotlin' }, { language: 'groovy' }];

    const handleTomlChanged = async (uri: vscode.Uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        vcIndex.reindexFile(new TextDecoder().decode(bytes));
      } catch { /* skip */ }
    };

    vscode.workspace.findFiles('**/gradle/libs.versions.toml').then(uris => {
      void Promise.all(uris.map(handleTomlChanged));
    });

    const tomlW = vscode.workspace.createFileSystemWatcher('**/gradle/libs.versions.toml');
    tomlW.onDidCreate(handleTomlChanged);
    tomlW.onDidChange(handleTomlChanged);
    tomlW.onDidDelete(() => vcIndex.reindexFile(''));

    context.subscriptions.push(
      tomlW,
      vscode.languages.registerHoverProvider(GRADLE_FILES, new VersionCatalogHoverProvider(vcIndex)),
    );
  })();

  (() => {
    const overrideProvider = new OverrideGutterProvider(index);
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(KT_JAVA, overrideProvider),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.overrideGutterIcons')) overrideProvider.fireChange();
      }),
    );
  })();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'kotlin-jump.revealDefinitionAt',
      async (uri: vscode.Uri, position: vscode.Position) => {
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeDefinitionProvider',
          uri,
          position,
        );
        if (!locs?.length) return;
        const loc = locs[0];
        await vscode.commands.executeCommand('vscode.open', loc.uri, {
          preview: true,
          selection: loc.range,
        } as vscode.TextDocumentShowOptions);
      },
    ),
  );

  // ── Commands (desktop-only features registered as no-ops) ─────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.runTest', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.runTestClass', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.debugTest', () => { /* removed */ }),
    vscode.commands.registerCommand('kotlin-jump.copyFqn', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'kotlin') return;

      const doc = editor.document;
      const wordRange = doc.getWordRangeAtPosition(editor.selection.active, WORD_RE);
      if (!wordRange) { vscode.window.showInformationMessage('No symbol at cursor.'); return; }

      const word = doc.getText(wordRange);

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

      const c = vscode.workspace.getConfiguration('kotlinJump.organizeImports');
      const removeUnused = c.get<boolean>('removeUnused', true);
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
    vscode.commands.registerCommand('kotlin-jump.moveFile', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.reindex', async () => {
      statusBar.text    = '$(sync~spin) Kotlin Jump: re-indexing…';
      statusBar.tooltip = 'Kotlin Jump is rebuilding the symbol index';
      scanner.cancel();
      index.clear();
      clearContentCache();
      await scanner.scanAll();
      const freshUris = await vscode.workspace.findFiles(
        '**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles,
      );
      await collectStats(freshUris);
      const { files, symbols } = index.stats();
      statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
      statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files`;
      codeLens.refresh();
    }),
    vscode.commands.registerCommand('kotlin-jump.runAndroid', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.switchAndroidApp', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.resetAndroidRunConfig', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.connectAdbWifi', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.pairAdbWifi', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
  );

  const t0 = Date.now();

  const visibleUris = vscode.window.visibleTextEditors
    .map(e => e.document.uri)
    .filter(u => /\.(kt|kts|java)$/.test(u.path));

  const [snapshot] = await Promise.all([
    _snapshotEnabled ? IndexStore.load(context) : Promise.resolve(null),
    ...visibleUris.map(u => scanner.scanFile(u)),
  ]);

  if (snapshot) {
    IndexStore.restore(snapshot, index);
    if (visibleUris.length > 0) {
      await Promise.all(visibleUris.map(u => scanner.scanFile(u)));
      log.info(`[startup] priority scan re-applied over snapshot for ${visibleUris.length} visible editor(s)`);
    }
    codeLens.refresh();

    const { files, symbols } = index.stats();
    log.info(`[startup] snapshot restored: ${symbols.toLocaleString()} symbols in ${files} files`);
    statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
    statusBar.tooltip = `Restored from snapshot: ${symbols.toLocaleString()} symbols in ${files} files`;

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
    log.info(`[startup] no snapshot — full scan of ${allUris.length} files`);
    await scanner.scanAll();
    codeLens.refresh();
    await collectStats(allUris);
  }

  const elapsed = Date.now() - t0;
  const { files, symbols } = index.stats();
  statusBar.text    = `$(symbol-class) Kotlin Jump: ${symbols.toLocaleString()} symbols`;
  statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files — ${elapsed}ms`;
  log.info(`Index ready: ${symbols} symbols in ${files} files (${elapsed}ms)`);
  _semanticTokens?.invalidate();

  registerChatParticipant(context, index);
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
