package com.example.data

/**
 * Factory helpers for picking a [PokemonRepository] at runtime.
 *
 * Each entry returns a concrete variant so call sites can opt into
 * the flavour (prod, offline, test, cached, etc.) without `new`ing
 * the implementation class directly.
 */
object PokemonRepositoryFactory {
    fun prod(api: PokeApiService, storage: PokemonStorage): PokemonRepository =
        PokemonRepositoryImpl(api, storage)

    fun offline(storage: PokemonStorage): PokemonRepository =
        OfflinePokemonRepository(storage)

    fun network(api: PokeApiService): PokemonRepository =
        NetworkPokemonRepository(api)

    fun memory(): PokemonRepository = InMemoryPokemonRepository()

    fun fake(): PokemonRepository = FakePokemonRepository()

    fun cached(delegate: PokemonRepository): PokemonRepository =
        CachedPokemonRepository(delegate)

    fun default(api: PokeApiService, storage: PokemonStorage): PokemonRepository =
        cached(prod(api, storage))
}
