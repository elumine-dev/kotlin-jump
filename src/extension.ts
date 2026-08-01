import * as vscode from 'vscode';
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
import { NamedArgumentsActionProvider } from './providers/NamedArgumentsActionProvider';
import { PostfixCompletionProvider } from './providers/PostfixCompletionProvider';
import { HardcodedStringProvider } from './providers/HardcodedStringProvider';
import { ExtractStringResourceProvider } from './providers/ExtractStringResourceProvider';
import { SurroundWithProvider, applySurround, surroundWithQuickPick } from './providers/SurroundWithProvider';
import { smartJoinLinesCommand, SmartJoinLinesProvider } from './commands/smartJoinLines';
import {
  LifecycleReleaseActionProvider,
  ExpiredTodoActionProvider,
  NullAssertionActionProvider,
  MissingWhenBranchesActionProvider,
} from './providers/DiscoverabilityQuickFixes';
import { recentLocationsCommand } from './commands/recentLocations';
import { UnusedImportProvider, UnusedImportCodeActionProvider } from './providers/UnusedImportProvider';
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
import { findEverythingUnusedCommand } from './commands/FindEverythingUnused';
import {
  createEventSubscriberCommand,
  findUnheardEventsCommand,
} from './commands/FindUnheardEvents';
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
import { MethodSeparatorProvider } from './providers/MethodSeparatorProvider';
import { AndroidProjectViewProvider } from './ui/AndroidProjectViewProvider';
import { ScreenFlowPanel } from './ui/ScreenFlowPanel';
import { StateProvenanceProvider } from './providers/StateProvenanceProvider';
import { ComposeOutlineProvider } from './providers/ComposeOutlineProvider';
import { probeSnapshot, probeTexts } from './util/demoProbe';
import { LifecyclePairingProvider } from './providers/LifecyclePairingProvider';
import { ResourceShadowingProvider } from './providers/ResourceShadowingProvider';
import { DispatcherLensProvider } from './providers/DispatcherLensProvider';
import { RoomMigrationProvider } from './providers/RoomMigrationProvider';
import { ResourceUsageBadgeProvider } from './providers/ResourceUsageBadgeProvider';
import { DependencyUsageBadgeProvider } from './providers/DependencyUsageBadgeProvider';
import { ManifestNecessityProvider } from './providers/ManifestNecessityProvider';
import { StringXmlHoverProvider } from './providers/StringXmlHoverProvider';
import { DeadWeightActionProvider } from './providers/DeadWeightActionProvider';
import { readSignature, parseParams } from './util/SignatureReader';
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
import { inferPackage, buildMoveEdit } from './providers/MoveFileProvider';
import * as path from 'path';
import * as IndexStore from './indexer/IndexStore';
import { KotlinJarContentProvider, KOTLIN_JAR_SCHEME, closeAllCachedZips } from './providers/KotlinJarContentProvider';
import { GradleSourcesScanner } from './gradle/GradleSourcesScanner';
import { JdkSourcesScanner }    from './jdk/JdkSourcesScanner';
import { BundledStdlibProvider } from './kotlin/BundledStdlibProvider';
import { BundledStdlibFsProvider, KOTLIN_STDLIB_JAR_SCHEME } from './providers/BundledStdlibFsProvider';
import { SourcesStatusBar }     from './ui/SourcesStatusBar';
import { SourcesActionsMenu }   from './ui/SourcesActionsMenu';
import { DependencyResolver }   from './http/DependencyResolver';
import { MavenSourcesScanner }  from './gradle/MavenSourcesScanner';
import { resolveSourceJarPaths } from './gradle/GradleToolingResolver';
import { KotlinTestController } from './testing/KotlinTestController';
import { registerChatParticipant } from './ai/KotlinJumpChatParticipant';
import { StringResourceIndex } from './indexer/StringResourceIndex';
import { StringResourceFoldingProvider } from './providers/StringResourceFoldingProvider';
import { StringResourceHoverProvider } from './providers/StringResourceHoverProvider';
import { SuppressHoverProvider } from './providers/SuppressHoverProvider';
import { PermissionHoverProvider } from './providers/PermissionHoverProvider';
import { DeprecationHoverProvider } from './providers/DeprecationHoverProvider';
import { StringResourceDefinitionProvider } from './providers/StringResourceDefinitionProvider';
import { StringXmlDefinitionProvider } from './providers/StringXmlDefinitionProvider';
import { ColorXmlDefinitionProvider } from './providers/ColorXmlDefinitionProvider';
import { DrawableResourceDefinitionProvider } from './providers/DrawableResourceDefinitionProvider';
import { DrawableXmlDefinitionProvider } from './providers/DrawableXmlDefinitionProvider';
import { RResourceIndex } from './indexer/RResourceIndex';
import { runCodeLensAction } from './providers/CodeLensAction';
import { WhatsNewPanel } from './providers/WhatsNewPanel';
import { RatingPromptService } from './ui/RatingPromptService';
import { NullAssertionProvider } from './providers/NullAssertionProvider';
import { TodoExpiryProvider } from './providers/TodoExpiryProvider';
import { ManifestPermissionProvider } from './providers/ManifestPermissionProvider';
import { HexColorFoldingProvider } from './providers/HexColorFoldingProvider';
import { HexColorDocumentColorProvider } from './providers/HexColorDocumentColorProvider';
import { ApiLevelProvider } from './providers/ApiLevelProvider';
import { registerAndroidRunCommand } from './commands/AndroidRunCommand';
import { registerInlineFeatureToggles } from './commands/InlineFeatureToggles';
import { SealedWhenCoverageProvider } from './providers/SealedWhenCoverageProvider';
import { registerAddMissingWhenBranches } from './commands/addMissingWhenBranches';
import { registerLogcat } from './logcat';
import { ColorResourceIndex } from './indexer/ColorResourceIndex';
import { DimenResourceIndex } from './indexer/DimenResourceIndex';
import { DimenResourceDefinitionProvider } from './providers/DimenResourceDefinitionProvider';
import { DimenXmlDefinitionProvider } from './providers/DimenXmlDefinitionProvider';
import { DrawableResourceIndex } from './indexer/DrawableResourceIndex';
import { DrawableHoverProvider } from './providers/DrawableHoverProvider';
import { DrawableGutterThumbnailProvider } from './providers/DrawableGutterThumbnailProvider';
import { DrawableXmlInlinePreviewProvider } from './providers/DrawableXmlInlinePreviewProvider';
import { DrawableXmlHoverProvider } from './providers/DrawableXmlHoverProvider';
import { DrawableXmlPreviewPanel, DrawableXmlPreviewLensProvider } from './providers/DrawableXmlPreviewPanel';
import { VersionCatalogIndex } from './indexer/VersionCatalogIndex';
import { ColorFoldingProvider } from './providers/ColorFoldingProvider';
import { ColorResourceDefinitionProvider } from './providers/ColorResourceDefinitionProvider';
import { ConstValFoldingProvider } from './providers/ConstValFoldingProvider';
import { SuspendMarkerProvider } from './providers/SuspendMarkerProvider';
import { ComposeA11yProvider } from './providers/ComposeA11yProvider';
import { FlowChainProvider } from './providers/FlowChainProvider';
import { LiteralTooltipProvider } from './providers/LiteralTooltipProvider';
import { GradleTaskLensProvider, runGradleTask } from './providers/GradleTaskLensProvider';
import { KmpExpectActualProvider, showActuals } from './providers/KmpExpectActualProvider';
import { DataClassFieldProvider } from './providers/DataClassFieldProvider';
import { ResourceDiagnosticProvider } from './providers/ResourceDiagnosticProvider';
import { VersionCatalogHoverProvider } from './providers/VersionCatalogHoverProvider';
import { OverrideGutterProvider } from './providers/OverrideGutterProvider';
import { NavigationHistoryProvider } from './providers/NavigationHistoryProvider';

const WORD_RE = /[A-Za-z_]\w*/;

// Module-level refs so deactivate() can save the snapshot
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

  // Only ask for a rating on a steady-state activation, never in the same
  // tick as the "Kotlin Jump updated to vX" toast above — stacking two
  // info messages right after an update is exactly the noisy UX this
  // extension avoids everywhere else.
  const forceRatingPrompt = typeof process !== 'undefined' && process.env.KJ_FORCE_RATING_PROMPT === '1';
  if (lastSeen === version || forceRatingPrompt) {
    void RatingPromptService.maybePrompt(context, undefined, forceRatingPrompt);
  }

  // Release-time preview hook: when `.publish --dry-run` launches a dev
  // host with KJ_OPEN_WHATS_NEW=1, auto-open the What's New panel so the
  // maintainer sees the exact UX users will get — without clicking
  // through the command palette. No-op in every other context.
  if (process.env.KJ_OPEN_WHATS_NEW === '1') {
    setTimeout(() => { void WhatsNewPanel.show(context); }, 400);
  }

  // Companion hook: when KJ_OPEN_PREVIEW_MD points at a markdown file,
  // auto-trigger `markdown.showPreviewToSide` so the rendered CHANGELOG
  // section appears beside the webview in the SAME window — no second
  // VS Code process, no Cmd+Shift+V keystroke required.
  const previewMd = process.env.KJ_OPEN_PREVIEW_MD;
  if (previewMd) {
    setTimeout(() => {
      void vscode.commands.executeCommand(
        'markdown.showPreviewToSide',
        vscode.Uri.file(previewMd),
      );
    }, 600);
  }

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

  registerAndroidRunCommand(context, log);
  registerLogcat(context, log, index);

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
    // @Suppress / @SuppressLint / @SuppressWarnings hover — independent of
    // the symbol-based hover above (runs on string literals, not
    // identifiers), so we register it unconditionally so users see the
    // descriptions even when hoverEnabled is turned off for the symbol
    // hover.
    ...(!isCompanion ? [vscode.languages.registerHoverProvider(KT_JAVA, new SuppressHoverProvider())] : []),
    // Android permission hover — also on XML so AndroidManifest.xml
    // `<uses-permission android:name="android.permission.X">` resolves.
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
      // KJ-001 — Add names to call arguments (Alt+Enter à la IntelliJ).
      vscode.languages.registerCodeActionsProvider(
        KT_JAVA,
        new NamedArgumentsActionProvider(async (callee, arity) => {
          const cfg = vscode.workspace.getConfiguration('kotlinJump');
          if (!cfg.get<boolean>('namedArgumentsAction', true)) return null;
          const candidates = index
            .lookup(callee)
            .filter(e => ['fun', 'composable', 'class', 'dataClass'].includes(e.kind as string));
          // Passe 1 : arité exacte ; passe 2 : plus de paramètres (défauts).
          for (const exact of [true, false]) {
            for (const entry of candidates) {
              try {
                const doc = await vscode.workspace.openTextDocument(entry.uri);
                const sig = readSignature(doc, entry);
                if (!sig) continue;
                const params = parseParams(sig);
                if (params.length === 0) continue;
                if (exact ? params.length !== arity : params.length < arity) continue;
                return {
                  params: params.map(p => ({
                    name: p.name,
                    isVararg: new RegExp(`\\bvararg\\s+${p.name}\\b`).test(sig),
                  })),
                };
              } catch {
                continue;
              }
            }
          }
          return null;
        }),
        { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] },
      ),
      // KJ-002 — Postfix completion (.let, .null, .for…), kotlin seulement :
      // les templates générés sont du Kotlin.
      vscode.languages.registerCompletionItemProvider(
        { language: 'kotlin' },
        new PostfixCompletionProvider(),
        '.',
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
    vscode.workspace.registerFileSystemProvider(KOTLIN_STDLIB_JAR_SCHEME, new BundledStdlibFsProvider(), { isReadonly: true, isCaseSensitive: true }),

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

    // Inlay-hint navigation wrapper. Implementation lives in
    // DefinitionProvider.ts (`navigateFromInlay`) so unit tests can verify
    // the pending-state clearing contract without booting the full extension.
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
        // Sort: named classes first (alphabetically), anonymous objects
        // last. Anonymous entries are noisy placeholder-style items; putting
        // them on top makes the picker feel like it's surfacing garbage
        // before the real choices.
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

        // Multiple implementations → show quick pick. Same sort as the
        // class-level picker: alphabetical by name (anonymous entries are
        // rare on method picks but would also land last by construction).
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

    // KJ-006 — Surround with… (QuickPick + application d'un gabarit)
    vscode.commands.registerCommand('kotlin-jump.surroundWith', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void surroundWithQuickPick(editor);
    }),
    vscode.commands.registerCommand(
      'kotlin-jump.surroundWith.apply',
      (_uri: vscode.Uri, _range: vscode.Range, templateId: string) => {
        const editor = vscode.window.activeTextEditor;
        if (editor) void applySurround(editor, templateId);
      },
    ),

    // KJ-007 — Smart join lines (Ctrl+Shift+J, also in the lightbulb)
    vscode.commands.registerCommand('kotlin-jump.smartJoinLines', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) void smartJoinLinesCommand(editor);
    }),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new SmartJoinLinesProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] },
    ),

    // ── Balayage ampoule (Kevin, 25/07) : chaque signalement offre son
    // remède en code action, la découvrabilité passe par l'ampoule. ──────
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new LifecycleReleaseActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'kotlin' }, { language: 'java' }],
      new ExpiredTodoActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new NullAssertionActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new MissingWhenBranchesActionProvider(index),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),

    // KJ-013 — Screen Flow Map
    vscode.commands.registerCommand('kotlin-jump.screenFlowMap', () => ScreenFlowPanel.show()),

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
      // Inlay-hint navigation just landed (or is in flight): suppress the
      // smart-nav consumption entirely during the post-nav race window.
      // VS Code re-fires provideDefinition at the new cursor for link
      // decorations, which sets pending — without this guard the listener
      // would consume that state and pop the Find Usages panel on top.
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

  // ── Resolve Gradle modules and find all .kt files ─────────────────────────
  const cfg         = vscode.workspace.getConfiguration('kotlinJump');
  const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
  const isExcludedPath = makeExclusionMatcher(excludeList);
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
    _sealedWhen?.bumpEpoch();               // sealed subtype sets may have changed in any file
    testCtrl.notifyFileIndexed(uri);    // index is fresh — safe to refresh test tree now
  }, log, uris => {
    // Burst path (git checkout/rebase): per-file cache evictions are O(1)
    // each, but the sealed epoch bump and the test-tree refresh happen ONCE
    // for the whole batch instead of once per file.
    for (const uri of uris) {
      _semanticTokens?.invalidate(uri.toString());
      codeLens.evictFile(uri.toString());
      _signatureHelp?.evictFile(uri.toString());
      invalidateContentCache(uri.toString());
    }
    _sealedWhen?.bumpEpoch();
    testCtrl.notifyScanComplete();
  }, isExcludedPath);
  context.subscriptions.push(watcher, { dispose: () => scanner.destroy() });

  // ── String Resource Folding ────────────────────────────────────────────────
  const stringIndex = new StringResourceIndex();
  // Lifted to function scope so later blocks (R.dimen navigation) can
  // reuse it for the XML → Kotlin direction without a second index.
  const rIndex = new RResourceIndex();
  context.subscriptions.push((() => {
    const foldingProvider = new StringResourceFoldingProvider(stringIndex, log);

    // ── R.string usage index (XML → Kotlin navigation) ──────────────────────
    // Pre-indexes R.(string|plurals|array).KEY usages from all Kotlin/Java files
    // so that provideDefinition() is O(1) instead of O(N files × I/O).
    // Bounded concurrency: the old unbatched Promise.all fired thousands of
    // simultaneous readFile calls at activation, an I/O storm competing with
    // VS Code's own startup (and its git extension's first refresh).
    void mapBatched(allUris, async u => {
      try {
        const bytes = await vscode.workspace.fs.readFile(u);
        rIndex.reindexFile(u.toString(), new TextDecoder().decode(bytes));
      } catch { /* skip unreadable files */ }
    });
    const rW = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts,java}');
    // Global quiet-window batching: a checkout used to fire one immediate
    // readFile PER changed file — hundreds of concurrent disk reads racing
    // git itself. Batched and read sequentially once the storm settles.
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

    // Initial scan of every XML under values*/. Real Android projects
    // routinely split <string>/<plurals>/<string-array> across files
    // (`strings_errors.xml`, `strings_premium.xml`, …). The previous
    // glob only matched the literal `strings.xml`; everything else was
    // silently invisible — no fold, no hover, no diagnostic. The
    // parser below skips files with no `<string>`/`<plurals>`/
    // `<string-array>` tag, so colors.xml / dimens.xml cost nothing.
    vscode.workspace.findFiles(
      '**/res/values*/*.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => {
      log.info(`[StringFolding] found ${uris.length} values*.xml file(s)`);
      for (const u of uris) log.debug(`[StringFolding]   ${u.fsPath}`);
      return mapBatched(uris, async u => {
        const bytes = await vscode.workspace.fs.readFile(u);
        stringIndex.reindexFile(u, new TextDecoder().decode(bytes));
        log.debug(`[StringFolding] indexed ${u.fsPath}`);
      });
    }).then(() => {
      log.info('[StringFolding] initial scan done — invalidating all editors');
      foldingProvider.invalidateAll();
    });

    if (vscode.window.activeTextEditor) foldingProvider.invalidateAll();

    const handleChanged = async (uri: vscode.Uri) => {
      log.info(`[StringFolding] values xml changed — reindexing ${uri.fsPath}`);
      const bytes = await vscode.workspace.fs.readFile(uri);
      stringIndex.reindexFile(uri, new TextDecoder().decode(bytes));
      foldingProvider.invalidateAll();
    };
    const handleDeleted = (uri: vscode.Uri) => {
      log.info(`[StringFolding] values xml deleted — removing ${uri.fsPath}`);
      stringIndex.removeFile(uri);
      foldingProvider.invalidateAll();
    };
    const strW1 = vscode.workspace.createFileSystemWatcher('**/res/values/*.xml');
    const strW2 = vscode.workspace.createFileSystemWatcher('**/res/values-*/*.xml');
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
      // Cmd+Click on `<color name="xxx">` in values/colors.xml →
      // jump to every `R.color.xxx` usage in Kotlin/Java.
      vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        new ColorXmlDefinitionProvider(rIndex),
      ),
      // Cmd+Click on `R.drawable.ic_*` / `R.mipmap.*` → opens the
      // corresponding file in `res/drawable*` or `res/mipmap*`.
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new DrawableResourceDefinitionProvider(),
      ),
      // Cmd+Click on `<vector>` (or any drawable root element) →
      // list every `R.drawable.<basename>` usage.
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

  // ── Sprint 1: Null assertion highlight ────────────────────────────────────
  context.subscriptions.push(new NullAssertionProvider());

  // ── Overdue dated TODO highlight ──────────────────────────────────────────
  context.subscriptions.push(new TodoExpiryProvider());

  // ── Manifest permission risk badges ───────────────────────────────────────
  context.subscriptions.push(new ManifestPermissionProvider());

  // ── Sprint 1: Hex color inline swatch + native color picker ───────────────
  context.subscriptions.push(new HexColorFoldingProvider());
  context.subscriptions.push(
    vscode.languages.registerColorProvider(KT_JAVA, new HexColorDocumentColorProvider()),
  );

  // ── Sprint 1: API level inlay hints ───────────────────────────────────────
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

  // ── Sprint 2: const val inline folding ────────────────────────────────────
  context.subscriptions.push(new ConstValFoldingProvider(index));

  // ── Navigation history (Back / Forward — Cmd+Opt+Left / Right) ────────────
  const navigationHistory = new NavigationHistoryProvider();
  context.subscriptions.push(
    navigationHistory,
    // KJ-008 — Recent locations popup (Cmd+Shift+E)
    vscode.commands.registerCommand('kotlin-jump.recentLocations', () =>
      recentLocationsCommand(navigationHistory),
    ),
  );

  // ── Sprint 2: suspend call markers ────────────────────────────────────────
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

  // ── Compose accessibility hints ───────────────────────────────────────────
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

  // ── Flow chain step badges ────────────────────────────────────────────────
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

  // ── Cron / ISO duration literal translation ───────────────────────────────
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

  // ── Gradle task run lens (desktop only — spawns the wrapper) ─────────────
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/*.gradle.kts' }, new GradleTaskLensProvider(),
    ),
    vscode.commands.registerCommand('kotlin-jump.runGradleTask', runGradleTask),
  );

  // ── Data class body-field warnings ────────────────────────────────────────
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

  // ── KMP expect/actual target badges ───────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'kotlin' }, new KmpExpectActualProvider(index)),
    vscode.commands.registerCommand('kotlin-jump.showActuals',
      (fqn: string, name: string) => showActuals(index, fqn, name)),
  );

  // ── KJ-004 : hardcoded string lint (opt-in) ───────────────────────────────
  context.subscriptions.push(new HardcodedStringProvider());

  // ── KJ-009 : unused import graying + quick fix de suppression ────────────
  context.subscriptions.push(
    new UnusedImportProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new UnusedImportCodeActionProvider(),
      { providedCodeActionKinds: UnusedImportCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // ── KJ-025 : unused parameters (warning + quick fix de retrait) ──────────
  context.subscriptions.push(
    new UnusedParameterProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new UnusedParameterCodeActionProvider(),
      { providedCodeActionKinds: UnusedParameterCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // ── KJ-026 : unused private declarations (warning + quick fixes) ─────────
  context.subscriptions.push(
    new UnusedDeclarationProvider(),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'kotlin' }, { language: 'java' }],
      new UnusedDeclarationCodeActionProvider(),
      { providedCodeActionKinds: UnusedDeclarationCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // ── KJ-027 : unused locals and bindings (warning + quick fixes) ──────────
  context.subscriptions.push(
    new UnusedLocalProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new UnusedLocalCodeActionProvider(),
      { providedCodeActionKinds: UnusedLocalCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // ── KJ-028 : write-only variables (warning + quick fix multi-sites) ──────
  context.subscriptions.push(
    new WriteOnlyProvider(),
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new WriteOnlyCodeActionProvider(),
      { providedCodeActionKinds: WriteOnlyCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // ── KJ-029 : fichiers de ressources jamais référencés ────────────────────
  const unusedResourceProvider = new UnusedResourceProvider();
  const resourceCorpus = new ResourceCorpus();
  const deadCodeSweepReport = new DeadCodeSweepReport();
  const unusedResourceKeyProvider = new UnusedResourceKeyProvider();
  const unusedSymbolProvider = new UnusedSymbolProvider();
  const unheardEventProvider = new UnheardEventProvider();
  const unusedEnumEntryProvider = new UnusedEnumEntryProvider();
  const remoteConfigKeyProvider = new UnusedRemoteConfigKeyProvider();
  const gradleDependencyProvider = new UnusedGradleDependencyProvider();
  const unusedMemberProvider = new UnusedMemberProvider();
  const deadIslandProvider = new DeadIslandProvider();
  const unusedDtoFieldProvider = new UnusedDtoFieldProvider();
  const writeOnlyKeyProvider = new WriteOnlyKeyProvider();
  context.subscriptions.push(
    unusedResourceProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/res/**' },
      unusedResourceProvider,
      { providedCodeActionKinds: UnusedResourceProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedResources', () =>
      findUnusedResourcesCommand(resourceCorpus, unusedResourceProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedResources', () =>
      unusedResourceProvider.clear(),
    ),
    deadCodeSweepReport,
    vscode.commands.registerCommand('kotlin-jump.findDeadCode', () =>
      findDeadCodeCommand(deadCodeSweepReport),
    ),
    vscode.commands.registerCommand('kotlin-jump.cleanDeadCodeInFile', () =>
      cleanDeadCodeInFileCommand(),
    ),
    vscode.commands.registerCommand('kotlin-jump.cleanDeadCodeInWorkspace', () =>
      cleanDeadCodeInWorkspaceCommand(),
    ),
    unusedResourceKeyProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/res/values*/*.xml' },
      unusedResourceKeyProvider,
      { providedCodeActionKinds: UnusedResourceKeyProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedResourceKeys', () =>
      findUnusedResourceKeysCommand(resourceCorpus, unusedResourceKeyProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedResourceKeys', () =>
      unusedResourceKeyProvider.clear(),
    ),
    vscode.commands.registerCommand('kotlin-jump.removeAllUnusedResourceKeys', () =>
      removeAllUnusedResourceKeysCommand(resourceCorpus, unusedResourceKeyProvider),
    ),
    unusedSymbolProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedSymbolProvider,
      { providedCodeActionKinds: UnusedSymbolProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedSymbols', () =>
      findUnusedSymbolsCommand(resourceCorpus, unusedSymbolProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedSymbols', () =>
      unusedSymbolProvider.clear(),
    ),
    vscode.commands.registerCommand('kotlin-jump.removeAllUnusedSymbols', () =>
      removeAllUnusedSymbolsCommand(resourceCorpus, unusedSymbolProvider),
    ),
    unheardEventProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unheardEventProvider,
      { providedCodeActionKinds: UnheardEventProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      unheardEventProvider,
      { providedCodeActionKinds: UnheardEventProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnheardEvents', () =>
      findUnheardEventsCommand(resourceCorpus, unheardEventProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnheardEvents', () =>
      unheardEventProvider.clear(),
    ),
    vscode.commands.registerCommand('kotlinJump.createEventSubscriber', (name: string, fqn: string) =>
      createEventSubscriberCommand(name, fqn),
    ),
    unusedEnumEntryProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedEnumEntryProvider,
      { providedCodeActionKinds: UnusedEnumEntryProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      unusedEnumEntryProvider,
      { providedCodeActionKinds: UnusedEnumEntryProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedEnumEntries', () =>
      findUnusedEnumEntriesCommand(resourceCorpus, unusedEnumEntryProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedEnumEntries', () =>
      unusedEnumEntryProvider.clear(),
    ),
    remoteConfigKeyProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/res/xml*/*.xml' },
      remoteConfigKeyProvider,
      { providedCodeActionKinds: UnusedRemoteConfigKeyProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedRemoteConfigKeys', () =>
      findUnusedRemoteConfigKeysCommand(resourceCorpus, remoteConfigKeyProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.removeAllUnusedRemoteConfigKeys', () =>
      removeAllUnusedRemoteConfigKeysCommand(resourceCorpus, remoteConfigKeyProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedRemoteConfigKeys', () =>
      remoteConfigKeyProvider.clear(),
    ),
    gradleDependencyProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: '**/*.versions.toml' },
      gradleDependencyProvider,
      { providedCodeActionKinds: UnusedGradleDependencyProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedGradleDependencies', () =>
      findUnusedGradleDependenciesCommand(resourceCorpus, gradleDependencyProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedGradleDependencies', () =>
      gradleDependencyProvider.clear(),
    ),
    unusedMemberProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedMemberProvider,
      { providedCodeActionKinds: UnusedMemberProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      unusedMemberProvider,
      { providedCodeActionKinds: UnusedMemberProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedMembers', () =>
      findUnusedMembersCommand(resourceCorpus, unusedMemberProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedMembers', () =>
      unusedMemberProvider.clear(),
    ),
    deadIslandProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      deadIslandProvider,
      { providedCodeActionKinds: DeadIslandProvider.providedCodeActionKinds },
    ),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'java' },
      deadIslandProvider,
      { providedCodeActionKinds: DeadIslandProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findDeadIslands', () =>
      findDeadIslandsCommand(resourceCorpus, deadIslandProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearDeadIslands', () =>
      deadIslandProvider.clear(),
    ),
    unusedDtoFieldProvider,
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'kotlin' },
      unusedDtoFieldProvider,
      { providedCodeActionKinds: UnusedDtoFieldProvider.providedCodeActionKinds },
    ),
    vscode.commands.registerCommand('kotlin-jump.findUnusedDtoFields', () =>
      findUnusedDtoFieldsCommand(resourceCorpus, unusedDtoFieldProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearUnusedDtoFields', () =>
      unusedDtoFieldProvider.clear(),
    ),
    writeOnlyKeyProvider,
    vscode.commands.registerCommand('kotlin-jump.findWriteOnlyKeys', () =>
      findWriteOnlyKeysCommand(resourceCorpus, writeOnlyKeyProvider),
    ),
    vscode.commands.registerCommand('kotlin-jump.clearWriteOnlyKeys', () =>
      writeOnlyKeyProvider.clear(),
    ),
    vscode.commands.registerCommand('kotlin-jump.findEverythingUnused', () =>
      findEverythingUnusedCommand(
        resourceCorpus,
        deadCodeSweepReport,
        unusedSymbolProvider,
        unusedResourceKeyProvider,
        unusedResourceProvider,
        unheardEventProvider,
        unusedEnumEntryProvider,
        remoteConfigKeyProvider,
        gradleDependencyProvider,
        unusedMemberProvider,
        deadIslandProvider,
      ),
    ),
    vscode.workspace.onDidCreateFiles(() => resourceCorpus.invalidate()),
    vscode.workspace.onDidDeleteFiles(() => resourceCorpus.invalidate()),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (/[\\/]res[\\/]/.test(doc.uri.fsPath)) resourceCorpus.invalidate();
    }),
  );

  // ── KJ-016 : lifecycle pairing (register sans unregister…) ───────────────
  context.subscriptions.push(new LifecyclePairingProvider());

  // ── KJ-019 : dispatcher lens (IO / Main / Default) ────────────────────────
  context.subscriptions.push(new DispatcherLensProvider());

  // ── KJ-020 : room migration drift ─────────────────────────────────────────
  context.subscriptions.push(new RoomMigrationProvider());

  // ── KJ-021/022/023 : poids mort visible (badges d'usage) ─────────────────
  context.subscriptions.push(
    new ResourceUsageBadgeProvider(),
    new DependencyUsageBadgeProvider(),
    new ManifestNecessityProvider(),
  );

  // Quick fixes that remove whatever the extension reports as unused:
  // resources with 0 usages, dependencies with 0 imports, manifest
  // permissions with no code behind them.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'xml' }, { pattern: '**/build.gradle{,.kts}' }],
      new DeadWeightActionProvider(),
      { providedCodeActionKinds: DeadWeightActionProvider.providedCodeActionKinds },
    ),
  );

  // ── KJ-018 : reverse string map (cette string s'affiche où ?) ────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [...KT_JAVA, { language: 'xml' }],
      new StringXmlHoverProvider(),
    ),
  );

  // ── KJ-011 : method separator lines ───────────────────────────────────────
  context.subscriptions.push(new MethodSeparatorProvider());

  // ── KJ-014 : UDF X-Ray (qui écrit / qui lit) ──────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'kotlin' },
      new StateProvenanceProvider(),
    ),
  );

  // ── KJ-015 : Compose Outline Tree ─────────────────────────────────────────
  {
    const composeOutline = new ComposeOutlineProvider();
    const composeOutlineView = vscode.window.createTreeView('kotlinJump.composeOutline', {
      treeDataProvider: composeOutline,
    });
    context.subscriptions.push(
      composeOutlineView,
      vscode.window.onDidChangeTextEditorSelection(e =>
        composeOutline.refreshFromEditor(e.textEditor),
      ),
      vscode.window.onDidChangeActiveTextEditor(e => composeOutline.refreshFromEditor(e)),
      // Demo/test probe: actual content + view actually on screen.
      // `visible` comes from the TreeView handle: without it a demo can
      // pass with the view collapsed and record a closed panel.
      vscode.commands.registerCommand('kotlin-jump._outlineSnapshot', () => ({
        items: composeOutline.snapshot(),
        visible: composeOutlineView.visible,
      })),
      // Scrolls the view to the end of the tree (×items / cycle markers):
      // in a ~6-row sidebar the bottom is never seen otherwise.
      vscode.commands.registerCommand('kotlin-jump._outlineRevealTail', async () => {
        const tail = composeOutline.tailNode();
        if (tail) await composeOutlineView.reveal(tail, { select: false, focus: false });
      }),
      vscode.commands.registerCommand('kotlin-jump._probe', () => probeSnapshot()),
      vscode.commands.registerCommand('kotlin-jump._probeTexts', (providerId: string) =>
        probeTexts(providerId),
      ),
      vscode.commands.registerCommand('kotlin-jump._recentSnapshot', () =>
        navigationHistory.recentLocations(),
      ),
    );
  }

  // ── KJ-012 : Android project view (Explorer) ──────────────────────────────
  {
    const androidView = new AndroidProjectViewProvider();
    const settingsWatcher = vscode.workspace.createFileSystemWatcher('**/settings.gradle{,.kts}');
    const manifestWatcher = vscode.workspace.createFileSystemWatcher('**/AndroidManifest.xml');
    const refreshView = () => androidView.refresh();
    // La vue n'apparaît que si le workspace ressemble à un projet Android.
    void vscode.workspace
      .findFiles('**/AndroidManifest.xml', '**/build/**', 1)
      .then(found =>
        vscode.commands.executeCommand('setContext', 'kotlinJump.isAndroidWorkspace', found.length > 0),
      );
    context.subscriptions.push(
      vscode.window.createTreeView('kotlinJump.androidProjectView', {
        treeDataProvider: androidView,
      }),
      vscode.commands.registerCommand('kotlin-jump._androidViewRoots', () =>
        androidView.getChildren(),
      ),
      settingsWatcher, manifestWatcher,
      settingsWatcher.onDidChange(refreshView),
      settingsWatcher.onDidCreate(refreshView),
      manifestWatcher.onDidCreate(refreshView),
    );
  }

  // ── KJ-005 : extract string resource (quick fix compagnon du lint) ───────
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      KT_JAVA,
      new ExtractStringResourceProvider(stringIndex),
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract] },
    ),
    vscode.commands.registerCommand(
      'kotlin-jump.extractString.saveTarget',
      async (uri: vscode.Uri) => {
        const doc = vscode.workspace.textDocuments.find(
          d => d.uri.toString() === uri.toString(),
        );
        if (doc?.isDirty) await doc.save();
      },
    ),
  );

  // ── KJ-006 : surround with (code actions sur sélection) ──────────────────
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'kotlin' },
      new SurroundWithProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite] },
    ),
  );

  // ── Sprint 2: R.color swatch + resource diagnostics ───────────────────────
  const colorIndex = new ColorResourceIndex();

  // ── KJ-017 : resource shadowing (quelle définition gagne) ────────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      KT_JAVA,
      new ResourceShadowingProvider(colorIndex, stringIndex),
    ),
  );

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

    // Scan every XML under values*/ — Android lets you split <color>
    // declarations across files (`colors_brand.xml`, `colors_dark.xml`,
    // …). The literal `colors.xml` glob silently missed those, so any
    // `R.color.X` referencing a non-`colors.xml` file landed on a
    // gray fallback swatch + "Cannot resolve" diagnostic. The parser
    // skips files with no `<color>` tag, so strings.xml / dimens.xml
    // pay zero indexing cost.
    vscode.workspace.findFiles(
      '**/res/values*/*.xml',
      `{${excludeList.join(',')}}`,
    ).then(uris => mapBatched(uris, handleColorChanged));

    const cW1 = vscode.workspace.createFileSystemWatcher('**/res/values/*.xml');
    const cW2 = vscode.workspace.createFileSystemWatcher('**/res/values-*/*.xml');
    for (const w of [cW1, cW2]) {
      w.onDidCreate(handleColorChanged);
      w.onDidChange(handleColorChanged);
      w.onDidDelete(uri => { colorIndex.removeFile(uri); colorProvider.invalidateAll(); resourceDiag.invalidateAll(); });
    }

    // Cmd+Click on `R.color.xxx` → jump to <color name="xxx"> in
    // values/colors.xml. Mirrors StringResourceDefinitionProvider.
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new ColorResourceDefinitionProvider(colorIndex),
      ),
    );

    context.subscriptions.push(colorProvider, resourceDiag, cW1, cW2);
  })();

  // ── R.dimen navigation (values/dimens.xml) ────────────────────────────────
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
      // Kotlin → XML: `R.dimen.x` jumps to `<dimen name="x">`.
      vscode.languages.registerDefinitionProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new DimenResourceDefinitionProvider(dimenIndex),
      ),
      // XML → Kotlin: `<dimen name="x">` lists all `R.dimen.x` usages.
      vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        new DimenXmlDefinitionProvider(rIndex),
      ),
      dW1, dW2,
    );
  })();

  // ── R.drawable / R.mipmap — rich hover + gutter thumbnail ──────────────────
  (() => {
    const drawableIndex = new DrawableResourceIndex();

    const dwW1 = vscode.workspace.createFileSystemWatcher('**/res/drawable*/*');
    const dwW2 = vscode.workspace.createFileSystemWatcher('**/res/mipmap*/*');
    const gutter = new DrawableGutterThumbnailProvider(drawableIndex, context.globalStorageUri);

    // Initial scan. No refresh-wiring needed here — the index fires
    // `onDidChange` whenever addFile/removeFile mutates it, and the
    // gutter provider's constructor subscribed to it. Late arrivals
    // from this async Promise therefore trigger their own repaint.
    vscode.workspace.findFiles(
      '**/res/{drawable,mipmap}*/*.{xml,png,webp,svg,jpg,jpeg,gif,bmp}',
      `{${excludeList.join(',')}}`,
    ).then(uris => { for (const u of uris) drawableIndex.addFile(u); });

    for (const w of [dwW1, dwW2]) {
      w.onDidCreate(uri => drawableIndex.addFile(uri));
      w.onDidChange(uri => { drawableIndex.addFile(uri); gutter.invalidatePath(uri); });
      w.onDidDelete(uri => { drawableIndex.removeFile(uri); gutter.invalidatePath(uri); });
    }

    // Backup invalidation channel: `fs.watch`-based file system watchers
    // can miss save events on macOS / NFS / SMB mounts (well-documented Node
    // limitation). The editor's `onDidSaveTextDocument` is delivered in-process
    // and is reliable. Wiring both means a save fires invalidation even when
    // the watcher silently drops the change.
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (!/\/res\/(drawable|mipmap)[^/]*\/[^/]+\.(xml|png|webp|svg|jpg|jpeg|gif|bmp)$/i.test(doc.uri.path)) return;
        drawableIndex.addFile(doc.uri);
        gutter.invalidatePath(doc.uri);
      }),
    );

    context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        [{ language: 'kotlin' }, { language: 'java' }],
        new DrawableHoverProvider(drawableIndex),
      ),
      // Inline `<vector>` preview when the drawable XML is open in the
      // editor: an always-visible gutter icon at the `<vector>` line
      // (DrawableXmlInlinePreviewProvider, desktop-only disk cache) plus a
      // hover for the larger 256x256 popup (DrawableXmlHoverProvider, no
      // Node dependency, also registered on the web).
      ...((): vscode.Disposable[] => {
        const xmlPreview = new DrawableXmlInlinePreviewProvider(context.globalStorageUri);
        // Auto-opening side preview — opens beside the editor on
        // first focus of any vector drawable XML, lives across
        // file switches, dismissable. The `kotlinJump.vectorPreview.show`
        // command lets the user re-open it after dismissal, and the
        // CodeLens above `<vector>` exposes the same command so the
        // affordance is always discoverable in-context.
        const sidePreview = new DrawableXmlPreviewPanel();
        // The lens provider owns an onDidSaveTextDocument subscription — keep
        // the instance so its dispose() runs (the registration alone doesn't).
        const previewLens = new DrawableXmlPreviewLensProvider(index);
        return [
          xmlPreview,
          sidePreview,
          previewLens,
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
          // Wrapper around `editor.action.showReferences` that auto-closes
          // the peek the moment the user clicks a result. The native peek
          // is sticky-by-design ("keep browsing"), but when invoked from
          // our drawable XML CodeLens the typical flow is "open peek →
          // pick one ref → land in code". The peek staying anchored on
          // the now-background XML feels like a stuck modal. We listen
          // for the next `onDidChangeActiveTextEditor` (= user picked a
          // location) and dismiss the peek with `closeReferenceSearch`.
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
                // Peek navigation lands in a different editor than the
                // anchor file. Same-file selection (rare for our use)
                // is ignored to avoid closing on accidental focus jumps.
                if (!e || e.document.uri.toString() === initialUri) return;
                cleanup();
                void vscode.commands.executeCommand('closeReferenceSearch');
              });
              // Safety net — if the user dismisses the peek with Escape
              // (no editor change), drop the listener after a minute so
              // we don't keep a dangling subscription forever.
              timeout = setTimeout(cleanup, 60_000);
              await vscode.commands.executeCommand(
                'editor.action.showReferences', uri, pos, locs,
              );
            },
          ),
          // Jump straight to the single `R.drawable.<name>` usage when
          // the references CodeLens has exactly one hit. Range is a
          // Position pair (line/character) — `Selection` synthesised
          // here so VS Code highlights the token on arrival.
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
        ];
      })(),
      drawableIndex,
      gutter,
      dwW1, dwW2,
    );
  })();

  // ── Sprint 2: version catalog hover (libs.xxx) ────────────────────────────
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

  // ── Sprint 2: override/implement gutter icons ──────────────────────────────
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

  // ── kotlin-jump.revealDefinitionAt — used by override ⬆ CodeLens ──────────
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

  // ── Test Explorer ─────────────────────────────────────────────────────────
  const testCtrl = new KotlinTestController(index, context, log);

  // ── JAR / Maven scanners ──────────────────────────────────────────────────
  // Scans are serialised via a promise chain so concurrent calls (startup,
  // reindex, build.gradle watcher) never overlap on the same index.
  let gradleScanner: GradleSourcesScanner | undefined;
  let mavenScanner:  MavenSourcesScanner  | undefined;
  let jdkScanner:    JdkSourcesScanner    | undefined;
  let _scanChain: Promise<void> = Promise.resolve();

  // Library-sources status bar (separate from the main symbol-count item).
  // Updated after each scan with the scanners' counts.
  const sourcesBar = new SourcesStatusBar();
  context.subscriptions.push(sourcesBar);
  const sourcesMenu = new SourcesActionsMenu(sourcesBar, log, () => runJarScan());
  context.subscriptions.push(sourcesMenu);

  /** Cancel any in-flight scans and queue a fresh one. */
  const runJarScan = () => {
    gradleScanner?.cancel();
    mavenScanner?.cancel();
    jdkScanner?.cancel();
    if (!gradleScanner) return;

    _scanChain = _scanChain.then(async () => {
      statusBar.text = '$(sync~spin) Kotlin Jump: indexing library sources…';
      sourcesBar.setState({ scanning: true, networkError: false });
      try {
        const cfg = vscode.workspace.getConfiguration('kotlinJump');

        // Optionally use Gradle Tooling API to get the precise source JAR list
        let toolingJarPaths: string[] | null = null;
        if (cfg.get<boolean>('useGradleTooling', false)) {
          const folders  = vscode.workspace.workspaceFolders ?? [];
          const timeout  = cfg.get<number>('gradleToolingTimeoutMs', 30_000);
          for (const folder of folders) {
            toolingJarPaths = await resolveSourceJarPaths(folder.uri.fsPath, timeout, log);
            if (toolingJarPaths) break;
          }
        }

        const [gradle, maven, jdk] = await Promise.all([
          gradleScanner!.scanAll(toolingJarPaths ?? undefined),
          mavenScanner!.scanAll(),
          jdkScanner!.scanAll(),
        ]);
        const totalJars  = gradle.jars  + maven.jars;
        const totalFiles = gradle.files + maven.files + jdk.files;

        const { symbols: totalSymbols } = index.stats();
        const jdkLabel = jdk.jdkHome ? ` + JDK${jdk.files > 0 ? '✓' : '⚠'}` : '';
        statusBar.text    = `$(symbol-class) Kotlin Jump: ${totalSymbols.toLocaleString()} symbols`;
        statusBar.tooltip = `${totalSymbols.toLocaleString()} symbols (incl. ${totalFiles} library files from ${totalJars} JARs${jdkLabel})`;
        _semanticTokens?.invalidate();

        // Compute "missing" by diffing parsed coords vs indexed JARs.
        // Best-effort, skipped on error so a parser hiccup doesn't break the bar.
        let missingCoords = 0;
        try {
          const folders = vscode.workspace.workspaceFolders ?? [];
          if (folders.length > 0) {
            const resolver = new DependencyResolver();
            const declared = await resolver.resolveAll(folders[0].uri);
            // A dep is "missing" if neither Gradle nor Maven scanners returned a
            // matching JAR. Approximation: count of declared coords minus indexed
            // JARs (gradle.jars + maven.jars). Negative clamped to 0.
            missingCoords = Math.max(0, declared.length - totalJars);
          }
        } catch (e) {
          log.warn(`[sources-bar] missing-coords compute failed: ${(e as Error).message}`);
        }

        sourcesBar.setState({
          scanning:      false,
          libsIndexed:   totalJars,
          jdk:           jdk.jdkHome ? (jdk.files > 0 ? 'ok' : 'missing') : 'absent',
          bundledStdlib: true,  // BundledStdlibProvider.load() is best-effort; assume ok if no error
          missingCoords,
          networkError:  false,
        });
        // Show the first-scan prompt once if cache is cold + coords found.
        void sourcesMenu.maybeShowFirstScanPrompt();
      } catch (err) {
        log.warn(`[jarscan] ${err}`);
        const { symbols: s, files: f } = index.stats();
        statusBar.text    = `$(symbol-class) Kotlin Jump: ${s.toLocaleString()} symbols`;
        statusBar.tooltip = `${s.toLocaleString()} symbols in ${f} files`;
        sourcesBar.setState({ scanning: false, networkError: true });
      }
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.runTest', async (fqn: string, _moduleName?: string, uriStr?: string) => {
      let item = testCtrl.findMethodItem(fqn, uriStr);
      if (!item) {
        const entry = uriStr
          ? index.getFileSymbols(uriStr).find(e => e.fqn === fqn)
          : index.lookupFqn(fqn);
        if (entry) { testCtrl.refreshFileTests(entry.uri); item = testCtrl.findMethodItem(fqn, uriStr); }
      }
      if (!item) { vscode.window.showWarningMessage(`Kotlin Jump: test not found in index: ${fqn}`); return; }
      vscode.commands.executeCommand('workbench.view.testing.focus');
      vscode.commands.executeCommand('testing.showMostRecentOutput');
      await testCtrl.runItems([item]);
    }),

    vscode.commands.registerCommand('kotlin-jump.runTestClass', async (fqn: string, _moduleName?: string, uriStr?: string) => {
      let classItem = testCtrl.findClassItem(fqn, uriStr);
      if (!classItem) {
        const entry = uriStr
          ? index.getFileSymbols(uriStr).find(e => e.fqn === fqn)
          : index.lookupFqn(fqn);
        if (entry) { testCtrl.refreshFileTests(entry.uri); classItem = testCtrl.findClassItem(fqn, uriStr); }
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

    // build.gradle watcher: keep JAR sources up to date live.
    (() => {
      let debounceId: ReturnType<typeof setTimeout> | undefined;
      const gradleWatcher = vscode.workspace.createFileSystemWatcher('**/build.gradle{,.kts}');
      const onGradleChange = () => {
        if (debounceId) clearTimeout(debounceId);
        // 30s delay: give Gradle time to finish downloading new JARs.
        debounceId = setTimeout(async () => {
          const action = await vscode.window.showInformationMessage(
            'Kotlin Jump: Gradle files changed. New library sources may be available.',
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
    // Kick off the staleness check in parallel with the restore. The walk
    // is I/O-bound (256-way concurrent stat()), the restore is CPU-bound
    // (parsing snapshot + populating maps) — neither touches the other,
    // so overlapping them shaves ~200-500 ms off cold start on large
    // workspaces.
    const stalenessPromise = IndexStore.checkStaleness(snapshot, allUris);

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

    const report = await stalenessPromise;
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
  jdkScanner    = new JdkSourcesScanner(index, log);

  // Load bundled Kotlin stdlib synchronously before the JAR scan kicks off
  // so List/String/Sequence/etc. resolve from the moment Kotlin Jump is
  // ready, even on a cold Gradle cache. Gradle/Maven scans (which may
  // include a project-pinned stdlib of the same or a newer version) will
  // overwrite this fallback when they index their own kotlin-stdlib JAR.
  const bundledStdlib = new BundledStdlibProvider(index, log, context.extensionUri);
  void bundledStdlib.load().catch((e: Error) => log.warn(`[bundled-stdlib] ${e.message}`));

  runJarScan();

  // ── Inline feature toggles — buttons in editor/title + master toggle ──────
  // Shared with extension.browser.ts (see InlineFeatureToggles.ts).
  registerInlineFeatureToggles(context);

  // ── Chat Participant (F7) ─────────────────────────────────────────────────
  registerChatParticipant(context, index);

  // ── MCP Server Definition Provider (F8) ──────────────────────────────────
  // vscode.lm.registerMcpServerDefinitionProvider introduced in VS Code 1.115.
  // Guard so the extension loads cleanly on older editors (e.g. Antigravity 1.107).
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const lmNs = vscode.lm as typeof vscode.lm & {
    registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable;
  };
  if (workspaceRoot && typeof lmNs.registerMcpServerDefinitionProvider === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const McpStdio = (vscode as any).McpStdioServerDefinition as new (
      name: string, command: string, args: string[], env: Record<string, string>, version: string,
    ) => unknown;
    const mcpProvider = {
      onDidChangeMcpServerDefinitions: new vscode.EventEmitter<void>().event,
      async provideMcpServerDefinitions() {
        // process.execPath = VS Code's bundled Node.js (correct per vscode API docs)
        return [new McpStdio(
          'Kotlin Jump',
          process.execPath,
          [context.asAbsolutePath('dist/server.js'), '--mcp', workspaceRoot],
          {},
          '1.0.0',
        )];
      },
    };
    context.subscriptions.push(
      lmNs.registerMcpServerDefinitionProvider('kotlin-jump', mcpProvider),
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
