import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { extractKDoc } from '../util/SignatureReader';

// ── Pure helpers (exported for unit tests) ────────────────────────────────────

export type ChatCommand = 'search' | 'implementations' | 'usages' | 'doc';

export function resolveCommand(cmd: string | undefined): ChatCommand {
  if (cmd === 'implementations' || cmd === 'usages' || cmd === 'doc') return cmd;
  return 'search';
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

    switch (cmd) {
      case 'search':        return handleSearch(index, query, stream);
      case 'implementations': return handleImplementations(index, query, stream);
      case 'usages':        return handleUsages(index, query, stream);
      case 'doc':           return handleDoc(index, query, stream);
    }
  };
}

// ── Command handlers ──────────────────────────────────────────────────────────

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

function handleImplementations(index: SymbolIndex, query: string, stream: vscode.ChatResponseStream): vscode.ChatResult {
  const results = index.lookupImplementations(query).slice(0, 10);
  return streamEntries(results, stream, `implementations of \`${query}\``);
}

function handleUsages(index: SymbolIndex, query: string, stream: vscode.ChatResponseStream): vscode.ChatResult {
  // Resolve by FQN (dot-qualified) or simple name
  const entry = query.includes('.')
    ? index.lookupFqn(query)
    : index.lookup(query)[0];

  if (!entry) {
    stream.markdown(`Symbol \`${query}\` not found in the index.`);
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
  const entry = query.includes('.')
    ? index.lookupFqn(query)
    : index.lookup(query)[0];

  if (!entry) {
    stream.markdown(`Symbol \`${query}\` not found in the index.`);
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
    stream.markdown(`Could not read file for \`${entry.fqn}\`.`);
  }
  return {};
}
