import { describe, it, expect } from 'vitest';
import { analyzeDispatcherScopes } from '../../../src/providers/DispatcherLensProvider';

/** KJ-019 — tentatives de casse au-delà du contrat. */

describe('KJ-019 adversarial', () => {
  it('withContext(Dispatchers.IO + limitedParallelism) reconnu', () => {
    const text = 'suspend fun f() {\n  withContext(Dispatchers.IO.limitedParallelism(4)) {\n    api.fetch()\n  }\n}';
    const { scopes } = analyzeDispatcherScopes(text);
    expect(scopes).toHaveLength(1);
    expect(scopes[0].dispatcher).toBe('IO');
  });

  it('accolade dans une string du bloc ne fausse pas endLine', () => {
    const text = 'fun f() {\n  scope.launch(Dispatchers.IO) {\n    log("brace } inside")\n    api.fetch()\n  }\n}';
    const { scopes } = analyzeDispatcherScopes(text);
    expect(scopes[0].endLine).toBe(4);
  });

  it('binding en Main : PAS de view-in-io', () => {
    const text = 'fun f() {\n  scope.launch(Dispatchers.Main) {\n    binding.title.setText("x")\n  }\n}';
    const { hints } = analyzeDispatcherScopes(text);
    expect(hints.some(h => h.kind === 'view-in-io')).toBe(false);
  });

  it('api en IO : PAS de blocking-in-main', () => {
    const text = 'fun f() {\n  withContext(Dispatchers.IO) {\n    api.fetchAll()\n  }\n}';
    const { hints } = analyzeDispatcherScopes(text);
    expect(hints).toHaveLength(0);
  });

  it('launch sans dispatcher : aucune portée (pas de fausse certitude)', () => {
    const text = 'fun f() {\n  viewModelScope.launch {\n    api.fetch()\n  }\n}';
    expect(analyzeDispatcherScopes(text).scopes).toHaveLength(0);
  });

  it('flow sans flowOn : aucune portée', () => {
    const text = 'fun f() = flow {\n  emit(1)\n}';
    expect(analyzeDispatcherScopes(text).scopes).toHaveLength(0);
  });

  it('BUG-HUNT-10 : deux portées ouvertes sur la MÊME ligne — la plus interne gagne', () => {
    const text =
      'suspend fun f() { withContext(Dispatchers.IO) { scope.launch(Dispatchers.Main) { binding.title.setText("x") } } }';
    const { hints } = analyzeDispatcherScopes(text);
    // binding est dans la portée Main interne : PAS de view-in-io.
    expect(hints.some(h => h.kind === 'view-in-io')).toBe(false);
  });

  it('viewFinder (préfixe view) en IO : signalé aussi', () => {
    const text = 'fun f() {\n  withContext(Dispatchers.IO) {\n    viewFinder.rotation = 90f\n  }\n}';
    const { hints } = analyzeDispatcherScopes(text);
    expect(hints).toContainEqual({ line: 2, kind: 'view-in-io' });
  });
});
