import { McpServer }           from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z }                   from 'zod';
import * as fs                 from 'fs/promises';

import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { scanWorkspace }            from './scanner';
import { uriToPath }                from './utils';
import { extractKDocFromLines, formatKDoc } from '../util/SignatureReader';

// ── Result shapes ─────────────────────────────────────────────────────────────

export interface SymbolResult {
  name:        string;
  fqn:         string;
  kind:        string;
  uri:         string;
  line:        number;
  character:   number;
  packageName: string;
  moduleName?: string;
}

export interface KdocResult {
  fqn:  string;
  kdoc: string | null;
}

export interface TestResult {
  name:      string;
  fqn:       string;
  uri:       string;
  line:      number;
  isIgnored: boolean;
}

type ReadFileFn = (path: string) => Promise<string>;

// ── Pure handler functions (exported for unit tests) ──────────────────────────

function toSymbolResult(e: SymbolEntry): SymbolResult {
  return {
    name:        e.name,
    fqn:         e.fqn,
    kind:        e.kind,
    uri:         e.uri.toString(),
    line:        e.line,
    character:   e.character,
    packageName: e.packageName,
    moduleName:  e.moduleName,
  };
}

export function handleFindSymbol(index: SymbolIndex, name: string): SymbolResult[] {
  return index.lookup(name).slice(0, 50).map(toSymbolResult);
}

export function handleFindImplementations(index: SymbolIndex, name: string): SymbolResult[] {
  return index.lookupImplementations(name).slice(0, 50).map(toSymbolResult);
}

export function handleSearchSymbols(index: SymbolIndex, query: string, kind?: string): SymbolResult[] {
  if (!query.trim()) return [];
  return index.search(query, kind).slice(0, 50).map(toSymbolResult);
}

export async function handleGetKdoc(
  index: SymbolIndex,
  fqn: string,
  readFile: ReadFileFn = (p) => fs.readFile(p, 'utf8'),
): Promise<KdocResult> {
  const entry = index.lookupFqn(fqn);
  if (!entry) return { fqn, kdoc: null };

  try {
    const text  = await readFile(uriToPath(entry.uri.toString()));
    const lines = text.split('\n');
    const raw   = extractKDocFromLines(lines, entry.line);
    return { fqn, kdoc: raw };
  } catch {
    return { fqn, kdoc: null };
  }
}

export function handleListTestFunctions(index: SymbolIndex): TestResult[] {
  return index.allEntries()
    .filter(e => e.isTest)
    .slice(0, 200)
    .map(e => ({
      name:      e.name,
      fqn:       e.fqn,
      uri:       e.uri.toString(),
      line:      e.line,
      isIgnored: e.isIgnored ?? false,
    }));
}

function normalizeUri(uri: string): string {
  if (uri.startsWith('file:///')) return uri;
  if (uri.startsWith('file://')) return 'file:///' + uri.slice('file://'.length);
  if (uri.startsWith('/')) {
    const encoded = uri.split('/').map(seg => encodeURIComponent(seg)).join('/');
    return `file://${encoded}`;
  }
  return `file://${uri}`;
}

export function handleGetFileSymbols(index: SymbolIndex, uri: string): SymbolResult[] {
  return index.getFileSymbols(normalizeUri(uri)).map(toSymbolResult);
}

// ── MCP server entry point ────────────────────────────────────────────────────

function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export async function runMcpServer(root: string): Promise<void> {
  const index = new SymbolIndex();
  await scanWorkspace(root, index);

  const server = new McpServer({ name: 'kotlin-jump', version: '1.0.0' });

  server.tool(
    'find_symbol',
    'Find all declarations of a symbol by simple name. Returns locations, kind, and FQN.',
    { name: z.string().describe('Simple symbol name, e.g. "MyViewModel"') },
    async ({ name }) => ({ content: [{ type: 'text' as const, text: toText(handleFindSymbol(index, name)) }] }),
  );

  server.tool(
    'find_implementations',
    'Find all classes or objects that implement or extend a given class/interface by simple name.',
    { name: z.string().describe('Simple name of the interface or abstract class, e.g. "Repository"') },
    async ({ name }) => ({ content: [{ type: 'text' as const, text: toText(handleFindImplementations(index, name)) }] }),
  );

  server.tool(
    'search_symbols',
    'Fuzzy-search symbols by name query, optionally filtered by kind. Returns up to 50 results.',
    {
      query: z.string().describe('Search query, e.g. "ViewModel" or "getUser"'),
      kind:  z.enum(['class', 'interface', 'object', 'enum', 'fun', 'composable', 'val', 'var', 'typealias']).optional()
               .describe('Optional kind filter'),
    },
    async ({ query, kind }) => ({ content: [{ type: 'text' as const, text: toText(handleSearchSymbols(index, query, kind)) }] }),
  );

  server.tool(
    'get_kdoc',
    'Get the KDoc comment for a symbol by its fully qualified name.',
    { fqn: z.string().describe('Fully qualified name, e.g. "com.example.ui.MyViewModel.loadData"') },
    async ({ fqn }) => ({ content: [{ type: 'text' as const, text: toText(await handleGetKdoc(index, fqn)) }] }),
  );

  server.tool(
    'list_test_functions',
    'List all test functions annotated with @Test, @ParameterizedTest, etc. in the workspace.',
    {},
    async () => ({ content: [{ type: 'text' as const, text: toText(handleListTestFunctions(index)) }] }),
  );

  server.tool(
    'get_file_symbols',
    'Get all symbols declared in a specific file by its URI.',
    { uri: z.string().describe('File URI (file:///absolute/path/to/File.kt) or absolute path') },
    async ({ uri }) => ({ content: [{ type: 'text' as const, text: toText(handleGetFileSymbols(index, uri)) }] }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
