/**
 * Kotlin Jump — standalone LSP server.
 *
 * Provides navigation features (Go to Definition, Find Usages, Hover,
 * Workspace Symbols) for Kotlin and Java files without VS Code.
 * Intended for Neovim, Helix, Zed, and any LSP-capable editor.
 *
 * Build:  npm run compile
 * Run:    node dist/server.js --stdio
 */
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DefinitionParams,
  HoverParams,
  ReferenceParams,
  WorkspaceSymbolParams,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  Location,
  SymbolInformation,
  SymbolKind,
  Position as LspPosition,
  Range as LspRange,
  MarkupKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs/promises';

import { SymbolIndex } from '../indexer/SymbolIndex';
import { wordAt, uriToPath, KIND_MAP, buildHoverMarkdown, resolveWorkspaceRoots, preferByImports, canonicalUri, openTextByPath } from './utils';
import { indexFile, scanWorkspace, findUsagesInWorkspace } from './scanner';
import { runMcpServer } from './mcp';

// ── Mode dispatch — --mcp flag routes to MCP server instead of LSP ────────────
// IMPORTANT: createConnection() must not be called at module scope when running
// in MCP mode — both protocols share stdio and would corrupt each other.

if (process.argv.includes('--mcp')) {
  const idx  = process.argv.indexOf('--mcp');
  const root = process.argv[idx + 1] ?? process.cwd();
  runMcpServer(root).catch(e => { process.stderr.write(String(e) + '\n'); process.exit(1); });
} else {
  initLsp();
}

function initLsp(): void {

// ── Connection + document manager ────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents  = new TextDocuments(TextDocument);
documents.listen(connection);

const index = new SymbolIndex();
let workspaceRoots: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The shim's Uri, the only shape SymbolIndex.remove needs. */
function vscodeUri(uri: string): import('vscode').Uri {
  return { toString: () => uri } as unknown as import('vscode').Uri;
}

function entryToLspLocation(entry: { uri: { toString(): string }; line: number; character: number }): Location {
  const pos = LspPosition.create(entry.line, entry.character);
  return Location.create(entry.uri.toString(), LspRange.create(pos, pos));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  workspaceRoots = resolveWorkspaceRoots(params);

  return {
    capabilities: {
      // The object form is what asks for save notifications. With the bare
      // enum, a conformant client never sends textDocument/didSave, and
      // didSave was the ONLY thing refreshing the index: the server answered
      // from its startup snapshot until it was restarted.
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      workspaceSymbolProvider: true,
    },
    serverInfo: { name: 'kotlin-jump', version: '0.7.0' },
  };
});

connection.onInitialized(async () => {
  if (workspaceRoots.length === 0) {
    connection.console.warn('[kotlin-jump] No workspace root announced — nothing indexed.');
    return;
  }
  // Deletions and renames never reached the index: nothing watched the disk,
  // so a removed class stayed navigable and a renamed one appeared twice.
  try {
    await connection.client.register(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: '**/*.{kt,kts,java}' }],
    });
  } catch { /* client without dynamic registration: save still refreshes */ }

  connection.console.log(`[kotlin-jump] Scanning ${workspaceRoots.join(', ')}…`);
  for (const root of workspaceRoots) await scanWorkspace(root, index);
  const { files, symbols } = index.stats();
  connection.console.log(`[kotlin-jump] Ready — ${symbols} symbols in ${files} files`);
});

connection.onDidChangeWatchedFiles(async ({ changes }) => {
  for (const change of changes) {
    if (change.type === FileChangeType.Deleted) index.remove(vscodeUri(canonicalUri(change.uri)));
    else await indexFile(uriToPath(change.uri), index);
  }
  index.finalize();
});

// ── textDocument/definition ───────────────────────────────────────────────────

connection.onDefinition(async (params: DefinitionParams) => {
  const doc = documents.get(params.textDocument.uri);
  const text = doc?.getText() ?? await fs.readFile(uriToPath(params.textDocument.uri), 'utf8').catch(() => '');
  const hit = wordAt(text, params.position.line, params.position.character);
  if (!hit || hit.word.length < 2) return null;

  const decls = index.lookup(hit.word);
  if (decls.length === 0) return null;
  // Three same named classes in a project is normal; the file's own imports
  // say which one it means, so do not hand the editor all of them.
  return preferByImports(text, decls).map(entryToLspLocation);
});

// ── textDocument/hover ────────────────────────────────────────────────────────

connection.onHover(async (params: HoverParams) => {
  const doc = documents.get(params.textDocument.uri);
  const text = doc?.getText() ?? await fs.readFile(uriToPath(params.textDocument.uri), 'utf8').catch(() => '');
  const hit = wordAt(text, params.position.line, params.position.character);
  if (!hit || hit.word.length < 2) return null;

  const decls = index.lookup(hit.word);
  if (decls.length === 0) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: buildHoverMarkdown(decls) },
    range: LspRange.create(
      LspPosition.create(params.position.line, hit.start),
      LspPosition.create(params.position.line, hit.start + hit.word.length),
    ),
  };
});

// ── textDocument/references ───────────────────────────────────────────────────

connection.onReferences(async (params: ReferenceParams) => {
  const doc = documents.get(params.textDocument.uri);
  const text = doc?.getText() ?? await fs.readFile(uriToPath(params.textDocument.uri), 'utf8').catch(() => '');
  const hit = wordAt(text, params.position.line, params.position.character);
  if (!hit || hit.word.length < 2) return null;

  // Read open buffers from the editor, not the disk: with unsaved edits above,
  // every reported position was off by the number of inserted lines.
  const openTexts = openTextByPath(documents.all());
  const locations = await findUsagesInWorkspace(
    hit.word, index, { isCancellationRequested: false },
    async p => openTexts.get(p) ?? fs.readFile(p, 'utf8'),
  );
  if (params.context?.includeDeclaration === false) {
    const decls = index.lookup(hit.word);
    return locations.filter(loc => !decls.some(d =>
      d.uri.toString() === loc.uri && d.line === loc.range.start.line));
  }
  return locations;
});

// ── workspace/symbol ──────────────────────────────────────────────────────────

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
  const query = params.query.trim();
  if (query.length === 0) return [];

  const exact    = query.length >= 2 ? index.lookup(query) : [];
  const searched = index.search(query);
  const seen     = new Set<string>();
  const all      = [...exact, ...searched].filter(e => {
    if (seen.has(e.fqn)) return false;
    seen.add(e.fqn);
    return true;
  });

  return all.slice(0, 50).map(e => ({
    name:          e.name,
    kind:          KIND_MAP[e.kind] ?? SymbolKind.Class,
    location:      entryToLspLocation(e),
    containerName: e.packageName ?? undefined,
  }));
});

// ── File watching — update index on save ─────────────────────────────────────

documents.onDidSave(async event => {
  await indexFile(uriToPath(event.document.uri), index);
});

// ── Start ─────────────────────────────────────────────────────────────────────

connection.listen();

} // end initLsp()
