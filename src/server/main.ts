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
import { wordAt, uriToPath, KIND_MAP, buildHoverMarkdown } from './utils';
import { indexFile, scanWorkspace, findUsagesInWorkspace } from './scanner';

// ── Connection + document manager ────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents  = new TextDocuments(TextDocument);
documents.listen(connection);

const index = new SymbolIndex();
let workspaceRoot = '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function entryToLspLocation(entry: { uri: { toString(): string }; line: number; character: number }): Location {
  const pos = LspPosition.create(entry.line, entry.character);
  return Location.create(entry.uri.toString(), LspRange.create(pos, pos));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  workspaceRoot = params.rootUri
    ? uriToPath(params.rootUri)
    : (params.rootPath ?? process.cwd());

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      workspaceSymbolProvider: true,
    },
    serverInfo: { name: 'kotlin-jump', version: '0.7.0' },
  };
});

connection.onInitialized(async () => {
  connection.console.log(`[kotlin-jump] Scanning ${workspaceRoot}…`);
  await scanWorkspace(workspaceRoot, index);
  const { files, symbols } = index.stats();
  connection.console.log(`[kotlin-jump] Ready — ${symbols} symbols in ${files} files`);
});

// ── textDocument/definition ───────────────────────────────────────────────────

connection.onDefinition(async (params: DefinitionParams) => {
  const doc = documents.get(params.textDocument.uri);
  const text = doc?.getText() ?? await fs.readFile(uriToPath(params.textDocument.uri), 'utf8').catch(() => '');
  const hit = wordAt(text, params.position.line, params.position.character);
  if (!hit || hit.word.length < 2) return null;

  const decls = index.lookup(hit.word);
  if (decls.length === 0) return null;
  return decls.map(entryToLspLocation);
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

  return findUsagesInWorkspace(hit.word, index, { isCancellationRequested: false });
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
