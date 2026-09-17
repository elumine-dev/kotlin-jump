import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-059 — une entree de baseline detekt dont le fichier n existe plus.
 *
 * Une baseline est la liste des defauts que l equipe accepte, une ligne
 * `<ID>` par defaut, cle par regle, nom de fichier et signature. Quand le
 * fichier part, l entree reste : detekt ne se plaint jamais d un defaut qu il
 * ne trouve pas. Sur le projet de reference la branche ecrite a la main en a
 * retire quatre, une par fichier supprime, et en a laisse trois plus vieilles.
 *
 * Seul le test du fichier compte. Une signature qui ne correspond plus n est
 * pas rapportee : detekt la normalise d une facon qu une comparaison textuelle
 * ne reproduit pas, et retirer a tort fait echouer la tache lint.
 */

const mod: any = await importOrNull('src/providers/staleBaselineEntries');

const BASELINE = [
  '<?xml version="1.0" ?>',
  '<SmellBaseline>',
  '  <ManuallySuppressedIssues>',
  '    <ID>TooManyFunctions:Keep.kt$Keep</ID>',
  '  </ManuallySuppressedIssues>',
  '  <CurrentIssues>',
  '    <ID>MayBeConst:Gone.kt$Gone.Companion$private val SEPARATOR = "/"</ID>',
  '    <ID>MagicNumber:Keep.kt$Keep$11</ID>',
  '    <ID>UnnecessaryParentheses:AlsoGone.java$AlsoGone$(a / b)</ID>',
  '  </CurrentIssues>',
  '</SmellBaseline>',
  '',
].join('\n');

const baseline = { path: '/p/config/detekt/baseline.xml', text: BASELINE };
const keep = { path: '/p/app/src/main/java/com/x/Keep.kt', text: 'package com.x\n\nclass Keep\n' };

describe.skipIf(!mod)('findStaleBaselineEntries', () => {
  it('une entree dont le fichier n existe plus est rapportee, ligne entiere', () => {
    const found = mod.findStaleBaselineEntries({ sources: [baseline, keep] });
    expect(found.map((e: any) => e.file)).toEqual(['Gone.kt', 'AlsoGone.java']);
    expect(found[0].rule).toBe('MayBeConst');
    expect(found[0].line).toBe(6);
    expect(BASELINE.slice(found[0].removeStart, found[0].removeEnd))
      .toBe('    <ID>MayBeConst:Gone.kt$Gone.Companion$private val SEPARATOR = "/"</ID>\n');
  });

  it('un fichier homonyme n importe ou dans le corpus garde l entree', () => {
    const elsewhere = { path: '/p/other/src/test/java/com/y/Gone.kt', text: 'package com.y\n' };
    const found = mod.findStaleBaselineEntries({ sources: [baseline, keep, elsewhere] });
    expect(found.map((e: any) => e.file)).toEqual(['AlsoGone.java']);
  });

  it('une signature qui ne correspond plus ne suffit pas', () => {
    // `Keep.kt` existe et n a pas de `11` : l entree MagicNumber reste.
    const found = mod.findStaleBaselineEntries({ sources: [baseline, keep] });
    expect(found.some((e: any) => e.rule === 'MagicNumber')).toBe(false);
  });

  it('un baseline.xml qui n est pas detekt est ignore', () => {
    const lint = { path: '/p/app/baseline.xml', text: '<issues format="6">\n  <issue id="Gone.kt"/>\n</issues>\n' };
    expect(mod.findStaleBaselineEntries({ sources: [lint, keep] })).toEqual([]);
  });

  it('un corpus tronque ne prouve rien', () => {
    expect(mod.findStaleBaselineEntries({ sources: [baseline, keep], truncated: true })).toEqual([]);
  });

  it('le resume compte ce qu il y a, et rien quand il n y a rien', () => {
    expect(mod.staleBaselineSummary([])).toBe('No stale baseline entry: every file a baseline names still exists.');
    expect(mod.staleBaselineSummary([{ file: 'a.kt' }, { file: 'a.kt' }, { file: 'b.kt' }]))
      .toBe('3 stale baseline entries for 2 files that no longer exist.');
  });
});
