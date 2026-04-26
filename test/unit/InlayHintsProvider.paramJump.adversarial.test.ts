/**
 * ADV — Cmd+Click on a parameter inlay hint jumps to the parameter
 * declaration in the called function, not to the function's name line.
 *
 * Reproducer (Kevin's ApiServiceImpl.kt):
 *   data class User(val id: String, val name: String, val email: String, ...)
 *   ...
 *   return User(id, "John Doe", "john@example.com", UserRole.VIEWER)
 *                    ↑
 *           inlay hint shows `name = "John Doe"`. Cmd+Click on `name`
 *           must land on `val name: String` in the User data class.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position, Range } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

afterEach(() => vi.restoreAllMocks());

const token = { isCancellationRequested: false } as any;

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function makeRange(code: string): Range {
  const lines = code.split('\n');
  return new Range(new Position(0, 0), new Position(lines.length - 1, lines[lines.length - 1].length));
}

describe('ADV-INLAY-PARAM-JUMP', () => {
  it('Cmd+Click on `name =` inlay points at `val name: String` in the data class', async () => {
    // Single-file scenario so the resolver sees the User declaration
    // without needing import resolution heuristics. The call site sits
    // inside a function body (not a single-expression decl) so the
    // FUN_DECL_RE skip-guard doesn't suppress pass-1 hints.
    const uri = 'file:///User.kt';
    const code =
      'data class User(\n' +
      '    val id: String,\n' +
      '    val name: String,\n' +
      '    val email: String,\n' +
      ')\n' +
      '\n' +
      'fun mk(): User {\n' +
      '    return User("a", "John Doe", "x@example.com")\n' +
      '}';

    const index = new SymbolIndex();
    addFile(index, uri, code);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(
      mockDocument(uri, code) as any,
    );

    const provider = new KotlinInlayHintsProvider(index);
    const callDoc  = mockDocument(uri, code);
    const hints = await provider.provideInlayHints(callDoc, makeRange(code), token);

    // Find the hint for `name`.
    const nameHint = hints.find(h => {
      if (typeof h.label === 'string') return h.label.startsWith('name');
      return Array.isArray(h.label) && (h.label[0] as any).value?.startsWith('name');
    });
    expect(nameHint, 'no `name` inlay hint emitted').toBeDefined();

    const labelPart = (Array.isArray(nameHint!.label) ? nameHint!.label[0] : null) as any;
    expect(labelPart, 'label must be a label-part array (so .location can be set)').toBeDefined();

    const loc = labelPart.location;
    expect(loc, 'label part has no location — Cmd+Click would do nothing').toBeDefined();
    expect(loc.uri.toString()).toBe(uri);
    // `val name: String,` is on line 2 (0-indexed):
    //   0: `data class User(`
    //   1: `    val id: String,`
    //   2: `    val name: String,`
    expect(loc.range.start.line).toBe(2);
    expect(loc.range.start.character).toBe(code.split('\n')[2].indexOf('name'));
  });

  it('Cmd+Click on `email =` inlay points at `val email: String` (different line)', async () => {
    const userUri = 'file:///User2.kt';
    const userCode =
      'data class User(\n' +
      '    val id: String,\n' +
      '    val name: String,\n' +
      '    val email: String,\n' +
      ')';

    const callUri  = 'file:///Caller.kt';
    const callCode = 'fun mk(): User {\n    return User("a", "b", "c")\n}';

    const index = new SymbolIndex();
    addFile(index, userUri, userCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(
      mockDocument(userUri, userCode) as any,
    );

    const provider = new KotlinInlayHintsProvider(index);
    const callDoc  = mockDocument(callUri, callCode);
    const hints = await provider.provideInlayHints(callDoc, makeRange(callCode), token);

    const emailHint = hints.find(h => {
      if (typeof h.label === 'string') return h.label.startsWith('email');
      return Array.isArray(h.label) && (h.label[0] as any).value?.startsWith('email');
    });
    expect(emailHint).toBeDefined();
    const labelPart = (Array.isArray(emailHint!.label) ? emailHint!.label[0] : null) as any;
    expect(labelPart.location).toBeDefined();
    expect(labelPart.location.range.start.line).toBe(3); // `val email: String,`
  });
});
