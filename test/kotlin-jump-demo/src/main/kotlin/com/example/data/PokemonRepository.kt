package com.example.data

/**
 * Central abstraction for all Pokémon data operations.
 *
 * Implementations range from network-backed to fully offline,
 * allowing seamless swapping between prod, test, and offline modes.
 *
 * @see PokemonRepositoryImpl for the live network + storage implementation
 * @see CachedPokemonRepository for the caching decorator
 * @see NetworkPokemonRepository for the pure-remote variant
 * @see OfflinePokemonRepository for the local-only variant
 * @see FakePokemonRepository for deterministic test usage
 * @see InMemoryPokemonRepository for lightweight in-memory tests
 */
interface PokemonRepository {

    /**
     * Catches a Pokémon by its Pokédex ID and persists it to the trainer's storage.
     *
     * @param id The national Pokédex number (1–1010)
     * @return The caught [Pokemon] instance with full stats
     * @throws PokemonNotFoundException if the ID is unknown
     */
    suspend fun catch(id: Int): Pokemon

    /**
     * Releases a Pokémon back into the wild and removes it from storage.
     *
     * @param pokemon The [Pokemon] to release
     */
    suspend fun release(pokemon: Pokemon)

    /**
     * Returns the trainer's current Pokédex — all caught Pokémon.
     *
     * @return A [Pokedex] snapshot of the trainer's collection
     */
    fun getPokedex(): Pokedex

    /**
     * Simulates a battle between two Pokémon and returns the outcome.
     *
     * Type effectiveness is applied automatically.
     *
     * @param attacker The attacking Pokémon
     * @param defender The defending Pokémon
     * @return [BattleResult.Victory], [BattleResult.Defeat], or [BattleResult.Draw]
     */
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}
