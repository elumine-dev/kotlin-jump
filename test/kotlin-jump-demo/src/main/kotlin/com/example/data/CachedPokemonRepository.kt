package com.example.data

/**
 * Caching decorator around any [PokemonRepository].
 *
 * Wraps a delegate repository and keeps an in-memory LRU cache of
 * recently fetched Pokémon to avoid redundant network or disk reads.
 *
 * @param delegate The underlying repository to delegate cache misses to
 * @param cacheSize Maximum number of Pokémon to keep in memory (default 151)
 */
class CachedPokemonRepository(
    private val delegate: PokemonRepository,
    private val cacheSize: Int = 151,
) : PokemonRepository {

    private val cache = LinkedHashMap<Int, Pokemon>(cacheSize, 0.75f, true)

    override suspend fun catch(id: Int): Pokemon {
        return cache.getOrPut(id) { delegate.catch(id) }.also {
            if (cache.size > cacheSize) cache.entries.iterator().also { it.next(); it.remove() }
        }
    }

    override suspend fun release(pokemon: Pokemon) {
        cache.remove(pokemon.id)
        delegate.release(pokemon)
    }

    override fun getPokedex(): Pokedex = delegate.getPokedex()

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult =
        delegate.battle(attacker, defender)
}
