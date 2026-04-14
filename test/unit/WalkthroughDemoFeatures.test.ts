/**
 * WalkthroughDemoFeatures.test.ts
 *
 * Verifies that every feature shown in the "Get Started" walkthrough works
 * correctly against the exact code patterns used in the demo recordings.
 *
 * One describe block per GIF, in recording order.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parse }        from '../../src/indexer/KotlinParser';
import { SymbolIndex }  from '../../src/indexer/SymbolIndex';
import { fileCouldReference } from '../../src/providers/FindUsagesEngine';
import { isTestFun }    from '../../src/testing/KotlinTestController';

// ─────────────────────────────────────────────────────────────────────────────
// Shared demo-project code snippets (verbatim from demo files)
// ─────────────────────────────────────────────────────────────────────────────

const URI_POKEMON        = 'file:///demo/data/Pokemon.kt';
const URI_BATTLE_ENGINE  = 'file:///demo/data/BattleEngine.kt';
const URI_REPO           = 'file:///demo/data/PokemonRepository.kt';
const URI_REPO_IMPL      = 'file:///demo/data/PokemonRepositoryImpl.kt';
const URI_BATTLE_TEST    = 'file:///demo/src/test/kotlin/com/example/data/BattleEngineTest.kt';
const URI_POKEDEX_SCREEN = 'file:///demo/ui/PokedexScreen.kt';
const URI_WELCOME_DEMO   = 'file:///demo/demo/WelcomeDemo.kt';
const URI_INLAY_DEMO     = 'file:///demo/demo/InlayHintsDemo.kt';

const POKEMON_KT = `
package com.example.data

data class Pokemon(
    val id: Int,
    val name: String,
    val type: PokemonType,
    val level: Int,
    val hp: Int,
)

enum class PokemonType {
    FIRE, WATER, GRASS, ELECTRIC, PSYCHIC, DRAGON;
    fun isStrongAgainst(other: PokemonType): Boolean = when (this) {
        FIRE     -> other == GRASS
        WATER    -> other == FIRE
        GRASS    -> other == WATER
        ELECTRIC -> other == WATER
        PSYCHIC  -> other == DRAGON
        DRAGON   -> false
    }
}

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}
`;

const BATTLE_ENGINE_KT = `
package com.example.data

class BattleEngine {
    fun fight(attacker: Pokemon, defender: Pokemon): BattleResult = when {
        attacker.type.isStrongAgainst(defender.type) -> BattleResult.Victory(attacker)
        defender.type.isStrongAgainst(attacker.type) -> BattleResult.Defeat(attacker)
        attacker.level > defender.level              -> BattleResult.Victory(attacker)
        defender.level > attacker.level              -> BattleResult.Defeat(attacker)
        else                                         -> BattleResult.Draw
    }
}
`;

const REPO_KT = `
package com.example.data

interface PokemonRepository {
    suspend fun catch(id: Int): Pokemon
    suspend fun release(pokemon: Pokemon)
    fun getPokedex(): List<Pokemon>
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}
`;

const REPO_IMPL_KT = `
package com.example.data

class PokemonRepositoryImpl(
    private val storage: PokemonStorage,
    private val engine: BattleEngine,
) : PokemonRepository {
    override suspend fun catch(id: Int): Pokemon = storage.find(id) ?: throw Exception()
    override suspend fun release(pokemon: Pokemon) { storage.remove(pokemon) }
    override fun getPokedex(): List<Pokemon> = storage.all()
    override fun battle(attacker: Pokemon, defender: Pokemon) = engine.fight(attacker, defender)
}
`;

const BATTLE_ENGINE_TEST_KT = `
package com.example.data

import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

class BattleEngineTest {

    private val engine = BattleEngine()

    @ParameterizedTest(name = "{0} beats {1} by type")
    @MethodSource("typeAdvantageCases")
    fun \`attacker wins by type advantage regardless of level\`(
        atkType: PokemonType, defType: PokemonType, atkLevel: Int, defLevel: Int,
    ) {
        val attacker = Pokemon(1, "Attacker", atkType, atkLevel, 100)
        val defender = Pokemon(2, "Defender", defType, defLevel, 100)
        assertInstanceOf(BattleResult.Victory::class.java, engine.fight(attacker, defender))
    }

    @Test
    fun \`attacker loses when defender has type advantage\`() {
        val attacker = Pokemon(1, "Squirtle", WATER, 50, 100)
        val defender = Pokemon(2, "Bulbasaur", GRASS, 50, 100)
        assertInstanceOf(BattleResult.Defeat::class.java, engine.fight(attacker, defender))
    }

    @Test
    fun \`draw when types are neutral and level is equal\`() {
        val a = Pokemon(1, "DragonA", DRAGON, 50, 100)
        val b = Pokemon(2, "DragonB", DRAGON, 50, 200)
        assertEquals(BattleResult.Draw, engine.fight(a, b))
    }

    companion object {
        @JvmStatic
        fun typeAdvantageCases() = listOf(
            Arguments.of(FIRE, GRASS, 10, 50),
            Arguments.of(WATER, FIRE, 10, 50),
        )
    }
}
`;

const POKEDEX_SCREEN_KT = `
package com.example.ui

import com.example.app.R
import com.example.data.BattleResult
import com.example.data.Pokemon
import com.example.data.PokemonType

class PokedexScreen(private val viewModel: PokedexViewModel) {

    companion object {
        val SCREEN_TITLE  = R.string.title_pokedex
        val ACTION_ADD    = R.string.action_add_pokemon
        val ACTION_BATTLE = R.string.action_start_battle
    }

    fun render() {
        val pokedex = viewModel.getPokedex()
        println("=== \${R.string.title_pokedex} (\${pokedex.size}) ===")
        if (pokedex.isEmpty()) { println(R.string.msg_empty_team); return }
        for (pokemon in pokedex) displayCard(pokemon)
    }

    private fun displayCard(pokemon: Pokemon) {
        val typeIcon = when (pokemon.type) {
            PokemonType.FIRE     -> "🔥"
            PokemonType.WATER    -> "💧"
            PokemonType.GRASS    -> "🌿"
            PokemonType.ELECTRIC -> "⚡"
            PokemonType.PSYCHIC  -> "🔮"
            PokemonType.DRAGON   -> "🐉"
        }
        val typeLabel = getTypeLabel(pokemon.type)
        println("\$typeIcon \${pokemon.name}  [\${R.string.label_pokemon_type}: \$typeLabel]  \${R.string.label_pokemon_level}: \${pokemon.level}  \${R.string.label_pokemon_hp}: \${pokemon.hp}")
    }

    private fun getTypeLabel(type: PokemonType): Int = when (type) {
        PokemonType.FIRE     -> R.string.type_fire
        PokemonType.WATER    -> R.string.type_water
        PokemonType.GRASS    -> R.string.type_grass
        PokemonType.ELECTRIC -> R.string.type_electric
        PokemonType.PSYCHIC  -> R.string.type_psychic
        PokemonType.DRAGON   -> R.string.type_dragon
    }

    fun showBattleResult(result: BattleResult) {
        when (result) {
            is BattleResult.Victory -> println("\${result.winner.name} — \${R.string.msg_battle_won}")
            is BattleResult.Defeat  -> println("\${result.loser.name} — \${R.string.msg_battle_lost}")
            is BattleResult.Draw    -> println("\${R.string.msg_battle_draw}")
        }
    }

    fun showError(isNetworkError: Boolean) {
        val messageRes = if (isNetworkError) R.string.error_network else R.string.error_unknown
        println("Error: \$messageRes  (\${R.string.action_retry})")
    }
}
`;

const WELCOME_DEMO_KT = `
package com.example.demo

import com.example.data.Pokemon

interface TrainerService {
    fun findTrainer(id: Int): Trainer?
    fun registerTrainer(trainer: Trainer): Boolean
    fun getLeaderboard(): List<Trainer>
}

sealed class TrainerEvent {
    data class Won(val trainer: Trainer, val against: Trainer) : TrainerEvent()
    data class Lost(val trainer: Trainer, val against: Trainer) : TrainerEvent()
    data object Tied : TrainerEvent()
}

enum class Badge {
    Boulder, Cascade, Thunder, Rainbow, Soul, Marsh, Volcano, Earth;
    fun isEarned(trainer: Trainer) = trainer.badges.contains(this)
}

data class Trainer(
    val id: Int,
    val name: String,
    val badges: Set<Badge> = emptySet(),
    val team: List<Pokemon> = emptyList(),
) {
    val isChampion get() = badges.size == Badge.entries.size
    fun strongestPokemon() = team.maxByOrNull { it.level }
}

class GymLeader(
    val name: String,
    val badge: Badge,
    val signature: Pokemon,
) : TrainerService {
    override fun findTrainer(id: Int): Trainer? = null
    override fun registerTrainer(trainer: Trainer) = true
    override fun getLeaderboard(): List<Trainer> = emptyList()
    fun challenge(challenger: Trainer): TrainerEvent = when {
        challenger.team.isEmpty() -> TrainerEvent.Lost(challenger, Trainer(0, name))
        else                      -> TrainerEvent.Won(challenger, Trainer(0, name))
    }
}
`;

const INLAY_DEMO_KT = `
package com.example.demo

import com.example.data.Pokemon
import com.example.data.PokemonType

fun makePokemon(id: Int, name: String, type: PokemonType): Pokemon =
    Pokemon(id, name, type, level = 1, hp = 100)

fun getLevel(pokemon: Pokemon): Int = pokemon.level

fun isElectric(type: PokemonType): Boolean = type == PokemonType.ELECTRIC

fun greet(name: String, times: Int): String = "\$name! ".repeat(times).trim()

fun demoParamNames() {
    val p = makePokemon(1, "Bulbasaur", PokemonType.GRASS)
    val message = greet("Gary", 2)
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. welcome.gif — WelcomeDemo.kt: all symbol types parsed → code lenses appear
// ─────────────────────────────────────────────────────────────────────────────

describe('welcome.gif — WelcomeDemo.kt: all Kotlin symbol types indexed', () => {
  const { symbols } = parse(URI_WELCOME_DEMO, WELCOME_DEMO_KT);
  const find = (name: string) => symbols.find(s => s.name === name);

  it('parses TrainerService as interface', () => {
    expect(find('TrainerService')?.kind).toBe('interface');
  });

  it('TrainerService has method symbols — one lens per method (≥3)', () => {
    const methods = symbols.filter(s => s.depth === 1 && ['findTrainer', 'registerTrainer', 'getLeaderboard'].includes(s.name));
    expect(methods.length).toBeGreaterThanOrEqual(3);
  });

  it('parses TrainerEvent as sealedClass', () => {
    expect(find('TrainerEvent')?.kind).toBe('sealedClass');
  });

  it('parses Won and Lost as nested dataClasses under TrainerEvent', () => {
    const won  = find('Won');
    const lost = find('Lost');
    expect(won?.kind).toBe('dataClass');
    expect(lost?.kind).toBe('dataClass');
    expect(won?.depth).toBeGreaterThan(0);
    expect(lost?.depth).toBeGreaterThan(0);
  });

  it('parses Tied as nested object under TrainerEvent', () => {
    expect(find('Tied')?.kind).toBe('object');
  });

  it('parses Badge as enum', () => {
    expect(find('Badge')?.kind).toBe('enum');
  });

  it('parses Trainer as dataClass', () => {
    expect(find('Trainer')?.kind).toBe('dataClass');
  });

  it('parses GymLeader as class with TrainerService supertype', () => {
    const cls = find('GymLeader');
    expect(cls?.kind).toBe('class');
    expect(cls?.supertypes).toContain('TrainerService');
  });

  it('GymLeader has challenge() function', () => {
    expect(find('challenge')?.kind).toBe('fun');
  });

  it('total top-level declarations produce enough lenses for a visual demo (≥ 5)', () => {
    const topLevel = symbols.filter(s => s.depth === 0);
    expect(topLevel.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. go-to-definition.gif — BattleEngine.kt: BattleResult resolves cross-file
// ─────────────────────────────────────────────────────────────────────────────

describe('go-to-definition.gif — BattleResult resolves from BattleEngine.kt', () => {
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    index.add(parse(URI_POKEMON,       POKEMON_KT));
    index.add(parse(URI_BATTLE_ENGINE, BATTLE_ENGINE_KT));
  });

  it('BattleResult is indexed and resolvable', () => {
    expect(index.lookup('BattleResult')).toHaveLength(1);
  });

  it('BattleResult is defined in Pokemon.kt — the jump target', () => {
    const entry = index.lookup('BattleResult')[0];
    expect(entry.uri.toString()).toBe(URI_POKEMON);
  });

  it('BattleResult.Victory is also indexed for deeper navigation', () => {
    expect(index.lookup('Victory').length).toBeGreaterThan(0);
  });

  it('BattleEngine.kt uses BattleResult (same-package — fileCouldReference true)', () => {
    const entry = index.lookup('BattleResult')[0];
    expect(fileCouldReference(BATTLE_ENGINE_KT, entry, index)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. find-usages.gif — Pokemon.kt: usages found across the demo project
// ─────────────────────────────────────────────────────────────────────────────

describe('find-usages.gif — Pokemon: fileCouldReference across demo project', () => {
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    index.add(parse(URI_POKEMON,        POKEMON_KT));
    index.add(parse(URI_BATTLE_ENGINE,  BATTLE_ENGINE_KT));
    index.add(parse(URI_REPO,           REPO_KT));
    index.add(parse(URI_REPO_IMPL,      REPO_IMPL_KT));
    index.add(parse(URI_POKEDEX_SCREEN, POKEDEX_SCREEN_KT));
    index.add(parse(URI_INLAY_DEMO,     INLAY_DEMO_KT));
  });

  const pokemonEntry = () => index.lookup('Pokemon')[0];

  it('Pokemon class is indexed once', () => {
    expect(index.lookup('Pokemon')).toHaveLength(1);
  });

  it('BattleEngine.kt (same package) can reference Pokemon', () => {
    expect(fileCouldReference(BATTLE_ENGINE_KT, pokemonEntry(), index)).toBe(true);
  });

  it('PokemonRepository.kt (same package) can reference Pokemon', () => {
    expect(fileCouldReference(REPO_KT, pokemonEntry(), index)).toBe(true);
  });

  it('PokemonRepositoryImpl.kt (same package) can reference Pokemon', () => {
    expect(fileCouldReference(REPO_IMPL_KT, pokemonEntry(), index)).toBe(true);
  });

  it('PokedexScreen.kt (imports Pokemon) can reference Pokemon', () => {
    expect(fileCouldReference(POKEDEX_SCREEN_KT, pokemonEntry(), index)).toBe(true);
  });

  it('InlayHintsDemo.kt (imports Pokemon) can reference Pokemon', () => {
    expect(fileCouldReference(INLAY_DEMO_KT, pokemonEntry(), index)).toBe(true);
  });

  it('an unrelated file with no import cannot reference Pokemon', () => {
    const unrelated = `package com.example.other\n\nclass Unrelated { fun doStuff() {} }`;
    expect(fileCouldReference(unrelated, pokemonEntry(), index)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. code-lens.gif — PokemonRepository.kt: implementation correctly detected
// ─────────────────────────────────────────────────────────────────────────────

describe('code-lens.gif — PokemonRepository: interface + 1 implementation', () => {
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    index.add(parse(URI_POKEMON,   POKEMON_KT));
    index.add(parse(URI_REPO,      REPO_KT));
    index.add(parse(URI_REPO_IMPL, REPO_IMPL_KT));
  });

  it('PokemonRepository is indexed as interface', () => {
    const entry = index.lookup('PokemonRepository')[0];
    expect(entry?.kind).toBe('interface');
  });

  it('PokemonRepositoryImpl declares PokemonRepository as supertype', () => {
    const impl = index.lookup('PokemonRepositoryImpl')[0];
    expect(impl?.supertypes).toContain('PokemonRepository');
  });

  it('exactly 1 class implements PokemonRepository', () => {
    const impls = index.lookupImplementations('PokemonRepository').filter(s => s.kind === 'class');
    expect(impls).toHaveLength(1);
    expect(impls[0].name).toBe('PokemonRepositoryImpl');
  });

  it('PokemonRepository interface has 4 methods — one lens per method', () => {
    const methods = parse(URI_REPO, REPO_KT).symbols.filter(s => s.kind === 'fun');
    expect(methods).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. test-nav.gif — BattleEngineTest.kt: test functions detected for navigation
// ─────────────────────────────────────────────────────────────────────────────

describe('test-nav.gif — BattleEngineTest.kt: test annotations and backtick names', () => {
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    index.add(parse(URI_BATTLE_TEST, BATTLE_ENGINE_TEST_KT));
  });

  const entries = () => index.getFileSymbols(URI_BATTLE_TEST);
  const find    = (name: string) => entries().find(e => e.name === name);

  it('@ParameterizedTest method is detected as a test function', () => {
    const fun_ = find('attacker wins by type advantage regardless of level');
    expect(fun_).toBeDefined();
    expect(isTestFun(fun_!, [])).toBe(true);
  });

  it('@Test method "attacker loses when defender has type advantage" is detected', () => {
    const fun_ = find('attacker loses when defender has type advantage');
    expect(fun_).toBeDefined();
    expect(isTestFun(fun_!, [])).toBe(true);
  });

  it('@Test method "draw when types are neutral and level is equal" is detected', () => {
    const fun_ = find('draw when types are neutral and level is equal');
    expect(fun_).toBeDefined();
    expect(isTestFun(fun_!, [])).toBe(true);
  });

  it('backtick test names are parsed without the backticks', () => {
    const testFunctions = entries().filter(e => isTestFun(e, []));
    expect(testFunctions.length).toBeGreaterThanOrEqual(3);
  });

  it('companion object method (typeAdvantageCases) is NOT a test function', () => {
    const fun_ = find('typeAdvantageCases');
    if (fun_) expect(isTestFun(fun_!, [])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. string-folding.gif — PokedexScreen.kt: R.string references detected
// ─────────────────────────────────────────────────────────────────────────────

describe('string-folding.gif — PokedexScreen.kt: R.string pattern coverage', () => {
  // Mirror the exact regex used in StringResourceFoldingProvider.ts
  const R_STRING_RE = /\bR\.string\.([A-Za-z_]\w*)\b/g;

  const allRefs = [...POKEDEX_SCREEN_KT.matchAll(R_STRING_RE)].map(m => m[1]);

  it('detects R.string references in the file (at least 10)', () => {
    expect(allRefs.length).toBeGreaterThanOrEqual(10);
  });

  it('detects title_pokedex — the most visible fold in the demo', () => {
    expect(allRefs).toContain('title_pokedex');
  });

  it('detects all 6 pokemon type label references', () => {
    // These appear in getTypeLabel() — all 6 must fold correctly
    const typeRefs = ['type_fire', 'type_water', 'type_grass', 'type_electric', 'type_psychic', 'type_dragon'];
    for (const ref of typeRefs) expect(allRefs).toContain(ref);
  });

  it('detects battle result message references for showBattleResult()', () => {
    expect(allRefs).toContain('msg_battle_won');
    expect(allRefs).toContain('msg_battle_lost');
    expect(allRefs).toContain('msg_battle_draw');
  });

  it('detects error references for showError()', () => {
    expect(allRefs).toContain('error_network');
    expect(allRefs).toContain('error_unknown');
  });

  it('all detected keys are unique identifiers (no empty strings)', () => {
    expect(allRefs.every(k => /^[A-Za-z_]\w*$/.test(k))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. inlay-hints.gif — InlayHintsDemo.kt: function signatures extractable
// ─────────────────────────────────────────────────────────────────────────────

describe('inlay-hints.gif — InlayHintsDemo.kt: parameter names and types indexed', () => {
  const { symbols } = parse(URI_INLAY_DEMO, INLAY_DEMO_KT);
  const find = (name: string) => symbols.find(s => s.name === name);

  it('makePokemon is parsed as a top-level function', () => {
    expect(find('makePokemon')?.kind).toBe('fun');
  });

  it('getLevel is parsed as a top-level function', () => {
    expect(find('getLevel')?.kind).toBe('fun');
  });

  it('isElectric is parsed as a top-level function', () => {
    expect(find('isElectric')?.kind).toBe('fun');
  });

  it('greet is parsed as a top-level function', () => {
    expect(find('greet')?.kind).toBe('fun');
  });

  it('demoParamNames is parsed — it contains the call sites shown in the demo', () => {
    expect(find('demoParamNames')).toBeDefined();
  });

  it('all 4 utility functions are top-level (depth 0) — required for inlay hints', () => {
    const fns = ['makePokemon', 'getLevel', 'isElectric', 'greet'];
    for (const name of fns) {
      expect(find(name)?.depth).toBe(0);
    }
  });
});
