import { describe, it, expect } from 'vitest';
import { pickEntries, resolveCommand } from '../../src/ai/KotlinJumpChatParticipant';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIndex(sources: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, src] of Object.entries(sources)) index.add(parse(uri, src));
  index.finalize();
  return index;
}

const PKG = 'package com.example\n';

// ── resolveCommand ────────────────────────────────────────────────────────────

describe('resolveCommand', () => {
  it('returns search for undefined command', () => {
    expect(resolveCommand(undefined)).toBe('search');
  });

  it('returns search for empty string', () => {
    expect(resolveCommand('')).toBe('search');
  });

  it('returns search for unknown command', () => {
    expect(resolveCommand('whatever')).toBe('search');
  });

  it('returns implementations for "implementations"', () => {
    expect(resolveCommand('implementations')).toBe('implementations');
  });

  it('returns usages for "usages"', () => {
    expect(resolveCommand('usages')).toBe('usages');
  });

  it('returns doc for "doc"', () => {
    expect(resolveCommand('doc')).toBe('doc');
  });

  it('returns search for "search"', () => {
    expect(resolveCommand('search')).toBe('search');
  });
});

// ── pickEntries ───────────────────────────────────────────────────────────────

describe('pickEntries', () => {
  it('returns empty array for empty query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Alpha` });
    expect(pickEntries(index, '')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Alpha` });
    expect(pickEntries(index, '   ')).toEqual([]);
  });

  it('finds symbol by exact name via lookup', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class MyViewModel` });
    const results = pickEntries(index, 'MyViewModel');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyViewModel');
  });

  it('finds symbol via search fallback when lookup returns nothing', () => {
    // 'UserProfile' is a prefix of 'UserProfileRepository' — lookup('UserProfile') returns [],
    // so pickEntries falls back to search() which finds it via prefix match.
    const index = makeIndex({ 'file:///A.kt': `${PKG}class UserProfileRepository` });
    const results = pickEntries(index, 'UserProfile');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('UserProfileRepository');
  });

  it('deduplicates results (same FQN from lookup + search)', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Loader` });
    const results = pickEntries(index, 'Loader');
    const fqns = results.map(r => r.fqn);
    const unique = new Set(fqns);
    expect(fqns.length).toBe(unique.size);
  });

  it('caps results at 10', () => {
    const sources: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      sources[`file:///p${i}/Widget.kt`] = `package p${i}\nclass Widget`;
    }
    const index = makeIndex(sources);
    expect(pickEntries(index, 'Widget').length).toBeLessThanOrEqual(10);
  });

  it('prioritises exact lookup over fuzzy results', () => {
    const src = `${PKG}class Loader\nclass LoaderHelper`;
    const index = makeIndex({ 'file:///A.kt': src });
    const results = pickEntries(index, 'Loader');
    // Exact match should appear first
    expect(results[0].name).toBe('Loader');
  });

  it('returns empty for query that matches nothing', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Completely` });
    expect(pickEntries(index, 'XyzNoMatch99')).toEqual([]);
  });
});

// ── BUG A — Surface d'injection Markdown dans pickEntries ─────────────────────
// Les handlers internes (handleImplementations, handleUsages, handleDoc) interpolent
// query directement dans des templates backtick sans échappement.
// pickEntries est testé ici pour confirmer que le pipeline lookup ne crashe pas
// et que les entrées retournées ne contiennent pas le caractère injecté dans leur nom.

describe('mdCode — délimiteurs backtick adaptatifs', () => {
  // mdCode n'est pas exportée — on valide via pickEntries qui ne crashe pas,
  // et on teste la logique en isolation en recréant la fonction.
  function mdCode(s: string): string {
    let maxRun = 0, run = 0;
    for (const ch of s) { run = ch === '`' ? run + 1 : 0; if (run > maxRun) maxRun = run; }
    const delim = '`'.repeat(maxRun + 1);
    return `${delim}${s}${delim}`;
  }

  it('chaîne sans backtick → un seul backtick de chaque côté', () => {
    expect(mdCode('foo')).toBe('`foo`');
  });

  it('chaîne avec un backtick → double backtick de chaque côté', () => {
    expect(mdCode('foo`bar')).toBe('``foo`bar``');
  });

  it('chaîne avec double-backtick → triple backtick de chaque côté', () => {
    // BUG précédent : `\`\`foo``bar\`\`` cassait le span CommonMark
    expect(mdCode('foo``bar')).toBe('```foo``bar```');
  });

  it('chaîne vide → un backtick de chaque côté', () => {
    expect(mdCode('')).toBe('``');
  });

  it('trois backticks consécutifs → quatre backticks de chaque côté', () => {
    expect(mdCode('```')).toBe('````\`\`\`````');
  });
});

describe('resolveEntry — cas limites dot/trailing dot', () => {
  it('query = "." retourne undefined sans crash', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    // ".".split('.').pop() = "" → guard retourne undefined
    expect(pickEntries(index, '.')).toEqual([]);
  });

  it('query = "foo." retourne undefined sans crash', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    expect(pickEntries(index, 'foo.')).toEqual([]);
  });

  it('query = ".foo" (leading dot) n\'est pas un crash', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    expect(() => pickEntries(index, '.foo')).not.toThrow();
  });
});

describe('pickEntries — queries avec caractères Markdown spéciaux (surface injection)', () => {
  it('ne crashe pas avec un backtick dans la query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    expect(() => pickEntries(index, 'foo`bar')).not.toThrow();
    expect(pickEntries(index, 'foo`bar')).toEqual([]);
  });

  it('ne crashe pas avec une newline embarquée dans la query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    expect(() => pickEntries(index, 'foo\nbar')).not.toThrow();
  });

  it('ne crashe pas avec une syntaxe lien Markdown dans la query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    expect(() => pickEntries(index, '[click](evil.com)')).not.toThrow();
    expect(pickEntries(index, '[click](evil.com)')).toEqual([]);
  });

  it('ne crashe pas avec trois backticks consécutifs (fenced code block)', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    expect(() => pickEntries(index, '```')).not.toThrow();
    expect(pickEntries(index, '```')).toEqual([]);
  });

  it('ne crashe pas avec une query de 100 000 caractères', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Foo` });
    const longQuery = 'a'.repeat(100_000);
    expect(() => pickEntries(index, longQuery)).not.toThrow();
    expect(pickEntries(index, longQuery)).toEqual([]);
  });
});

// ── BUG B — Heuristique FQN : dead-end sur FQN partiel ───────────────────────
// handleUsages et handleDoc utilisent query.includes('.') pour choisir entre
// lookupFqn(query) et lookup(query)[0].
// Si l'utilisateur tape "View.onDraw" (FQN partiel sans package), lookupFqn échoue
// et il n'y a aucun fallback vers lookup("onDraw").

describe('FQN heuristic gap — dead-end sur FQN partiel (couche SymbolIndex)', () => {
  it('lookupFqn avec FQN partiel (sans package) retourne undefined même si la méthode existe', () => {
    // Simule la décision prise par handleUsages quand query = "View.onDraw" :
    //   includes('.') → true → lookupFqn("View.onDraw") → undefined
    //   Alors que lookup("onDraw") aurait trouvé la méthode.
    const src = `${PKG}class View {\nfun onDraw() {}\n}`;
    const index = makeIndex({ 'file:///V.kt': src });

    // Le FQN complet fonctionne :
    expect(index.lookupFqn('com.example.View.onDraw')).toBeDefined();
    // FQN partiel → dead-end (c'est ce que l'heuristique utilise pour "View.onDraw") :
    expect(index.lookupFqn('View.onDraw')).toBeUndefined();
    // La méthode est bien dans l'index sous son simple name :
    expect(index.lookup('onDraw')).toHaveLength(1);
  });

  it('lookup avec un simple name contenant un point retourne [] (byName utilise le nom simple)', () => {
    // handleUsages : si query = "Map<String>" (sans point → lookup("Map<String>")[0])
    // byName.get("Map<String>") → undefined car la clé est "Map"
    const src = `${PKG}class Map`;
    const index = makeIndex({ 'file:///M.kt': src });

    expect(index.lookup('Map')).toHaveLength(1);       // clé exacte → trouvé
    expect(index.lookup('Map<String>')).toHaveLength(0); // clé avec générique → introuvable
  });

  it('lookupFqn avec FQN correct d\'une méthode dans une classe imbriquée fonctionne', () => {
    // Contrôle : le FQN complet est construit correctement pour les méthodes imbriquées
    const src = `${PKG}class View {\ninner class Item {\nfun onDraw() {}\n}\n}`;
    const index = makeIndex({ 'file:///V.kt': src });

    // FQN attendu : com.example.View.Item.onDraw
    expect(index.lookupFqn('com.example.View.Item.onDraw')).toBeDefined();
    // FQN partiel échoue :
    expect(index.lookupFqn('com.example.View.onDraw')).toBeUndefined();
  });
});
