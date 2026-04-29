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
import { inferPackage, buildMoveEdit } from './providers/MoveFileProvider';
import * as path from 'path';
import * as IndexStore from './indexer/IndexStore';
import { KotlinJarContentProvider, KOTLIN_JAR_SCHEME, closeAllCachedZips } from './providers/KotlinJarContentProvider';
import { GradleSourcesScanner } from './gradle/GradleSourcesScanner';
import { JdkSourcesScanner }    from './jdk/JdkSourcesScanner';
import { BundledStdlibProvider } from './kotlin/BundledStdlibProvider';
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
import { StringResourceDefinitionProvider } from './providers/StringResourceDefinitionProvider';
import { StringXmlDefinitionProvider } from './providers/StringXmlDefinitionProvider';
import { ColorXmlDefinitionProvider } from './providers/ColorXmlDefinitionProvider';
import { DrawableResourceDefinitionProvider } from './providers/DrawableResourceDefinitionProvider';
import { DrawableXmlDefinitionProvider } from './providers/DrawableXmlDefinitionProvider';
import { RResourceIndex } from './indexer/RResourceIndex';
import { runCodeLensAction } from './providers/CodeLensAction';
import { WhatsNewPanel } from './providers/WhatsNewPanel';
import { NullAssertionProvider } from './providers/NullAssertionProvider';
import { HexColorFoldingProvider } from './providers/HexColorFoldingProvider';
import { HexColorDocumentColorProvider } from './providers/HexColorDocumentColorProvider';
import { ApiLevelProvider } from './providers/ApiLevelProvider';
import { registerAndroidRunCommand } from './commands/AndroidRunCommand';
import { ColorResourceIndex } from './indexer/ColorResourceIndex';
import { DimenResourceIndex } from './indexer/DimenResourceIndex';
import { DimenResourceDefinitionProvider } from './providers/DimenResourceDefinitionProvider';
import { DimenXmlDefinitionProvider } from './providers/DimenXmlDefinitionProvider';
import { DrawableResourceIndex } from './indexer/DrawableResourceIndex';
import { DrawableHoverProvider } from './providers/DrawableHoverProvider';
import { DrawableGutterThumbnailProvider } from './providers/DrawableGutterThumbnailProvider';
import { DrawableXmlInlinePreviewProvider } from './providers/DrawableXmlInlinePreviewProvider';
import { DrawableXmlPreviewPanel, DrawableXmlPreviewLensProvider } from './providers/DrawableXmlPreviewPanel';
import { VersionCatalogIndex } from './indexer/VersionCatalogIndex';
import { ColorFoldingProvider } from './providers/ColorFoldingProvider';
import { ColorResourceDefinitionProvider } from './providers/ColorResourceDefinitionProvider';
import { ConstValFoldingProvider } from './providers/ConstValFoldingProvider';
import { SuspendMarkerProvider } from './providers/SuspendMarkerProvider';
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
  const stringIndex = new StringResourceIndex();
  // Lifted to function scope so later blocks (R.dimen navigation) can
  // reuse it for the XML → Kotlin direction without a second index.
  const rIndex = new RResourceIndex();
  context.subscriptions.push((() => {
    const foldingProvider = new StringResourceFoldingProvider(stringIndex, log);

    // ── R.string usage index (XML → Kotlin navigation) ──────────────────────
    // Pre-indexes R.(string|plurals|array).KEY usages from all Kotlin/Java files
    // so that provideDefinition() is O(1) instead of O(N files × I/O).
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
  context.subscriptions.push(new NavigationHistoryProvider());

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

  // ── Sprint 2: R.color swatch + resource diagnostics ───────────────────────
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
    ).then(uris => Promise.all(uris.map(handleColorChanged)));

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
    ).then(uris => Promise.all(uris.map(handleDimenChanged)));

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
      // Inline `<vector>` preview when the drawable XML is open in
      // the editor. The provider exposes BOTH:
      //  - an always-visible gutter icon at the `<vector>` line, kept
      //    in sync with the file's content (subscriptions internal),
      //  - a hover registered below for the larger 256×256 popup.
      ...((): vscode.Disposable[] => {
        const xmlPreview = new DrawableXmlInlinePreviewProvider(context.globalStorageUri);
        // Auto-opening side preview — opens beside the editor on
        // first focus of any vector drawable XML, lives across
        // file switches, dismissable. The `kotlinJump.vectorPreview.show`
        // command lets the user re-open it after dismissal, and the
        // CodeLens above `<vector>` exposes the same command so the
        // affordance is always discoverable in-context.
        const sidePreview = new DrawableXmlPreviewPanel();
        return [
          xmlPreview,
          sidePreview,
          vscode.languages.registerHoverProvider(
            { language: 'xml', pattern: '**/res/drawable*/*.xml' },
            xmlPreview,
          ),
          vscode.languages.registerCodeLensProvider(
            { language: 'xml', pattern: '**/res/drawable*/*.xml' },
            new DrawableXmlPreviewLensProvider(index),
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
            const declared = await resolver.resolveAll(folders[0].uri.fsPath);
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
  const bundledStdlib = new BundledStdlibProvider(index, log, context.extensionPath);
  void bundledStdlib.load().catch((e: Error) => log.warn(`[bundled-stdlib] ${e.message}`));

  runJarScan();

  // ── Inline feature toggles — buttons in editor/title + master toggle ──────
  // Each Kotlin Jump inline feature (string folding, color folding, const val
  // folding, hex color swatch, null assertion highlight) gets enable/disable/
  // toggle commands wired to a setting. Context keys are published so the
  // editor/title menu can swap the icon (enable vs disable) based on state.
  // The master command flips all inline features off (or all on if all are
  // currently off) — a one-click panic button.
  (() => {
    interface InlineFeature { setting: string; ctxKey: string; }
    const FEATURES: InlineFeature[] = [
      { setting: 'stringResourceFolding',  ctxKey: 'stringFoldingEnabled' },
      { setting: 'colorResourceFolding',   ctxKey: 'colorFoldingEnabled' },
      { setting: 'constValFolding',        ctxKey: 'constValFoldingEnabled' },
      { setting: 'hexColorSwatch',         ctxKey: 'hexColorSwatchEnabled' },
      { setting: 'nullAssertionHighlight', ctxKey: 'nullAssertionHighlightEnabled' },
    ];

    const syncContexts = (): void => {
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      for (const f of FEATURES) {
        void vscode.commands.executeCommand(
          'setContext',
          `kotlinJump.${f.ctxKey}`,
          cfg.get<boolean>(f.setting, true),
        );
      }
    };
    syncContexts();

    const setOne = (setting: string, value: boolean): Thenable<void> =>
      vscode.workspace.getConfiguration('kotlinJump')
        .update(setting, value, vscode.ConfigurationTarget.Global);

    // stringResourceFolding's enable/disable/toggle are already registered in
    // the dedicated string-folding IIFE above — don't double-register.
    const FIXED: Array<[string, string, boolean]> = [
      ['enableColorFolding',            'colorResourceFolding',   true],
      ['disableColorFolding',           'colorResourceFolding',   false],
      ['enableConstValFolding',         'constValFolding',        true],
      ['disableConstValFolding',        'constValFolding',        false],
      ['enableHexColorSwatch',          'hexColorSwatch',         true],
      ['disableHexColorSwatch',         'hexColorSwatch',         false],
      ['enableNullAssertionHighlight',  'nullAssertionHighlight', true],
      ['disableNullAssertionHighlight', 'nullAssertionHighlight', false],
    ];
    const TOGGLES: Array<[string, string]> = [
      ['toggleColorFolding',           'colorResourceFolding'],
      ['toggleConstValFolding',        'constValFolding'],
      ['toggleHexColorSwatch',         'hexColorSwatch'],
      ['toggleNullAssertionHighlight', 'nullAssertionHighlight'],
    ];

    const subs: vscode.Disposable[] = [];
    for (const [cmd, setting, val] of FIXED) {
      subs.push(vscode.commands.registerCommand(`kotlinJump.${cmd}`, () => setOne(setting, val)));
    }
    for (const [cmd, setting] of TOGGLES) {
      subs.push(vscode.commands.registerCommand(`kotlinJump.${cmd}`, () => {
        const current = vscode.workspace.getConfiguration('kotlinJump').get<boolean>(setting, true);
        return setOne(setting, !current);
      }));
    }
    // Master: if ANY feature is on, turn ALL off. Otherwise, turn ALL on.
    // Asymmetric semantics make this a reliable "shut everything off" button
    // while keeping a one-click restore from a clean-slate state.
    subs.push(vscode.commands.registerCommand('kotlinJump.toggleAllInlineFeatures', async () => {
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      const anyOn = FEATURES.some(f => cfg.get<boolean>(f.setting, true));
      const target = !anyOn;
      for (const f of FEATURES) {
        await cfg.update(f.setting, target, vscode.ConfigurationTarget.Global);
      }
    }));
    subs.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (FEATURES.some(f => e.affectsConfiguration(`kotlinJump.${f.setting}`))) {
        syncContexts();
      }
    }));
    context.subscriptions.push(...subs);
  })();

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
