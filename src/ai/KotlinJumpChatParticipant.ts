import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { extractKDoc } from '../util/SignatureReader';

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export type ChatCommand = 'search' | 'implementations' | 'usages' | 'doc';

export function resolveCommand(cmd: string | undefined): ChatCommand {
  if (cmd === 'implementations' || cmd === 'usages' || cmd === 'doc') return cmd;
  return 'search';
}

// Detects natural-language patterns and extracts intent + symbol name.
// e.g. "find all implementations of PokemonRepository" → { cmd: 'implementations', query: 'PokemonRepository' }
export function parseNaturalLanguage(prompt: string): { cmd: ChatCommand; query: string } | undefined {
  let m: RegExpMatchArray | null;
  // (\w(?:[\w.$]*\w)?) captures a valid Java/Kotlin identifier or FQN and stops
  // before trailing punctuation — (\S+) would swallow "Foo." or "Foo?".
  if ((m = prompt.match(/\bimplementations?\s+of\s+(\w(?:[\w.$]*\w)?)/i)))
    return { cmd: 'implementations', query: m[1] };
  if ((m = prompt.match(/\busages?\s+of\s+(\w(?:[\w.$]*\w)?)/i)))
    return { cmd: 'usages', query: m[1] };
  if ((m = prompt.match(/\b(?:k?doc|documentation)\s+(?:for|of)\s+(\w(?:[\w.$]*\w)?)/i)))
    return { cmd: 'doc', query: m[1] };
  return undefined;
}

export function pickEntries(index: SymbolIndex, query: string): SymbolEntry[] {
  if (!query.trim()) return [];

  const exact = index.lookup(query);
  const fuzzy = index.search(query);

  const seen = new Set<string>();
  const merged: SymbolEntry[] = [];
  for (const e of [...exact, ...fuzzy]) {
    if (!seen.has(e.fqn)) { seen.add(e.fqn); merged.push(e); }
    if (merged.length >= 10) break;
  }
  return merged;
}

// ── VS Code boundary (not unit-tested) ───────────────────────────────────────

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  index: SymbolIndex,
): void {
  const participant = vscode.chat.createChatParticipant('kotlin-jump', makeHandler(index));
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.png');
  context.subscriptions.push(participant);
}

function makeHandler(index: SymbolIndex): vscode.ChatRequestHandler {
  return async (
    request: vscode.ChatRequest,
    _ctx: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> => {
    const cmd   = resolveCommand(request.command);
    const query = request.prompt.trim();

    if (!query) {
      stream.markdown('Please provide a symbol name or query.');
      return {};
    }

    // Natural-language routing for plain prompts (no slash command)
    if (cmd === 'search') {
      const nl = parseNaturalLanguage(query);
      if (nl) {
        switch (nl.cmd) {
          case 'implementations': return handleImplementations(index, nl.query, stream);
          case 'usages':          return handleUsages(index, nl.query, stream);
          case 'doc':             return handleDoc(index, nl.query, stream);
        }
      }
    }

    switch (cmd) {
      case 'search':          return handleSearch(index, query, stream);
      case 'implementations': return handleImplementations(index, query, stream);
      case 'usages':          return handleUsages(index, query, stream);
      case 'doc':             return handleDoc(index, query, stream);
    }
  };
}

// ── Command handlers ──────────────────────────────────────────────────────────

// Wraps a user-provided string in a Markdown inline code span.
// Uses the minimum number of backticks needed as delimiters so that any
// backtick sequence inside the string is safely enclosed (CommonMark spec).
function mdCode(s: string): string {
  let maxRun = 0, run = 0;
  for (const ch of s) {
    run = ch === '`' ? run + 1 : 0;
    if (run > maxRun) maxRun = run;
  }
  const delim = '`'.repeat(maxRun + 1);
  return `${delim}${s}${delim}`;
}

// Resolves a query to a SymbolEntry: FQN lookup for dot-qualified queries,
// with a fallback to simple-name lookup on the last segment if FQN yields nothing.
function resolveEntry(index: SymbolIndex, query: string): SymbolEntry | undefined {
  if (!query.includes('.')) return index.lookup(query)[0];
  const lastSegment = query.split('.').pop()!;
  if (!lastSegment) return undefined; // query is "." or ends with "."
  return index.lookupFqn(query) ?? index.lookup(lastSegment)[0];
}

function streamEntries(entries: SymbolEntry[], stream: vscode.ChatResponseStream, label: string): vscode.ChatResult {
  if (entries.length === 0) {
    stream.markdown(`No ${label} found.`);
    return {};
  }
  for (const e of entries) {
    stream.anchor(
      new vscode.Location(e.uri, new vscode.Position(e.line, e.character)),
      e.fqn,
    );
    stream.markdown(` — \`${e.kind}\` in \`${e.packageName || '(default package)'}\`\n`);
  }
  return {};
}

function handleSearch(index: SymbolIndex, query: string, stream: vscode.ChatResponseStream): vscode.ChatResult {
  return streamEntries(pickEntries(index, query), stream, 'symbols');
}

// Exported for testing — pure logic shared by handleImplementations.
// Handles two failure modes that bySuper.get() cannot cover on its own:
//   BUG-1  case mismatch: user types "pokemonrepository" → key is "PokemonRepository"
//   BUG-2  FQN query: "com.example.GymChallenge" → bySuper stores simple names only
export function resolveImplementations(index: SymbolIndex, query: string): SymbolEntry[] {
  // BUG-2 fix: strip package prefix — bySuper keys are always simple names
  const simpleName = query.includes('.') ? (query.split('.').pop() ?? '') : query;
  if (!simpleName) return [];

  const direct = index.lookupImplementations(simpleName);
  if (direct.length > 0) return direct.slice(0, 10);

  // BUG-1 fix: case-insensitive fallback via search(), which normalises to lowercase
  const resolved = index.lookup(simpleName)[0] ?? index.search(simpleName)[0];
  if (resolved && resolved.name !== simpleName) {
    return index.lookupImplementations(resolved.name).slice(0, 10);
  }
  return [];
}

function handleImplementations(index: SymbolIndex, query: string, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const results = resolveImplementations(index, query);
  return streamEntries(results, stream, `implementations of ${mdCode(query)}`);
}

function handleUsages(index: SymbolIndex, query: string, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const entry = resolveEntry(index, query);

  if (!entry) {
    stream.markdown(`Symbol ${mdCode(query)} not found in the index.`);
    return {};
  }

  stream.anchor(
    new vscode.Location(entry.uri, new vscode.Position(entry.line, entry.character)),
    entry.fqn,
  );
  stream.markdown(` — \`${entry.kind}\` in \`${entry.packageName || '(default package)'}\`\n\n`);
  stream.markdown('Use **Alt+F7** (Find Usages) to see all usages across the workspace.');
  return {};
}

async function handleDoc(index: SymbolIndex, query: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
  const entry = resolveEntry(index, query);

  if (!entry) {
    stream.markdown(`Symbol ${mdCode(query)} not found in the index.`);
    return {};
  }

  try {
    const doc  = await vscode.workspace.openTextDocument(entry.uri);
    const kdoc = extractKDoc(doc, entry.line);
    if (kdoc) {
      stream.anchor(
        new vscode.Location(entry.uri, new vscode.Position(entry.line, entry.character)),
        entry.fqn,
      );
      stream.markdown('\n\n' + kdoc);
    } else {
      stream.anchor(
        new vscode.Location(entry.uri, new vscode.Position(entry.line, entry.character)),
        entry.fqn,
      );
      stream.markdown(' — No KDoc found.');
    }
  } catch {
    stream.markdown(`Could not read file for ${mdCode(entry.fqn)}.`);
  }
  return {};
}
