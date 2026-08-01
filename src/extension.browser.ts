// Browser entry point — omits Node.js-only features:
//   - JAR scanning (GradleSourcesScanner, MavenSourcesScanner, KotlinJarContentProvider)
//   - Test runner (KotlinTestController) and Android run / ADB commands
//   - Logcat (LogcatService: child_process adb, fs, readline). Commands are
//     stubbed WEB_UNAVAILABLE and the 2 declared views get static placeholders
//     (src/browser/logcat-web-placeholder.ts), same pattern as Android Run
//   - MCP server definition provider (requires process.execPath)
//   - Drawable gutter thumbnail icon (DrawableXmlInlinePreviewProvider's
//     always-visible <vector> gutter icon, and its R.drawable.* sibling
//     DrawableGutterThumbnailProvider) — needs a node:fs disk cache because
//     VS Code's gutterIconPath requires an on-disk file, not a data: URI.
//     The hover-popup half of both (data: URI, no disk cache) is web-enabled:
//     DrawableXmlHoverProvider.ts, DrawableHoverProvider.ts.
// All pure-JS features work normally: navigation, highlighting, folding, chat,
// inline feature toggles, drawable hover + vector preview, inlay navigation,
// Move File, and bundled Kotlin stdlib navigation (a prebuilt JSON index,
// see src/kotlin/BundledStdlibProvider.ts, not the raw JAR).
import * as vscode from 'vscode';
import * as path from 'path';
import { SymbolIndex } from './indexer/SymbolIndex';
import { FileScanner } from './indexer/FileScanner';
import { FileWatcher } from './watcher/FileWatcher';
import { KotlinDefinitionProvider, getPendingDeclNav, clearPendingDeclNav, navigateFromInlay, isInlayNavSuppressed } from './providers/DefinitionProvider';
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
import { mapBatched } from './util/batched';
import { makeExclusionMatcher } from './util/pathExclusion';
import { resolveCompanionMode } from './util/companionMode';
import { resolveAll as resolveModules } from './gradle/ModuleResolver';
import { resolveBest } from './util/ImportResolver';
import { readProjectConfigs } from './util/ProjectConfig';
import { buildAllowFilter } from './util/testFilter';
import * as IndexStore from './indexer/IndexStore';
import { runCodeLensAction } from './providers/CodeLensAction';
import { WhatsNewPanel } from './providers/WhatsNewPanel';
import { RatingPromptService } from './ui/RatingPromptService';
import { NullAssertionProvider } from './providers/NullAssertionProvider';
import { UnusedParameterProvider, UnusedParameterCodeActionProvider } from './providers/UnusedParameterProvider';
import { UnusedDeclarationProvider, UnusedDeclarationCodeActionProvider } from './providers/UnusedDeclarationProvider';
import { UnusedLocalProvider, UnusedLocalCodeActionProvider } from './providers/UnusedLocalProvider';
import { WriteOnlyProvider, WriteOnlyCodeActionProvider } from './providers/WriteOnlyProvider';
import { UnusedResourceProvider } from './providers/UnusedResourceProvider';
import { ResourceCorpus } from './indexer/ResourceCorpus';
import { findUnusedResourcesCommand } from './commands/FindUnusedResources';
import { UnusedResourceKeyProvider } from './providers/UnusedResourceKeyProvider';
import { UnusedSymbolProvider } from './providers/UnusedSymbolProvider';
import { UnheardEventProvider } from './providers/UnheardEventProvider';
import { UnusedEnumEntryProvider } from './providers/UnusedEnumEntryProvider';
import { UnusedRemoteConfigKeyProvider } from './providers/UnusedRemoteConfigKeyProvider';
import { UnusedGradleDependencyProvider } from './providers/UnusedGradleDependencyProvider';
import { UnusedMemberProvider } from './providers/UnusedMemberProvider';
import { findUnusedMembersCommand } from './commands/FindUnusedMembers';
import { DeadIslandProvider } from './providers/DeadIslandProvider';
import { findDeadIslandsCommand } from './commands/FindDeadIslands';
import { UnusedDtoFieldProvider } from './providers/UnusedDtoFieldProvider';
import { WriteOnlyKeyProvider } from './providers/WriteOnlyKeyProvider';
import {
  findUnusedDtoFieldsCommand,
  findWriteOnlyKeysCommand,
} from './commands/FindWriteOnlyKeys';
import { findUnusedGradleDependenciesCommand } from './commands/FindUnusedGradleDependencies';
import {
  findUnusedRemoteConfigKeysCommand,
  removeAllUnusedRemoteConfigKeysCommand,
} from './commands/FindUnusedRemoteConfigKeys';
import { findUnusedEnumEntriesCommand } from './commands/FindUnusedEnumEntries';
import {
  createEventSubscriberCommand,
  findUnheardEventsCommand,
} from './commands/FindUnheardEvents';
import { findEverythingUnusedCommand } from './commands/FindEverythingUnused';
import {
  findUnusedSymbolsCommand,
  removeAllUnusedSymbolsCommand,
} from './commands/FindUnusedSymbols';
import {
  findUnusedResourceKeysCommand,
  removeAllUnusedResourceKeysCommand,
} from './commands/FindUnusedResourceKeys';
import {
  DeadCodeSweepReport,
  cleanDeadCodeInFileCommand,
  cleanDeadCodeInWorkspaceCommand,
  findDeadCodeCommand,
} from './commands/DeadCodeSweep';
import { TodoExpiryProvider } from './providers/TodoExpiryProvider';
import { ManifestPermissionProvider } from './providers/ManifestPermissionProvider';
import { HexColorFoldingProvider } from './providers/HexColorFoldingProvider';
import { HexColorDocumentColorProvider } from './providers/HexColorDocumentColorProvider';
import { ApiLevelProvider } from './providers/ApiLevelProvider';
import { StringResourceIndex } from './indexer/StringResourceIndex';
import { ColorResourceIndex } from './indexer/ColorResourceIndex';
import { DimenResourceIndex } from './indexer/DimenResourceIndex';
import { DimenResourceDefinitionProvider } from './providers/DimenResourceDefinitionProvider';
import { DimenXmlDefinitionProvider } from './providers/DimenXmlDefinitionProvider';
import { VersionCatalogIndex } from './indexer/VersionCatalogIndex';
import { StringResourceFoldingProvider } from './providers/StringResourceFoldingProvider';
import { StringResourceHoverProvider } from './providers/StringResourceHoverProvider';
import { StringResourceDefinitionProvider } from './providers/StringResourceDefinitionProvider';
import { StringXmlDefinitionProvider } from './providers/StringXmlDefinitionProvider';
import { ColorXmlDefinitionProvider } from './providers/ColorXmlDefinitionProvider';
import { DrawableResourceDefinitionProvider } from './providers/DrawableResourceDefinitionProvider';
import { DrawableXmlDefinitionProvider } from './providers/DrawableXmlDefinitionProvider';
import { RResourceIndex } from './indexer/RResourceIndex';
import { ColorFoldingProvider } from './providers/ColorFoldingProvider';
import { ColorResourceDefinitionProvider } from './providers/ColorResourceDefinitionProvider';
import { ConstValFoldingProvider } from './providers/ConstValFoldingProvider';
import { SuspendMarkerProvider } from './providers/SuspendMarkerProvider';
import { ComposeA11yProvider } from './providers/ComposeA11yProvider';
import { FlowChainProvider } from './providers/FlowChainProvider';
import { LiteralTooltipProvider } from './providers/LiteralTooltipProvider';
import { KmpExpectActualProvider, showActuals } from './providers/KmpExpectActualProvider';
import { DataClassFieldProvider } from './providers/DataClassFieldProvider';
import { ResourceDiagnosticProvider } from './providers/ResourceDiagnosticProvider';
import { VersionCatalogHoverProvider } from './providers/VersionCatalogHoverProvider';
import { OverrideGutterProvider } from './providers/OverrideGutterProvider';
import { NavigationHistoryProvider } from './providers/NavigationHistoryProvider';
import { SuppressHoverProvider } from './providers/SuppressHoverProvider';
import { PermissionHoverProvider } from './providers/PermissionHoverProvider';
import { DeprecationHoverProvider } from './providers/DeprecationHoverProvider';
import { DrawableResourceIndex } from './indexer/DrawableResourceIndex';
import { DrawableHoverProvider } from './providers/DrawableHoverProvider';
import { DrawableXmlPreviewPanel, DrawableXmlPreviewLensProvider } from './providers/DrawableXmlPreviewPanel';
import { registerInlineFeatureToggles } from './commands/InlineFeatureToggles';
import { SealedWhenCoverageProvider } from './providers/SealedWhenCoverageProvider';
import { registerAddMissingWhenBranches } from './commands/addMissingWhenBranches';
import { registerChatParticipant } from './ai/KotlinJumpChatParticipant';
import { LogcatDevicesWebPlaceholderProvider, LogcatWebviewPlaceholderProvider } from './browser/logcat-web-placeholder';
import { inferPackage, buildMoveEdit } from './providers/MoveFileProvider';
import { BundledStdlibProvider } from './kotlin/BundledStdlibProvider';
import { BundledStdlibFsProvider, KOTLIN_STDLIB_JAR_SCHEME } from './providers/BundledStdlibFsProvider';
import { DrawableXmlHoverProvider } from './providers/DrawableXmlHoverProvider';

const WORD_RE = /[A-Za-z_]\w*/;
const WEB_UNAVAILABLE = 'Not available in VS Code for the Web.';

let _index:            SymbolIndex | undefined;
let _context:          vscode.ExtensionContext | undefined;
let _stats:            Map<string, { mtime: number; size: number }> = new Map();
let _semanticTokens:   KotlinSemanticTokensProvider | undefined;
let _sealedWhen:       SealedWhenCoverageProvider | undefined;
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

  // Only ask for a rating on a steady-state activation, never in the same
  // tick as the "Kotlin Jump updated to vX" toast above — stacking two
  // info messages right after an update is exactly the noisy UX this
  // extension avoids everywhere else.
  if (lastSeen === version) {
    void RatingPromptService.maybePrompt(context, undefined, false);
  }

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
    ...(!isCompanion ? [vscode.languages.registerHoverProvider(KT_JAVA, new SuppressHoverProvider())] : []),
    ...(!isCompanion ? [vscode.languages.registerHoverProvider(
      [...KT_JAVA, { language: 'xml' }], new PermissionHoverProvider(),
    )] : []),
    ...(!isCompanion ? [vscode.languages.registerHoverProvider(KT_JAVA, new DeprecationHoverProvider(index))] : []),
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

    // Inlay-hint navigation wrapper — same wiring as extension.ts. Without
    // it, clicking any inlay hint on vscode.dev errors with "command not
    // found" even though the hints themselves render fine.
    vscode.commands.registerCommand('kotlin-jump._navigateInlay', navigateFromInlay),

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
        const sortedImpls = [...impls].sort((a: { name: string }, b: { name: string }) => {
          const aAnon = isAnon(a);
          const bAnon = isAnon(b);
          if (aAnon !== bAnon) return aAnon ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
        const items = sortedImpls.map((m: { name: string; fqn: string; uri: vscode.Uri; line: number; character: number }) => ({
          label:       isAnon(m) ? `Anonymous object (line ${m.line + 1})` : m.name,
          description: isAnon(m) ? undefined : m.fqn.split('.').slice(0, -1).join('.'),
          detail:      m.uri.path.split('/').pop(),
          impl:        m,
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

        const sortedImpls = [...impls].sort((a, b) => a.name.localeCompare(b.name));
        const items = sortedImpls.map(m => ({
          label:       m.name,
          description: m.fqn.split('.').slice(0, -1).join('.'),
          detail:      m.uri.path.split('/').pop(),
          impl:        m,
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
          placeHolder: `Multiple matches. Pick ${isTest ? 'implementation' : 'test'} file`,
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
          placeHolder: `Multiple matches. Pick ${isComposable ? 'preview' : 'composable'}`,
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
      // Inlay-hint navigation just landed (or is in flight): suppress the
      // smart-nav consumption entirely during the post-nav race window.
      // Same guard as extension.ts — without it, clicking an inlay hint
      // on vscode.dev opened the References peek on top of the navigation.
      if (isInlayNavSuppressed()) {
        clearPendingDeclNav();
        return;
      }
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
  const isExcludedPath = makeExclusionMatcher(excludeList);
  const maxFiles    = cfg.get<number>('maxIndexedFiles') ?? 10000;

  const [gradleModules, { moduleMap: jsonModules, sourceRoots }, allUris] = await Promise.all([
    resolveModules(),
    readProjectConfigs(),
    vscode.workspace.findFiles('**/*.{kt,kts,java}', `{${excludeList.join(',')}}`, maxFiles),
  ]);

  const moduleMap = new Map([...jsonModules, ...gradleModules]);
  log.info(`[moduleMap] ${moduleMap.size} module(s) from settings.gradle + kotlin-jump.json`);

  // Bundled Kotlin stdlib: a prebuilt JSON index (not the raw .jar, no zip
  // library on the web), so List/String/Sequence/etc. resolve from the first
  // moment a Kotlin file opens, even offline. See BundledStdlibProvider.ts.
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      KOTLIN_STDLIB_JAR_SCHEME, new BundledStdlibFsProvider(), { isReadonly: true, isCaseSensitive: true },
    ),
  );
  const bundledStdlib = new BundledStdlibProvider(index, log, context.extensionUri);
  void bundledStdlib.load().catch((e: Error) => log.warn(`[bundled-stdlib] ${e.message}`));

  const scanner = new FileScanner(index, log, moduleMap);

  const watcher = new FileWatcher(scanner, index, uri => {
    _semanticTokens?.invalidate(uri.toString());
    codeLens.evictFile(uri.toString());
    _signatureHelp?.evictFile(uri.toString());
    invalidateContentCache(uri.toString());
    _sealedWhen?.bumpEpoch(); // sealed subtype sets may have changed in any file
  }, log, uris => {
    for (const uri of uris) {
      _semanticTokens?.invalidate(uri.toString());
      codeLens.evictFile(uri.toString());
      _signatureHelp?.evictFile(uri.toString());
      invalidateContentCache(uri.toString());
    }
    _sealedWhen?.bumpEpoch();
  }, isExcludedPath);
  context.subscriptions.push(watcher, { dispose: () => scanner.destroy() });

  // ── String Resource Folding ────────────────────────────────────────────────
  const stringIndex = new StringResourceIndex();
  // Lifted to function scope so later blocks (R.dimen navigation) can
  // reuse it for the XML → Kotlin direction without a second index.
  const rIndex = new RResourceIndex();
  context.subscriptions.push((() => {
    const foldingProvider = new StringResourceFoldingProvider(stringIndex, log);

    // Bounded concurrency, same rationale as the desktop entrypoint.
    void mapBatched(allUris, async u => {
      try {
        const bytes = await vscode.workspace.fs.readFile(u);
        rIndex.reindexFile(u.toString(), new TextDecoder().decode(bytes));
      } catch { /* skip unreadable files */ }
    });
    const rW = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts,java}');
    // Same quiet-window batching as the desktop entrypoint: no per-event
    // concurrent reads during a checkout storm.
    const rPending = new Set<string>();
    let rTimer: ReturnType<typeof setTimeout> | undefined;
    const handleRChanged = (uri: vscode.Uri) => {
      if (isExcludedPath(uri.path)) return; // ignore build/ .gradle/ churn
      rPending.add(uri.toString());
      if (rTimer) clearTimeout(rTimer);
      rTimer = setTimeout(async () => {
        rTimer = undefined;
        const pending = [...rPending];
        rPending.clear();
        for (const uriStr of pending) {
          try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uriStr));
            rIndex.reindexFile(uriStr, new TextDecoder().decode(bytes));
          } catch { /* skip */ }
        }
      }, 300);
    };
    rW.onDidChange(handleRChanged);
    rW.onDidCreate(handleRChanged);
    rW.onDidDelete(uri => { rPending.delete(uri.toString()); rIndex.removeFile(uri.toString()); });

    vscode.workspace.findFiles(
      '**/res/values*/strings.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => {
      log.info(`[StringFolding] found ${uris.length} strings.xml file(s)`);
      return mapBatched(uris, async u => {
        const bytes = await vscode.workspace.fs.readFile(u);
        stringIndex.reindexFile(u, new TextDecoder().decode(bytes));
      });
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
      vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        new ColorXmlDefinitionProvider(rIndex),
      ),
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new DrawableResourceDefinitionProvider(),
      ),
      vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        new DrawableXmlDefinitionProvider(rIndex),
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
  context.subscriptions.push(new TodoExpiryProvider());
  // KJ-025 : regex only, no Node dependency → wired in the web build too
  context.subscriptions.push(
    new UnusedParameterProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new UnusedParameterCodeActionProvider(),
      { providedCodeActionKinds: UnusedParameterCodeActionProvider.providedCodeActionKinds },
    ),
  );
  // KJ-026 : same, regex only
  context.subscriptions.push(
    new UnusedDeclarationProvider(),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'kotlin' }, { language: 'java' }],
      new UnusedDeclarationCodeActionProvider(),
      { providedCodeActionKinds: UnusedDeclarationCodeActionProvider.providedCodeActionKinds },
    ),
  );
  // KJ-027 : same, regex only
  context.subscriptions.push(
    new UnusedLocalProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new UnusedLocalCodeActionProvider(),
      { providedCodeActionKinds: UnusedLocalCodeActionProvider.providedCodeActionKinds },
    ),
  );
  // KJ-028 : same, regex only
  context.subscriptions.push(
    new WriteOnlyProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new WriteOnlyCodeActionProvider(),
      { providedCodeActionKinds: WriteOnlyCodeActionProvider.providedCodeActionKinds },
    ),
  );
  // KJ-029 : workspace scan through vscode APIs only, so the web build too
  const unusedResourceProviderWeb = new UnusedResourceProvider();
  const resourceCorpusWeb = new ResourceCorpus();
  const deadCodeSweepReportWeb = new DeadCodeSweepReport();
  const unusedResourceKeyProviderWeb = new UnusedResourceKeyProvider();
  const unusedSymbolProviderWeb = new UnusedSymbolProvider();
  const unheardEventProviderWeb = new UnheardEventProvider();
  const unusedEnumEntryProviderWeb = new UnusedEnumEntryProvider();
  const remoteConfigKeyProviderWeb = new UnusedRemoteConfigKeyProvider();
  const gradleDependencyProviderWeb = new UnusedGradleDependencyProvider();
  const unusedMemberProviderWeb = new UnusedMemberProvider();
  const deadIslandProviderWeb = new DeadIslandProvider();
  const unusedDtoFieldProviderWeb = new UnusedDtoFieldProvider();
  const writeOnlyKeyProviderWeb = new WriteOnlyKeyProvider();
  context.subscriptions.push(
    unusedResourceProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/res/**' },
      unusedResourceProviderWeb,
      { providedCodeActionKinds: UnusedResourceProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedResources', () =>
      findUnusedResourcesCommand(resourceCorpusWeb, unusedResourceProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedResources', () =>
      unusedResourceProviderWeb.clear(),
    ),
    deadCodeSweepReportWeb,
    vscode.commands.registerCommand('kotlin-jump.findDeadCode', () =>
      findDeadCodeCommand(deadCodeSweepReportWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.cleanDeadCodeInFile', () =>
      cleanDeadCodeInFileCommand(),
    ),
    vscode.commands.registerCommand('kotlin-jump.cleanDeadCodeInWorkspace', () =>
      cleanDeadCodeInWorkspaceCommand(),
    ),
    unusedResourceKeyProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/res/values*/*.xml' },
      unusedResourceKeyProviderWeb,
      { providedCodeActionKinds: UnusedResourceKeyProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedResourceKeys', () =>
      findUnusedResourceKeysCommand(resourceCorpusWeb, unusedResourceKeyProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedResourceKeys', () =>
      unusedResourceKeyProviderWeb.clear(),
    ),
    vscode.commands.registerCommand('kotlin-jump.removeAllUnusedResourceKeys', () =>
      removeAllUnusedResourceKeysCommand(resourceCorpusWeb, unusedResourceKeyProviderWeb),
    ),
    unusedSymbolProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedSymbolProviderWeb,
      { providedCodeActionKinds: UnusedSymbolProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedSymbols', () =>
      findUnusedSymbolsCommand(resourceCorpusWeb, unusedSymbolProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedSymbols', () =>
      unusedSymbolProviderWeb.clear(),
    ),
    vscode.commands.registerCommand('kotlin-jump.removeAllUnusedSymbols', () =>
      removeAllUnusedSymbolsCommand(resourceCorpusWeb, unusedSymbolProviderWeb),
    ),
    unheardEventProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unheardEventProviderWeb,
      { providedCodeActionKinds: UnheardEventProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      unheardEventProviderWeb,
      { providedCodeActionKinds: UnheardEventProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnheardEvents', () =>
      findUnheardEventsCommand(resourceCorpusWeb, unheardEventProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnheardEvents', () =>
      unheardEventProviderWeb.clear(),
    ),
    vscode.commands.registerCommand('kotlinJump.createEventSubscriber', (name: string, fqn: string) =>
      createEventSubscriberCommand(name, fqn),
    ),
    unusedEnumEntryProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedEnumEntryProviderWeb,
      { providedCodeActionKinds: UnusedEnumEntryProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      unusedEnumEntryProviderWeb,
      { providedCodeActionKinds: UnusedEnumEntryProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedEnumEntries', () =>
      findUnusedEnumEntriesCommand(resourceCorpusWeb, unusedEnumEntryProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedEnumEntries', () =>
      unusedEnumEntryProviderWeb.clear(),
    ),
    remoteConfigKeyProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/res/xml*/*.xml' },
      remoteConfigKeyProviderWeb,
      { providedCodeActionKinds: UnusedRemoteConfigKeyProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedRemoteConfigKeys', () =>
      findUnusedRemoteConfigKeysCommand(resourceCorpusWeb, remoteConfigKeyProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.removeAllUnusedRemoteConfigKeys', () =>
      removeAllUnusedRemoteConfigKeysCommand(resourceCorpusWeb, remoteConfigKeyProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedRemoteConfigKeys', () =>
      remoteConfigKeyProviderWeb.clear(),
    ),
    gradleDependencyProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/*.versions.toml' },
      gradleDependencyProviderWeb,
      { providedCodeActionKinds: UnusedGradleDependencyProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedGradleDependencies', () =>
      findUnusedGradleDependenciesCommand(resourceCorpusWeb, gradleDependencyProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedGradleDependencies', () =>
      gradleDependencyProviderWeb.clear(),
    ),
    unusedMemberProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedMemberProviderWeb,
      { providedCodeActionKinds: UnusedMemberProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      unusedMemberProviderWeb,
      { providedCodeActionKinds: UnusedMemberProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedMembers', () =>
      findUnusedMembersCommand(resourceCorpusWeb, unusedMemberProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedMembers', () =>
      unusedMemberProviderWeb.clear(),
    ),
    deadIslandProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      deadIslandProviderWeb,
      { providedCodeActionKinds: DeadIslandProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      deadIslandProviderWeb,
      { providedCodeActionKinds: DeadIslandProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findDeadIslands', () =>
      findDeadIslandsCommand(resourceCorpusWeb, deadIslandProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearDeadIslands', () =>
      deadIslandProviderWeb.clear(),
    ),
    unusedDtoFieldProviderWeb,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedDtoFieldProviderWeb,
      { providedCodeActionKinds: UnusedDtoFieldProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedDtoFields', () =>
      findUnusedDtoFieldsCommand(resourceCorpusWeb, unusedDtoFieldProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedDtoFields', () =>
      unusedDtoFieldProviderWeb.clear(),
    ),
    writeOnlyKeyProviderWeb,
    vscode.commands.registerCommand('kotlin-jump.findWriteOnlyKeys', () =>
      findWriteOnlyKeysCommand(resourceCorpusWeb, writeOnlyKeyProviderWeb),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearWriteOnlyKeys', () =>
      writeOnlyKeyProviderWeb.clear(),
    ),
    vscode.commands.registerCommand('kotlin-jump.findEverythingUnused', () =>
      findEverythingUnusedCommand(
        resourceCorpusWeb,
        deadCodeSweepReportWeb,
        unusedSymbolProviderWeb,
        unusedResourceKeyProviderWeb,
        unusedResourceProviderWeb,
        unheardEventProviderWeb,
        unusedEnumEntryProviderWeb,
        remoteConfigKeyProviderWeb,
        gradleDependencyProviderWeb,
        unusedMemberProviderWeb,
        deadIslandProviderWeb,
      ),
    ),
  );
  context.subscriptions.push(new ManifestPermissionProvider());
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

  (() => {
    const a11y = new ComposeA11yProvider();
    context.subscriptions.push(
      a11y,
      vscode.languages.registerInlayHintsProvider({ language: 'kotlin' }, a11y),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.composeAccessibilityHints')) a11y.fireChange();
      }),
    );
  })();

  (() => {
    const fc = new FlowChainProvider();
    context.subscriptions.push(
      fc,
      vscode.languages.registerInlayHintsProvider({ language: 'kotlin' }, fc),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.flowChainBadges')) fc.fireChange();
      }),
    );
  })();

  (() => {
    const lt = new LiteralTooltipProvider();
    context.subscriptions.push(
      lt,
      vscode.languages.registerInlayHintsProvider(KT_JAVA, lt),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.literalTooltips')) lt.fireChange();
      }),
    );
  })();

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'kotlin' }, new KmpExpectActualProvider(index)),
    vscode.commands.registerCommand('kotlin-jump.showActuals',
      (fqn: string, name: string) => showActuals(index, fqn, name)),
  );

  (() => {
    const df = new DataClassFieldProvider(index);
    context.subscriptions.push(
      df,
      vscode.languages.registerInlayHintsProvider({ language: 'kotlin' }, df),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.dataClassFieldWarnings')) df.fireChange();
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
    ).then(uris => mapBatched(uris, handleColorChanged));

    const cW1 = vscode.workspace.createFileSystemWatcher('**/res/values/colors.xml');
    const cW2 = vscode.workspace.createFileSystemWatcher('**/res/values-*/colors.xml');
    for (const w of [cW1, cW2]) {
      w.onDidCreate(handleColorChanged);
      w.onDidChange(handleColorChanged);
      w.onDidDelete(uri => { colorIndex.removeFile(uri); colorProvider.invalidateAll(); resourceDiag.invalidateAll(); });
    }

    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new ColorResourceDefinitionProvider(colorIndex),
      ),
    );

    context.subscriptions.push(colorProvider, resourceDiag, cW1, cW2);
  })();

  // ── R.dimen navigation ────────────────────────────────────────────────────
  (() => {
    const dimenIndex = new DimenResourceIndex();
    const handleDimenChanged = async (uri: vscode.Uri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        dimenIndex.reindexFile(uri, new TextDecoder().decode(bytes));
      } catch { /* skip */ }
    };
    vscode.workspace.findFiles(
      '**/res/values*/dimens.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => mapBatched(uris, handleDimenChanged));

    const dW1 = vscode.workspace.createFileSystemWatcher('**/res/values/dimens.xml');
    const dW2 = vscode.workspace.createFileSystemWatcher('**/res/values-*/dimens.xml');
    for (const w of [dW1, dW2]) {
      w.onDidCreate(handleDimenChanged);
      w.onDidChange(handleDimenChanged);
      w.onDidDelete(uri => dimenIndex.removeFile(uri));
    }

    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new DimenResourceDefinitionProvider(dimenIndex),
      ),
      vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        new DimenXmlDefinitionProvider(rIndex),
      ),
      dW1, dW2,
    );
  })();

  // ── R.drawable / R.mipmap — hover preview + vector side panel ─────────────
  // Web subset of the desktop drawable block: gutter thumbnails and the
  // inline XML preview need a node:fs render cache, so only the pure-JS
  // pieces (hover, side panel webview, references CodeLens) ship here.
  (() => {
    const drawableIndex = new DrawableResourceIndex();

    const dwW1 = vscode.workspace.createFileSystemWatcher('**/res/drawable*/*');
    const dwW2 = vscode.workspace.createFileSystemWatcher('**/res/mipmap*/*');

    vscode.workspace.findFiles(
      '**/res/{drawable,mipmap}*/*.{xml,png,webp,svg,jpg,jpeg,gif,bmp}',
      `{${excludeList.join(',')}}`,
    ).then(uris => { for (const u of uris) drawableIndex.addFile(u); });

    for (const w of [dwW1, dwW2]) {
      w.onDidCreate(uri => drawableIndex.addFile(uri));
      w.onDidChange(uri => drawableIndex.addFile(uri));
      w.onDidDelete(uri => drawableIndex.removeFile(uri));
    }

    const sidePreview = new DrawableXmlPreviewPanel();
    // The lens provider owns an onDidSaveTextDocument subscription — keep the
    // instance so its dispose() runs (the registration alone doesn't call it).
    const previewLens = new DrawableXmlPreviewLensProvider(index);
    context.subscriptions.push(
      drawableIndex,
      sidePreview,
      previewLens,
      vscode.languages.registerHoverProvider(KT_JAVA, new DrawableHoverProvider(drawableIndex)),
      // <vector> hover popup only — no Node dependency (data: URI, no
      // gutter icon). The always-visible gutter icon half
      // (DrawableXmlInlinePreviewProvider) needs a disk cache and stays
      // desktop-only; see DrawableXmlHoverProvider.ts's header comment.
      vscode.languages.registerHoverProvider(
        { language: 'xml', pattern: '**/res/drawable*/*.xml' },
        new DrawableXmlHoverProvider(),
      ),
      vscode.languages.registerCodeLensProvider(
        { language: 'xml', pattern: '**/res/drawable*/*.xml' },
        previewLens,
      ),
      vscode.commands.registerCommand('kotlinJump.vectorPreview.show', () => sidePreview.show()),
      vscode.commands.registerCommand('kotlinJump.vectorPreview.close', () => sidePreview.close()),
      // Wrapper around `editor.action.showReferences` that auto-closes the
      // peek on first navigation — same contract as extension.ts.
      vscode.commands.registerCommand(
        'kotlinJump.vectorPreview.showRefsAutoClose',
        async (uri: vscode.Uri, pos: vscode.Position, locs: vscode.Location[]) => {
          const initialUri = vscode.window.activeTextEditor?.document.uri.toString();
          let listener: vscode.Disposable | undefined;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const cleanup = (): void => {
            listener?.dispose();
            listener = undefined;
            if (timeout) clearTimeout(timeout);
          };
          listener = vscode.window.onDidChangeActiveTextEditor(e => {
            if (!e || e.document.uri.toString() === initialUri) return;
            cleanup();
            void vscode.commands.executeCommand('closeReferenceSearch');
          });
          timeout = setTimeout(cleanup, 60_000);
          await vscode.commands.executeCommand(
            'editor.action.showReferences', uri, pos, locs,
          );
        },
      ),
      vscode.commands.registerCommand(
        'kotlinJump.vectorPreview.gotoSingleRef',
        async (uri: vscode.Uri, pos: vscode.Position) => {
          const sel = new vscode.Range(pos, pos);
          await vscode.commands.executeCommand('vscode.open', uri, {
            preview: false,
            selection: sel,
          } as vscode.TextDocumentShowOptions);
        },
      ),
      dwW1, dwW2,
    );
  })();

  // ── Inline feature toggles — buttons in editor/title + master toggle ──────
  // Shared with extension.ts (see InlineFeatureToggles.ts). These commands
  // back the always-visible editor toolbar buttons on Kotlin/Java files, so
  // skipping them on the web meant every button errored on vscode.dev.
  registerInlineFeatureToggles(context);

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

  // ── Sealed when coverage — ✓ N/N branches lens above when(sealed/enum) ────
  (() => {
    const sealedWhen = new SealedWhenCoverageProvider(index, log);
    _sealedWhen = sealedWhen;
    context.subscriptions.push(
      sealedWhen,
      vscode.languages.registerCodeLensProvider({ language: 'kotlin' }, sealedWhen),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.sealedWhenCoverage')) sealedWhen.fireChange();
      }),
    );
    registerAddMissingWhenBranches(context, index, log);
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
          placeHolder: `Multiple matches for ${word}. Pick the FQN to copy`,
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
    // Web-native implementation, not a straight port of the desktop command:
    // that version builds URIs with vscode.Uri.file(path.join(...)), which
    // forces the file: scheme regardless of the workspace's real scheme and
    // breaks on virtual workspaces (vscode-vfs:, github:). This one stays in
    // vscode.Uri end to end (Uri.joinPath instead of Uri.file(path.join(...))).
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
        defaultUri:       vscode.Uri.joinPath(doc.uri, '..'),
      });
      if (!dest || dest.length === 0) return;
      const destUri = dest[0];

      // Read-only workspace guard (e.g. Remote Repositories opened without
      // write access). undefined means "unknown scheme", left to proceed
      // rather than treated as a hard block.
      if (vscode.workspace.fs.isWritableFileSystem(destUri.scheme) === false) {
        vscode.window.showWarningMessage('Kotlin Jump: this workspace is read-only here, Move File is unavailable.');
        return;
      }

      const fileName = path.basename(doc.uri.fsPath);
      const newUri   = vscode.Uri.joinPath(destUri, fileName);
      if (newUri.toString() === doc.uri.toString()) return;

      const oldPkg = /^(?:\s*package\s+)([\w.]+)/m.exec(doc.getText())?.[1] ?? '';
      let newPkg = inferPackage(doc.uri.fsPath, destUri.fsPath, oldPkg, sourceRoots);

      if (newPkg === null) {
        const input = await vscode.window.showInputBox({
          prompt:        'New package name (could not be inferred from path)',
          value:         oldPkg,
          validateInput: v => /^[\w.]*$/.test(v) ? null : 'Invalid package name',
        });
        if (input === undefined) return;
        newPkg = input;
      }

      const edit = await buildMoveEdit(doc, newUri, newPkg, index);
      await vscode.workspace.applyEdit(edit);
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
    vscode.commands.registerCommand('kotlin-jump.sources.openActions', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.sources.downloadMissing', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.sources.refresh', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.diagnoseGradleDetection', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.resetGradleProject', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlin-jump.pickGradleProject', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.show', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.start', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.stop', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.pause', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.resume', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.clear', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.export', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.pickDevice', () => {
      vscode.window.showWarningMessage(`Kotlin Jump: ${WEB_UNAVAILABLE}`);
    }),
  );

  // Logcat views are declared in package.json but have no provider on the
  // web, so register static placeholders instead of leaving VS Code's generic
  // "no data provider registered" error. The context key gates viewsWelcome
  // for the tree view and is NEVER set in extension.ts (desktop), so it has
  // zero effect there.
  void vscode.commands.executeCommand('setContext', 'kotlinJump.logcat.webUnavailable', true);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('kotlinJump.logcat', new LogcatWebviewPlaceholderProvider()),
    vscode.window.registerTreeDataProvider('kotlinJump.logcat.devices', new LogcatDevicesWebPlaceholderProvider()),
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
  statusBar.tooltip = `${symbols.toLocaleString()} symbols in ${files} files (${elapsed}ms)`;
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
