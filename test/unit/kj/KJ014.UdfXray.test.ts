import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-014 — UDF X-Ray. CONTRAT :
 *   export function analyzeStateProvenance(vmText: string): {
 *     property: string;            // nom du backing (_hp) ou de la propriété
 *     exposedAs?: string;          // hp si paire _hp/hp détectée
 *     directWrites: number;
 *     indirectWriteFns: string[];  // fonctions locales qui écrivent via 1 niveau
 *     kind: 'stateflow' | 'livedata' | 'sharedflow';
 *   }[]
 *   export function findReaders(exposedName: string, fileText: string): number
 */
const mod: any = await importOrNull('src/providers/StateProvenanceProvider');
const vm = () => fixture('src/main/kotlin/com/example/kj/g4runtime/UdfXrayViewModel.kt');

describe.skipIf(!mod)('KJ-014 — fixture BattleXrayViewModel', () => {
  const byName = (name: string) =>
    mod.analyzeStateProvenance(vm()).find((p: any) => p.property === name);

  it('_hp : paire détectée, 2 écritures directes, applyPotion en indirect', () => {
    const hp = byName('_hp');
    expect(hp.exposedAs).toBe('hp');
    expect(hp.directWrites).toBe(2); // takeDamage (.value=) + heal (.update)
    expect(hp.indirectWriteFns).toContain('applyPotion');
    expect(hp.kind).toBe('stateflow');
  });

  it('_combatLog : LiveData, 1 écriture (postValue)', () => {
    const log = byName('_combatLog');
    expect(log.kind).toBe('livedata');
    expect(log.directWrites).toBe(1);
  });

  it('_events : SharedFlow, tryEmit compté', () => {
    const ev = byName('_events');
    expect(ev.kind).toBe('sharedflow');
    expect(ev.directWrites).toBe(1);
  });

  it('ticker exposé sans backing : détecté quand même', () => {
    expect(byName('ticker')).toBeTruthy();
  });

  it('_secretBuff sans exposition : exposedAs absent', () => {
    expect(byName('_secretBuff').exposedAs).toBeUndefined();
  });

  it('les lecteurs de hp dans le fichier : 2 collectAsState', () => {
    expect(mod.findReaders('hp', vm())).toBe(2);
  });
});
