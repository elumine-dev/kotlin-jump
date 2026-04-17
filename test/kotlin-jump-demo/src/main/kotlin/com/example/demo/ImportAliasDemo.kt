package com.example.demo

import com.example.data.Pokemon as Poke
import com.example.data.PokemonType as Type
import com.example.data.PokemonRepository as Repo
import com.example.data.PokemonStorage as Storage
import com.example.data.PokemonTeam as Team
import com.example.data.User as DomainUser
import com.example.data.UserRole as Role

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Import alias tooltip
//
// Hover sur un type alias (Poke, Type, Repo, etc.) →
// affiche "→ com.example.data.Pokemon" (FQN d'origine)
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Paramètres et types de retour ─────────────────────────────────────────

fun display(p: Poke) {                          // hover Poke → com.example.data.Pokemon
    println("${p.name} lv.${p.level}")
}

fun typeLabel(t: Type): String = t.name         // hover Type → com.example.data.PokemonType

fun load(r: Repo): List<Poke> = emptyList()     // hover Repo, Poke

fun save(storage: Storage, team: Team) = Unit   // hover Storage, Team

fun getUserRole(user: DomainUser): Role =        // hover DomainUser, Role
    user.role

// ── 2. Variables locales ──────────────────────────────────────────────────────

fun localVariables(pokeList: List<Poke>) {
    val first: Poke = pokeList.first()          // hover Poke
    val type: Type  = first.type                // hover Type
    val user: DomainUser = DomainUser(           // hover DomainUser
        id = "1", name = "Ash", email = "ash@example.com", role = Role.ADMIN // hover Role
    )
}

// ── 3. Créations d'instances ──────────────────────────────────────────────────

fun createInstances() {
    val poke = Poke(                             // hover Poke → com.example.data.Pokemon
        id = 25, name = "Pikachu", type = Type.ELECTRIC, level = 50, hp = 100  // hover Type
    )
    val user = DomainUser(                       // hover DomainUser
        id = "1", name = "Ash", email = "ash@example.com", role = Role.EDITOR  // hover Role
    )
}

// ── 4. Collections avec alias ─────────────────────────────────────────────────

fun collections() {
    val pokeList: List<Poke> = listOf()          // hover Poke
    val typeSet: Set<Type>   = setOf(Type.FIRE, Type.WATER)  // hover Type
    val userMap: Map<Int, DomainUser> = mapOf()  // hover DomainUser
    val roleList: List<Role> = listOf(Role.ADMIN, Role.EDITOR, Role.VIEWER)  // hover Role
}

// ── 5. when avec alias ────────────────────────────────────────────────────────

fun describeType(t: Type): String = when (t) {   // hover Type
    Type.FIRE     -> "fire"                       // hover Type
    Type.WATER    -> "water"
    Type.GRASS    -> "grass"
    Type.ELECTRIC -> "electric"
    Type.PSYCHIC  -> "psychic"
    Type.DRAGON   -> "dragon"
}

fun describeRole(r: Role): String = when (r) {   // hover Role
    Role.ADMIN  -> "admin"
    Role.EDITOR -> "editor"
    Role.VIEWER -> "viewer"
}

// ── 6. Sealed class avec alias ────────────────────────────────────────────────

sealed class LoadResult {
    data class Success(val pokemon: List<Poke>) : LoadResult()  // hover Poke
    data class Error(val cause: Throwable) : LoadResult()
    object Loading : LoadResult()
}

fun handleResult(result: LoadResult): String = when (result) {
    is LoadResult.Success -> "Loaded ${result.pokemon.size} Poke"   // hover Poke
    is LoadResult.Error   -> "Error: ${result.cause.message}"
    is LoadResult.Loading -> "Loading…"
}

// ── 7. Data class avec alias ──────────────────────────────────────────────────

data class PokemonSummary(
    val pokemon: Poke,          // hover Poke
    val owner: DomainUser,      // hover DomainUser
    val team: Team,             // hover Team
)

// ── 8. Lambda / higher-order ──────────────────────────────────────────────────

fun aliasHigherOrder() {
    val transform: (Poke) -> String = { it.name }  // hover Poke
    val filterType: (Poke, Type) -> Boolean =       // hover Poke, Type
        { poke, type -> poke.type == type }
    val roleCheck: (DomainUser, Role) -> Boolean =  // hover DomainUser, Role
        { user, role -> user.role == role }
}

// ── 9. Extension sur alias ────────────────────────────────────────────────────

fun Poke.toSummary(): String = "${name} lv.${level} (${type})"  // hover Poke
fun DomainUser.displayName(): String = "$name (${role.name})"   // hover DomainUser
fun List<Poke>.byType(t: Type): List<Poke> =                    // hover Poke, Type
    filter { it.type == t }

// ── 10. Générics avec alias ───────────────────────────────────────────────────

class Repository<T : Poke> {                   // hover Poke
    fun getAll(): List<T> = emptyList()
}

fun <T : DomainUser> findAdmin(users: List<T>): T? =  // hover DomainUser
    users.firstOrNull { it.role == Role.ADMIN }        // hover Role
