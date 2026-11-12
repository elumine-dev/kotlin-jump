import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { findEverythingUnusedCommand } from '../../../src/commands/FindEverythingUnused';
import { UnusedMemberProvider } from '../../../src/providers/UnusedMemberProvider';
import { findUnusedMembers } from '../../../src/providers/unusedMembers';

/**
 * A member that could be private is still used. Find Everything Unused must
 * not report it, even with `unusedMembersSelfOnly` turned on: that verdict
 * belongs to Find Unreferenced Members.
 */

const SOURCES = [
  {
    path: '/w/app/src/main/kotlin/com/x/Cart.kt',
    text: [
      'package com.x', '',
      'class Cart {',
      '    fun total(): Int = subtotalOnlyUsedHere() + 1',
      '    fun subtotalOnlyUsedHere(): Int = 41',
      '    fun neverCalledAnywhere(): Int = 0',
      '}', '',
    ].join('\n'),
  },
  {
    path: '/w/app/src/main/kotlin/com/x/Main.kt',
    text: ['package com.x', '', 'fun main() { println(Cart().total()) }', ''].join('\n'),
  },
];

const corpus: any = {
  get: async () => ({
    sources: SOURCES, moduleDirs: [], modulesWithCode: [], libraryModules: [],
    index: { entries: () => [] },
    truncated: false, sourcesTruncated: false,
  }),
};

afterEach(() => { vi.restoreAllMocks(); delete (vscodeMock.workspace as any).workspaceFolders; });

describe('Find Everything Unused leaves "could be private" out', () => {
  it('the fixture does hold a selfOnly member when the detector is asked for them', () => {
    const found = findUnusedMembers({
      sources: SOURCES, testSourceSets: ['/src/test/'], includeSelfOnly: true, deadDeclarations: [],
    } as any);
    expect(found.filter(m => m.verdict === 'selfOnly').map(m => m.name)).toEqual(['subtotalOnlyUsedHere']);
  });

  it('publishes the unreferenced member and no selfOnly one, setting on or not', async () => {
    (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w') }];
    const on = new Set(['unusedMembers', 'unusedMembersSelfOnly']);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => (typeof def === 'boolean' && !on.has(key) ? false : def),
    } as any);
    (vscodeMock.window as any).withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    let message = '';
    (vscodeMock.window as any).showInformationMessage = async (m: string) => { message = m; return undefined; };
    (vscodeMock.window as any).showWarningMessage = async () => undefined;
    vi.spyOn(UnusedMemberProvider, 'isEnabled').mockReturnValue(true);

    let published: any[] | undefined;
    const stub: any = { setFindings: () => {}, setUnreadable: () => {}, setScan: () => {} };
    const members: any = { ...stub, setFindings: (f: any[]) => { published = f; } };
    await findEverythingUnusedCommand(corpus, stub, stub, stub, stub, stub, stub, stub, stub, members, stub);

    expect(published?.map(m => `${m.name}:${m.verdict}`)).toEqual(['neverCalledAnywhere:unreferenced']);
    expect(message).not.toContain('could be private');
  });
});
