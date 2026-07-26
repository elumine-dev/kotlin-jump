import { describe, it, expect } from 'vitest';
import {
  analyzeStateProvenance,
  findReaders,
} from '../../../src/providers/StateProvenanceProvider';

/** KJ-014 — tentatives de casse au-delà du contrat. */

describe('KJ-014 adversarial — écritures', () => {
  it('écriture composée value += comptée', () => {
    const vm = `
      private val _hp = MutableStateFlow(100)
      val hp = _hp.asStateFlow()
      fun regen() { _hp.value += 5 }
    `;
    expect(analyzeStateProvenance(vm)[0].directWrites).toBe(1);
  });

  it('comparaison value == PAS comptée', () => {
    const vm = `
      private val _hp = MutableStateFlow(100)
      fun isDead() = _hp.value == 0
    `;
    expect(analyzeStateProvenance(vm)[0].directWrites).toBe(0);
  });

  it('indirection à DEUX niveaux non comptée (contrat : 1 niveau)', () => {
    const vm = `
      private val _hp = MutableStateFlow(100)
      fun write() { _hp.value = 1 }
      fun level1() { write() }
      fun level2() { level1() }
    `;
    const hp = analyzeStateProvenance(vm)[0];
    expect(hp.indirectWriteFns).toContain('level1');
    expect(hp.indirectWriteFns).not.toContain('level2');
  });

  it('fonction à expression body qui écrit : comptée en directe', () => {
    const vm = `
      private val _hp = MutableStateFlow(100)
      fun reset() = _hp.update { 100 }
    `;
    expect(analyzeStateProvenance(vm)[0].directWrites).toBe(1);
  });

  it('deux ViewModels dans le même fichier : propriétés séparées', () => {
    const vm = `
      class A { private val _x = MutableStateFlow(1) ; fun w() { _x.value = 2 } }
      class B { private val _y = MutableStateFlow(1) }
    `;
    const all = analyzeStateProvenance(vm);
    expect(all.map(s => s.property)).toEqual(['_x', '_y']);
    expect(all[1].directWrites).toBe(0);
  });
});

describe('KJ-014 adversarial — BUG-HUNT-19', () => {
  it('exposition avec commentaire de fin de ligne détectée quand même', () => {
    const vm = `
      private val _hp = MutableStateFlow(100)
      val hp: StateFlow<Int> = _hp.asStateFlow() // exposé pour l'UI
      fun hit() { _hp.value = 1 }
    `;
    expect(analyzeStateProvenance(vm)[0].exposedAs).toBe('hp');
  });
});

describe('KJ-014 adversarial — lecteurs', () => {
  it('hpBar.collectAsState ne compte PAS pour hp (frontière)', () => {
    const text = 'val a = vm.hpBar.collectAsState()\n';
    expect(findReaders('hp', text)).toBe(0);
  });

  it('collect avec lambda accolade compté', () => {
    const text = 'scope.launch { vm.events.collect { handle(it) } }\n';
    expect(findReaders('events', text)).toBe(1);
  });

  it('collectAsStateWithLifecycle (variante lifecycle) compté', () => {
    const text = 'val s = vm.hp.collectAsStateWithLifecycle()\n';
    expect(findReaders('hp', text)).toBe(1);
  });
});
