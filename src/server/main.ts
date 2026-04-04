/**
 * Kotlin Jump — standalone LSP server.
 *
 * Provides navigation features (Go to Definition, Find Usages, Hover,
 * Workspace Symbols) for Kotlin and Java files without VS Code.
 * Intended for Neovim, Helix, Zed, and any LSP-capable editor.
 *
 * Build:  npm run build:server
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
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs/promises';
import * as path from 'path';

import { SymbolIndex } from '../indexer/SymbolIndex';
import { parse as parseKotlin } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { escapeRegex } from '../providers/FindUsagesEngine';
import { isInsideCommentOrString } from '../util/textUtils';

// ── Connection + document manager ────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents  = new TextDocuments(TextDocument);
documents.listen(connection);

const index = new SymbolIndex();
let workspaceRoot = '';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WORD_RE = /[A-Za-z_]\w*/g;

function wordAt(text: string, line: number, char: number): { word: string; start: number } | null {
  const lines = text.split('\n');
  const lineText = lines[line] ?? '';
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(lineText)) !== null) {
    if (m.index <= char && char < m.index + m[0].length) {
      return { word: m[0], start: m.index };
    }
  }
  return null;
}

function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function pathToUri(fsPath: string): string {
  return 'file://' + fsPath.replace(/ /g, '%20');
}

function entryToLspLocation(entry: { uri: { toString(): string }; line: number; character: number }): Location {
  const pos = LspPosition.create(entry.line, entry.character);
  return Location.create(entry.uri.toString(), LspRange.create(pos, pos));
}

const KIND_MAP: Record<string, SymbolKind> = {
  class:       SymbolKind.Class,
  dataClass:   SymbolKind.Class,
  sealedClass: SymbolKind.Class,
  interface:   SymbolKind.Interface,
  object:      SymbolKind.Object,
  enum:        SymbolKind.Enum,
  annotation:  SymbolKind.Class,
  fun:         SymbolKind.Function,
  composable:  SymbolKind.Function,
  val:         SymbolKind.Constant,
  var:         SymbolKind.Variable,
  typealias:   SymbolKind.TypeParameter,
};

// ── File scanning ─────────────────────────────────────────────────────────────

async function indexFile(fsPath: string): Promise<void> {
  try {
    const text = await fs.readFile(fsPath, 'utf8');
    const uri  = pathToUri(fsPath);
    const parsed = fsPath.endsWith('.java') ? parseJava(uri, text) : parseKotlin(uri, text);
    index.add(parsed);
  } catch {
    // skip unreadable files
  }
}

async function scanWorkspace(root: string): Promise<void> {
  const entries: string[] = [];
  async function walk(dir: string) {
    let children: string[];
    try { children = await fs.readdir(dir); } catch { return; }
    await Promise.all(children.map(async name => {
      const full = path.join(dir, name);
      if (name === 'build' || name === '.gradle' || name === '.git' || name === 'node_modules') return;
      let stat;
      try { stat = await fs.stat(full); } catch { return; }
      if (stat.isDirectory()) { await walk(full); }
      else if (name.endsWith('.kt') || name.endsWith('.kts') || name.endsWith('.java')) {
        entries.push(full);
      }
    }));
  }
  await walk(root);

  // Index in batches of 20 concurrent reads
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      await indexFile(entries[cursor++]);
    }
  };
  await Promise.all(Array.from({ length: 20 }, worker));
  index.finalize();
}

// ── Scan usages (server-side, reads files via Node fs) ────────────────────────

async function findUsagesInWorkspace(
  word: string,
  token: { isCancellationRequested: boolean },
): Promise<Location[]> {
  const decls = index.lookup(word);
  if (decls.length === 0) return [];

  const uriStrings = index.fileUriStrings();
  const wordRe     = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
  const results: Location[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      if (token.isCancellationRequested || results.length >= 500) return;
      const uriStr = uriStrings[cursor++];
      const fsPath = uriToPath(uriStr);
      try {
        const text = await fs.readFile(fsPath, 'utf8');
        if (!text.includes(word)) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trimStart();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
          wordRe.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = wordRe.exec(lines[i])) !== null) {
            if (!isInsideCommentOrString(lines[i], m.index)) {
              results.push(Location.create(
                uriStr,
                LspRange.create(LspPosition.create(i, m.index), LspPosition.create(i, m.index + word.length)),
              ));
            }
          }
        }
      } catch { /* skip */ }
    }
  };
  await Promise.all(Array.from({ length: 20 }, worker));
  return results;
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
  await scanWorkspace(workspaceRoot);
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

  const lines: string[] = [];
  for (const d of decls.slice(0, 5)) {
    const kindLabel = d.kind === 'dataClass' ? 'data class'
      : d.kind === 'sealedClass' ? 'sealed class'
      : d.kind;
    lines.push(`\`\`\`kotlin\n${kindLabel} ${d.fqn}\n\`\`\``);
    if (d.packageName) lines.push(`*Package:* \`${d.packageName}\``);
    const file = d.uri.toString().split('/').pop() ?? '';
    lines.push(`*File:* \`${file}\``);
    if (d.moduleName) lines.push(`*Module:* \`${d.moduleName}\``);
    lines.push('');
  }

  return {
    contents: { kind: MarkupKind.Markdown, value: lines.join('\n').trimEnd() },
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

  return findUsagesInWorkspace(hit.word, { isCancellationRequested: false });
});

// ── workspace/symbol ──────────────────────────────────────────────────────────

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
  const query = params.query.trim();
  if (query.length === 0) return [];

  const entries = query.length >= 2 ? index.lookup(query) : [];
  const searched = index.search(query, 50);
  const seen = new Set<string>();
  const all = [...entries, ...searched].filter(e => {
    if (seen.has(e.fqn)) return false;
    seen.add(e.fqn);
    return true;
  });

  return all.slice(0, 50).map(e => ({
    name: e.name,
    kind: KIND_MAP[e.kind] ?? SymbolKind.Class,
    location: entryToLspLocation(e),
    containerName: e.packageName ?? undefined,
  }));
});

// ── File watching — update index on save ─────────────────────────────────────

documents.onDidSave(async event => {
  await indexFile(uriToPath(event.document.uri));
});

// ── Start ─────────────────────────────────────────────────────────────────────

connection.listen();
