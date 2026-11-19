import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';
import { resourceTypeAliases } from '../../../src/util/xmlRefs';

/**
 * An open source password manager declares, once:
 *
 *   typealias BitwardenString = com.bitwarden.ui.R.string
 *
 * and writes `BitwardenString.log_out` everywhere, in files that import the
 * ALIAS and never R. Reference prefixes were read file by file from imports,
 * so none of those strings was referenced: 82 414 cuts across the
 * translations, and the UI module no longer compiled.
 */

const mod: any = await importOrNull('src/providers/UnusedResourceKeyProvider');
const scanner: any = await importOrNull('src/indexer/ValueResourceScanner');
const UI = '/w/ui';
const VALUES = `${UI}/src/main/res/values/strings.xml`;
const STRINGS = '<resources>\n    <string name="log_out">Log out</string>\n    <string name="never_used">x</string>\n</resources>\n';
const ALIAS = { path: `${UI}/src/main/kotlin/com/bitwarden/ui/platform/resource/BitwardenResources.kt`, text: 'package com.bitwarden.ui.platform.resource\n\ntypealias BitwardenString = com.bitwarden.ui.R.string\ntypealias BitwardenDrawable = com.bitwarden.ui.R.drawable\n' };
const USE = { path: `${UI}/src/main/kotlin/com/bitwarden/ui/Switcher.kt`, text: 'package com.bitwarden.ui\n\nimport com.bitwarden.ui.platform.resource.BitwardenString\n\nfun label() = stringResource(id = BitwardenString.log_out)\n' };

const find = (sources: { path: string; text: string }[]) => mod.findUnusedResourceKeys({
  declarations: scanner.collectValueKeyDeclarations(VALUES, STRINGS, [UI]),
  sources: [{ path: VALUES, text: STRINGS }, ...sources],
  modulesWithCode: [UI],
}).map((f: any) => `${f.kind}/${f.name}`).sort();

describe('a typealias of R or of one of its kinds', () => {
  it('is collected over the corpus, with its kind', () => {
    expect(resourceTypeAliases([ALIAS])).toEqual([{ prefix: 'BitwardenString', kind: 'string' }, { prefix: 'BitwardenDrawable', kind: 'drawable' }]);
    expect(resourceTypeAliases([{ path: '/w/a/R.kt', text: 'typealias AppR = com.x.R\n' }])).toEqual([{ prefix: 'AppR' }]);
    // The platform's R opens nothing of ours.
    expect(resourceTypeAliases([{ path: '/w/a/R.kt', text: 'typealias Sys = android.R.string\n' }])).toEqual([]);
  });

  describe.skipIf(!mod || !scanner)('the resource keys scan', () => {
    it('a string read through the alias, from another file, is alive', () => {
      expect(find([ALIAS, USE])).toEqual(['string/never_used']);
    });

    it('control: without the alias declaration, the same use reads nothing', () => {
      expect(find([USE])).toEqual(['string/log_out', 'string/never_used']);
    });
  });
});

describe('the resource files scan reads the alias too', () => {
  it('a drawable read through `BitwardenDrawable.ic_lock` is not deleted', async () => {
    const res: any = await importOrNull('src/providers/unusedResources');
    if (!res) return;
    const icon = `${UI}/src/main/res/drawable/ic_lock.xml`;
    const use = { path: `${UI}/src/main/kotlin/com/bitwarden/ui/Lock.kt`, text: 'package com.bitwarden.ui\n\nimport com.bitwarden.ui.platform.resource.BitwardenDrawable\n\nfun icon() = painterResource(id = BitwardenDrawable.ic_lock)\n' };
    const entries = [{ kind: 'drawable', name: 'ic_lock', variants: [{ path: icon, qualifier: 'drawable', moduleDir: UI }] }];
    const run = (sources: any[]) => (res.findUnusedResources({ entries, sources, assets: [], modulesWithCode: [UI], libraryModules: [], includeDrawables: true }) as any[]).map(r => r.name);
    expect(run([ALIAS, use])).toEqual([]);
    expect(run([use])).toEqual(['ic_lock']);
  });
});
