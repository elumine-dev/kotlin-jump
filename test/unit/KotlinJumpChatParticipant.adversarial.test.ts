/**
 * Adversarial tests — KotlinJumpChatParticipant.parseNaturalLanguage + resolveImplementations
 *
 * Vectors:
 *   NL-REG  — regression exacte du bug original ("No symbols found")
 *   NL-1    — implementations : formulations variées
 *   NL-2    — implementations : casse (CAPS, TitleCase, mixte)
 *   NL-3    — implementations : noms de symboles (FQN, chiffres, _, $)
 *   NL-4    — implementations : ponctuation finale stoppée (fix (\S+) → identifier regex)
 *   NL-5    — implementations : faux positifs — ne doit PAS matcher
 *   NL-6    — usages : formulations variées
 *   NL-7    — usages : noms de symboles + ponctuation
 *   NL-8    — doc : formulations variées (doc/kdoc/documentation, for/of)
 *   NL-9    — priorité : implémentations > usages > doc
 *   NL-10   — espaces multiples et tabulations entre mots-clés
 *   NL-11   — inputs pathologiques (vide, unicode, très long, injection Markdown)
 *   NL-BUG1 — resolveImplementations : casse utilisateur (pokemonrepository → PokemonRepository)
 *   NL-BUG2 — resolveImplementations : FQN en entrée (com.example.Foo → bySuper ne stocke que les noms simples)
 *   NL-BUG6 — parseNaturalLanguage : identifiants commençant par $ (limite documentée)
 */

import { describe, it, expect } from 'vitest';
import { parseNaturalLanguage, resolveImplementations } from '../../src/ai/KotlinJumpChatParticipant';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

function makeIndex(sources: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, src] of Object.entries(sources)) index.add(parse(uri, src));
  index.finalize();
  return index;
}

// ── NL-REG — Régression du bug original ──────────────────────────────────────
// La phrase exacte qui produisait "No symbols found" avant le fix.
// Ce test DOIT passer dans chaque futur build.

describe('NL-REG — regression: "@kotlin-jump find all implementations of PokemonRepository"', () => {
  it('[REGRESSION] phrase exacte du bug → cmd=implementations, query=PokemonRepository', () => {
    expect(parseNaturalLanguage('find all implementations of PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });
});

// ── NL-1 — Implémentations : formulations variées ────────────────────────────

describe('NL-1 — implementations : formulations variées', () => {
  it('NL-1.1  "implementations of X" (sans verbe)', () => {
    expect(parseNaturalLanguage('implementations of GymChallenge'))
      .toEqual({ cmd: 'implementations', query: 'GymChallenge' });
  });

  it('NL-1.2  "find implementations of X"', () => {
    expect(parseNaturalLanguage('find implementations of GymChallenge'))
      .toEqual({ cmd: 'implementations', query: 'GymChallenge' });
  });

  it('NL-1.3  "list implementations of X"', () => {
    expect(parseNaturalLanguage('list implementations of BattleEngine'))
      .toEqual({ cmd: 'implementations', query: 'BattleEngine' });
  });

  it('NL-1.4  "show me all implementations of X"', () => {
    expect(parseNaturalLanguage('show me all implementations of PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-1.5  "get implementations of X"', () => {
    expect(parseNaturalLanguage('get implementations of TrainerService'))
      .toEqual({ cmd: 'implementations', query: 'TrainerService' });
  });

  it('NL-1.6  "who implements X" → ne matche pas (hors pattern)', () => {
    expect(parseNaturalLanguage('who implements GymChallenge')).toBeUndefined();
  });

  it('NL-1.7  "can you find all implementations of X please"', () => {
    expect(parseNaturalLanguage('can you find all implementations of Pokemon please'))
      .toEqual({ cmd: 'implementations', query: 'Pokemon' });
  });

  it('NL-1.8  "implementation of X" (singulier)', () => {
    expect(parseNaturalLanguage('implementation of PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-1.9  symbole en milieu de phrase — seul le mot après "of" est extrait', () => {
    expect(parseNaturalLanguage('what are all implementations of Badge in the project'))
      .toEqual({ cmd: 'implementations', query: 'Badge' });
  });

  it('NL-1.10 "find all implementations of X and show results"', () => {
    expect(parseNaturalLanguage('find all implementations of Trainer and show results'))
      .toEqual({ cmd: 'implementations', query: 'Trainer' });
  });
});

// ── NL-2 — Implémentations : casse ───────────────────────────────────────────

describe('NL-2 — implementations : casse', () => {
  it('NL-2.1  tout en majuscules IMPLEMENTATIONS OF X', () => {
    expect(parseNaturalLanguage('FIND ALL IMPLEMENTATIONS OF PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-2.2  TitleCase Implementations Of X', () => {
    expect(parseNaturalLanguage('Implementations Of GymChallenge'))
      .toEqual({ cmd: 'implementations', query: 'GymChallenge' });
  });

  it('NL-2.3  casse mixte ImPlEmEnTaTiOnS oF X', () => {
    expect(parseNaturalLanguage('ImPlEmEnTaTiOnS oF BattleEngine'))
      .toEqual({ cmd: 'implementations', query: 'BattleEngine' });
  });
});

// ── NL-3 — Implémentations : noms de symboles ────────────────────────────────

describe('NL-3 — implementations : noms de symboles', () => {
  it('NL-3.1  FQN complet com.example.data.PokemonRepository', () => {
    expect(parseNaturalLanguage('implementations of com.example.data.PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'com.example.data.PokemonRepository' });
  });

  it('NL-3.2  FQN partiel example.PokemonRepository', () => {
    expect(parseNaturalLanguage('implementations of example.PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'example.PokemonRepository' });
  });

  it('NL-3.3  symbole avec chiffres Pokemon3D', () => {
    expect(parseNaturalLanguage('implementations of Pokemon3D'))
      .toEqual({ cmd: 'implementations', query: 'Pokemon3D' });
  });

  it('NL-3.4  symbole avec underscore pokemon_repo', () => {
    expect(parseNaturalLanguage('implementations of pokemon_repo'))
      .toEqual({ cmd: 'implementations', query: 'pokemon_repo' });
  });

  it('NL-3.5  symbole court à un caractère "I"', () => {
    expect(parseNaturalLanguage('implementations of I'))
      .toEqual({ cmd: 'implementations', query: 'I' });
  });
});

// ── NL-4 — Implémentations : ponctuation finale stoppée ──────────────────────
// Avant le fix (\S+), "Foo." était capturé tel quel → lookupImplementations("Foo.") → 0 résultats.
// Après le fix (\w(?:[\w.$]*\w)?), la ponctuation finale est exclue.

describe('NL-4 — implementations : ponctuation finale exclue du query', () => {
  it('NL-4.1  point final "Foo." → query="Foo"', () => {
    expect(parseNaturalLanguage('implementations of PokemonRepository.'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-4.2  point d\'interrogation "Foo?" → query="Foo"', () => {
    expect(parseNaturalLanguage('implementations of PokemonRepository?'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-4.3  virgule "Foo," → query="Foo"', () => {
    expect(parseNaturalLanguage('implementations of PokemonRepository,'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-4.4  point d\'exclamation "Foo!" → query="Foo"', () => {
    expect(parseNaturalLanguage('implementations of BattleEngine!'))
      .toEqual({ cmd: 'implementations', query: 'BattleEngine' });
  });

  it('NL-4.5  FQN avec point final "com.example.Foo." → query="com.example.Foo"', () => {
    expect(parseNaturalLanguage('implementations of com.example.PokemonRepository.'))
      .toEqual({ cmd: 'implementations', query: 'com.example.PokemonRepository' });
  });
});

// ── NL-5 — Implémentations : faux positifs ───────────────────────────────────

describe('NL-5 — implementations : ne doit PAS matcher', () => {
  it('NL-5.1  mot collé sans espace : "implementationsFactory"', () => {
    // "implementationsFactory" ≠ "implementations of" — pas de "\s+of" après
    expect(parseNaturalLanguage('show implementationsFactory')).toBeUndefined();
  });

  it('NL-5.2  "noimplementations of X" (pas de word boundary avant)', () => {
    expect(parseNaturalLanguage('noimplementations of Foo')).toBeUndefined();
  });

  it('NL-5.3  "implementations of" sans symbole (fin de chaîne)', () => {
    expect(parseNaturalLanguage('implementations of')).toBeUndefined();
  });

  it('NL-5.4  "implementations of " (espace seul après "of")', () => {
    expect(parseNaturalLanguage('implementations of ')).toBeUndefined();
  });

  it('NL-5.5  "implementations" seul', () => {
    expect(parseNaturalLanguage('implementations')).toBeUndefined();
  });

  it('NL-5.6  "of PokemonRepository" sans mot-clé', () => {
    expect(parseNaturalLanguage('of PokemonRepository')).toBeUndefined();
  });
});

// ── NL-6 — Usages : formulations variées ─────────────────────────────────────

describe('NL-6 — usages : formulations variées', () => {
  it('NL-6.1  "usages of X"', () => {
    expect(parseNaturalLanguage('usages of Pokemon'))
      .toEqual({ cmd: 'usages', query: 'Pokemon' });
  });

  it('NL-6.2  "find all usages of X"', () => {
    expect(parseNaturalLanguage('find all usages of Badge'))
      .toEqual({ cmd: 'usages', query: 'Badge' });
  });

  it('NL-6.3  "usage of X" (singulier)', () => {
    expect(parseNaturalLanguage('usage of BattleResult'))
      .toEqual({ cmd: 'usages', query: 'BattleResult' });
  });

  it('NL-6.4  "USAGES OF X" (majuscules)', () => {
    expect(parseNaturalLanguage('USAGES OF Trainer'))
      .toEqual({ cmd: 'usages', query: 'Trainer' });
  });

  it('NL-6.5  "usages of" sans symbole → undefined', () => {
    expect(parseNaturalLanguage('usages of')).toBeUndefined();
  });
});

// ── NL-7 — Usages : noms de symboles + ponctuation ───────────────────────────

describe('NL-7 — usages : noms de symboles et ponctuation finale', () => {
  it('NL-7.1  FQN "usages of com.example.Pokemon"', () => {
    expect(parseNaturalLanguage('usages of com.example.Pokemon'))
      .toEqual({ cmd: 'usages', query: 'com.example.Pokemon' });
  });

  it('NL-7.2  point final "usages of Foo." → query="Foo"', () => {
    expect(parseNaturalLanguage('usages of Badge.'))
      .toEqual({ cmd: 'usages', query: 'Badge' });
  });

  it('NL-7.3  point d\'interrogation "usages of Foo?" → query="Foo"', () => {
    expect(parseNaturalLanguage('usages of Trainer?'))
      .toEqual({ cmd: 'usages', query: 'Trainer' });
  });

  it('NL-7.4  symbole avec chiffres "usages of V2Repository"', () => {
    expect(parseNaturalLanguage('usages of V2Repository'))
      .toEqual({ cmd: 'usages', query: 'V2Repository' });
  });
});

// ── NL-8 — Doc : formulations variées ────────────────────────────────────────

describe('NL-8 — doc : formulations variées', () => {
  it('NL-8.1  "doc for X"', () => {
    expect(parseNaturalLanguage('doc for BattleEngine'))
      .toEqual({ cmd: 'doc', query: 'BattleEngine' });
  });

  it('NL-8.2  "kdoc for X"', () => {
    expect(parseNaturalLanguage('kdoc for Trainer'))
      .toEqual({ cmd: 'doc', query: 'Trainer' });
  });

  it('NL-8.3  "documentation of X"', () => {
    expect(parseNaturalLanguage('documentation of PokemonRepository'))
      .toEqual({ cmd: 'doc', query: 'PokemonRepository' });
  });

  it('NL-8.4  "documentation for X"', () => {
    expect(parseNaturalLanguage('documentation for GymChallenge'))
      .toEqual({ cmd: 'doc', query: 'GymChallenge' });
  });

  it('NL-8.5  "doc of X" (of au lieu de for)', () => {
    expect(parseNaturalLanguage('doc of Pokemon'))
      .toEqual({ cmd: 'doc', query: 'Pokemon' });
  });

  it('NL-8.6  "KDOC FOR X" (majuscules)', () => {
    expect(parseNaturalLanguage('KDOC FOR BattleEngine'))
      .toEqual({ cmd: 'doc', query: 'BattleEngine' });
  });

  it('NL-8.7  "doc for" sans symbole → undefined', () => {
    expect(parseNaturalLanguage('doc for')).toBeUndefined();
  });
});

// ── NL-9 — Priorité : implémentations > usages > doc ─────────────────────────
// Les patterns sont évalués dans l'ordre : implementations d'abord, puis usages, puis doc.

describe('NL-9 — priorité des patterns', () => {
  it('NL-9.1  "usages of implementations of X" → implementations gagne (checker en premier)', () => {
    // "implementations of X" est trouvé avant "usages of implementations"
    expect(parseNaturalLanguage('usages of implementations of PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-9.2  "find usages of ImplementationsFactory" → usages (pas de \x22of\x22 après ImplementationsFactory)', () => {
    // "ImplementationsFactory" contient "implementations" mais sans "\s+of\s+" après
    expect(parseNaturalLanguage('find usages of ImplementationsFactory'))
      .toEqual({ cmd: 'usages', query: 'ImplementationsFactory' });
  });

  it('NL-9.3  "doc for usages of X" → usages gagne (vérifié avant doc)', () => {
    // Ordre des checks : implementations → usages → doc
    // "usages of Pokemon" matche la regex usages AVANT que doc soit évalué
    // → cmd=usages, query=Pokemon (et non cmd=doc, query=usages)
    expect(parseNaturalLanguage('doc for usages of Pokemon'))
      .toEqual({ cmd: 'usages', query: 'Pokemon' });
  });

  it('NL-9.4  "implementations of Foo" vs "usages of Bar" dans le même prompt → implementations gagne', () => {
    expect(parseNaturalLanguage('show implementations of Foo and usages of Bar'))
      .toEqual({ cmd: 'implementations', query: 'Foo' });
  });
});

// ── NL-10 — Espaces multiples et tabulations ──────────────────────────────────

describe('NL-10 — espaces multiples et tabulations', () => {
  it('NL-10.1  deux espaces entre "implementations" et "of"', () => {
    expect(parseNaturalLanguage('implementations  of  PokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-10.2  tabulation entre "usages" et "of"', () => {
    expect(parseNaturalLanguage('usages\tof\tBadge'))
      .toEqual({ cmd: 'usages', query: 'Badge' });
  });

  it('NL-10.3  mélange espaces et tabs', () => {
    expect(parseNaturalLanguage('implementations \t of \t Trainer'))
      .toEqual({ cmd: 'implementations', query: 'Trainer' });
  });
});

// ── NL-11 — Inputs pathologiques ─────────────────────────────────────────────

describe('NL-11 — inputs pathologiques', () => {
  it('NL-11.1  chaîne vide → undefined', () => {
    expect(parseNaturalLanguage('')).toBeUndefined();
  });

  it('NL-11.2  espaces uniquement → undefined', () => {
    expect(parseNaturalLanguage('     ')).toBeUndefined();
  });

  it('NL-11.3  prompt très long (100 000 chars) avec le pattern en fin → ne crashe pas', () => {
    const prefix = 'a'.repeat(100_000);
    expect(() => parseNaturalLanguage(`${prefix} implementations of PokemonRepository`)).not.toThrow();
    expect(parseNaturalLanguage(`${prefix} implementations of PokemonRepository`))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });

  it('NL-11.4  backtick Markdown dans le prompt ne crashe pas', () => {
    expect(() => parseNaturalLanguage('find implementations of `PokemonRepository`')).not.toThrow();
    // Les backticks ne font pas partie des chars \w — "of `Pokemon" → pas de \w directement après "of "
    // Le résultat dépend du regex : le backtick n'est pas \w, donc undefined ou query sans backtick
    // Important : ne doit PAS crasher
  });

  it('NL-11.5  lien Markdown dans le prompt ne crashe pas', () => {
    expect(() => parseNaturalLanguage('implementations of [PokemonRepository](evil.com)')).not.toThrow();
    // "[" n'est pas \w → undefined
    expect(parseNaturalLanguage('implementations of [PokemonRepository](evil.com)')).toBeUndefined();
  });

  it('NL-11.6  newline dans le prompt — le pattern peut quand même matcher', () => {
    // \s+ dans le regex matche les newlines — "implementations\nof\nFoo" doit matcher
    expect(parseNaturalLanguage('implementations\nof\nPokemonRepository'))
      .toEqual({ cmd: 'implementations', query: 'PokemonRepository' });
  });
});

// ── NL-BUG1 — resolveImplementations : casse ─────────────────────────────────
// bySuper.get(name) est un exact-match sur la clé.
// Sans le fix, "pokemonrepository" → bySuper.get("pokemonrepository") → EMPTY
// alors que la clé réelle est "PokemonRepository".
// Le fix : fallback via search() (case-insensitive) pour résoudre la casse exacte.

const GYM_SRC = `
package com.example
interface GymChallenge
class PewterGym : GymChallenge
class CeruleanGym : GymChallenge
class VermilionGym : GymChallenge
`.trim();

describe('NL-BUG1 — resolveImplementations : casse insensible', () => {
  it('NL-BUG1.1  preuve du bug originel : lookupImplementations("gymchallenge") → vide sans fix', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    // bySuper a la clé "GymChallenge" (casse originale du parser)
    expect(index.lookupImplementations('GymChallenge')).toHaveLength(3);   // fonctionne
    expect(index.lookupImplementations('gymchallenge')).toHaveLength(0);   // bug sans fix
  });

  it('NL-BUG1.2  resolveImplementations("gymchallenge") trouve les 3 implémentations (fix actif)', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    const results = resolveImplementations(index, 'gymchallenge');
    expect(results).toHaveLength(3);
    expect(results.map(r => r.name).sort()).toEqual(['CeruleanGym', 'PewterGym', 'VermilionGym']);
  });

  it('NL-BUG1.3  resolveImplementations("GYMCHALLENGE") (tout en caps) trouve quand même les impls', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(resolveImplementations(index, 'GYMCHALLENGE')).toHaveLength(3);
  });

  it('NL-BUG1.4  resolveImplementations("GymChallenge") (casse exacte) fonctionne toujours', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(resolveImplementations(index, 'GymChallenge')).toHaveLength(3);
  });

  it('NL-BUG1.5  symbole inexistant → []', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(resolveImplementations(index, 'NoSuchInterface')).toHaveLength(0);
  });

  it('NL-BUG1.6  index vide → [] sans crash', () => {
    const index = new SymbolIndex();
    index.finalize();
    expect(resolveImplementations(index, 'GymChallenge')).toHaveLength(0);
  });
});

// ── NL-BUG2 — resolveImplementations : FQN en entrée ─────────────────────────
// bySuper stocke les NOMS SIMPLES des supertypes (commentaire SymbolIndex.ts l.19).
// Sans le fix, "com.example.GymChallenge" → bySuper.get("com.example.GymChallenge") → EMPTY.
// Le fix : extraire le dernier segment du FQN avant la recherche.

describe('NL-BUG2 — resolveImplementations : FQN en entrée', () => {
  it('NL-BUG2.1  preuve du bug originel : lookupImplementations(FQN) → vide sans fix', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    // bySuper ne connaît que "GymChallenge", pas le FQN complet
    expect(index.lookupImplementations('com.example.GymChallenge')).toHaveLength(0);
  });

  it('NL-BUG2.2  resolveImplementations("com.example.GymChallenge") extrait "GymChallenge" → 3 impls', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(resolveImplementations(index, 'com.example.GymChallenge')).toHaveLength(3);
  });

  it('NL-BUG2.3  FQN à 4 segments "a.b.c.GymChallenge" → extrait "GymChallenge" → 3 impls', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(resolveImplementations(index, 'a.b.c.GymChallenge')).toHaveLength(3);
  });

  it('NL-BUG2.4  FQN avec casse mixte "com.example.gymchallenge" → FQN strip + fallback case → 3 impls', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    // Combine BUG-1 + BUG-2 : FQN ET casse incorrecte simultanément
    expect(resolveImplementations(index, 'com.example.gymchallenge')).toHaveLength(3);
  });

  it('NL-BUG2.5  FQN avec point final "com.example.GymChallenge." → segment vide → []', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    // "com.example.GymChallenge.".split('.').pop() = "" → guard simpleName vide → []
    expect(resolveImplementations(index, 'com.example.GymChallenge.')).toHaveLength(0);
  });

  it('NL-BUG2.6  query "." seul → [] sans crash', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(() => resolveImplementations(index, '.')).not.toThrow();
    expect(resolveImplementations(index, '.')).toHaveLength(0);
  });
});

// ── NL-BUG6 — parseNaturalLanguage : identifiants commençant par $ ────────────
// Le regex commence par \w qui = [a-zA-Z0-9_] — le $ n'est PAS inclus.
// Un identifiant "$Anon" en premier char ne matche pas.
// Comportement documenté : $ en début de nom est un nom synthétique (généré par le
// compilateur), jamais tapé par un utilisateur dans une requête NL.

describe('NL-BUG6 — parseNaturalLanguage : dollar-sign en début d\'identifiant (limite documentée)', () => {
  it('NL-BUG6.1  "implementations of $Anon" → undefined ($ non capturé en position 0)', () => {
    // Comportement attendu avec la limite actuelle : $ n'est pas \w
    expect(parseNaturalLanguage('implementations of $Anon')).toBeUndefined();
  });

  it('NL-BUG6.2  "implementations of Foo$Bar" → "Foo$Bar" capturé ($ autorisé en milieu)', () => {
    // [\w.$]* dans le groupe optionnel permet $ en position non-initiale
    expect(parseNaturalLanguage('implementations of Foo$Bar'))
      .toEqual({ cmd: 'implementations', query: 'Foo$Bar' });
  });

  it('NL-BUG6.3  resolveImplementations("$Anon") → [] sans crash', () => {
    const index = makeIndex({ 'file:///G.kt': GYM_SRC });
    expect(() => resolveImplementations(index, '$Anon')).not.toThrow();
    expect(resolveImplementations(index, '$Anon')).toHaveLength(0);
  });
});
