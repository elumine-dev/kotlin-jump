/**
 * Repository for catching and managing Pokemon.
 *
 * @see PokemonRepositoryImpl for the concrete implementation
 */
interface PokemonRepository {
    suspend fun catch(id: Int): Pokemon
    suspend fun release(pokemon: Pokemon)
    fun getPokedex(): Pokedex
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}