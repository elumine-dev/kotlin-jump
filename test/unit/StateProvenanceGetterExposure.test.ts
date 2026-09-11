/**
 * KJ-014 — l'exposition ecrite avec un accesseur n'etait pas vue.
 *
 * La paire canonique est `private val _x = MutableStateFlow(...)` puis
 * `val x = _x.asStateFlow()`. Kotlin l'ecrit aussi avec un accesseur :
 * `val x: StateFlow<T> get() = _x`. La detection exigeait un `=` juste apres le
 * nom ou son type, donc cette seconde forme ne correspondait a rien.
 *
 * Consequence visible : l'info bulle annonce « _x: no public exposure
 * detected », et surtout la lentille des lecteurs compte les lecteurs de `_x`,
 * le backing prive que personne ne collecte, au lieu de ceux de `x`. Elle
 * affiche donc « 0 readers in this file » alors que l'ecran collecte l'etat.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse, par le chemin de production :
 * 166 etats a backing `_`, 141 expositions detectees, 25 sans. Sur ces 25,
 * **23 ne sont reellement pas exposes** (doublures de test, etat interne) et
 * **2** utilisent l'accesseur, dans AdminNotificationViewModel et
 * NotificationCenterViewModel.
 */
import { describe, it, expect } from 'vitest';
import { analyzeStateProvenance } from '../../src/providers/StateProvenanceProvider';

const NL = String.fromCharCode(10);
const vm = (corps: string[]) => ['class Vm {', ...corps.map(l => '    ' + l), '}'].join(NL);
const expo = (corps: string[]) => analyzeStateProvenance(vm(corps))[0]?.exposedAs;

describe('analyzeStateProvenance — les formes d exposition', () => {
  it('accesseur : val x: StateFlow<T> get() = _x', () => {
    expect(expo([
      'private val _state = MutableStateFlow(0)',
      'val state: StateFlow<Int> get() = _state',
    ])).toBe('state');
  });

  it('accesseur sans type declare', () => {
    expect(expo([
      'private val _state = MutableStateFlow(0)',
      'val state get() = _state',
    ])).toBe('state');
  });

  it('temoin : la forme asStateFlow reste detectee', () => {
    expect(expo([
      'private val _hp = MutableStateFlow(100)',
      'val hp = _hp.asStateFlow()',
    ])).toBe('hp');
  });

  it('temoin : la forme nue reste detectee', () => {
    expect(expo([
      'private val _log = MutableLiveData<String>()',
      'val log: LiveData<String> = _log',
    ])).toBe('log');
  });

  it('temoin : un backing sans exposition n en invente pas', () => {
    expect(expo(['private val _interne = MutableStateFlow(0)'])).toBeUndefined();
  });

  it('temoin : un accesseur vers un AUTRE etat ne compte pas', () => {
    // La garde de fin de ligne doit tenir : `_stateBis` n est pas `_state`.
    expect(expo([
      'private val _state = MutableStateFlow(0)',
      'val autre: StateFlow<Int> get() = _stateBis',
    ])).toBeUndefined();
  });
});
