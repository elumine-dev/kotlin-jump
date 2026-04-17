package com.example.ui

import com.example.data.User
import com.example.data.UserCache
import com.example.data.UserRepository
import com.example.data.UserRole
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * Tests for suspend functions in UserViewModel using runBlocking.
 *
 * runBlocking bridges the coroutine world into a blocking test — each call blocks
 * the current thread until the coroutine completes, giving us synchronous assertions.
 */
class CoroutinesTest {

    // ── Fake repository that honours suspend without needing a real coroutine scope ──

    private class FakeUserRepository(
        private val cache: UserCache,
        private val failOnSave: Boolean = false,
    ) : UserRepository {

        override suspend fun getUser(id: String): User =
            cache.get(id) ?: User(id, "Unknown", "unknown@example.com", UserRole.VIEWER)

        override suspend fun saveUser(user: User) {
            if (failOnSave) throw IllegalStateException("Simulated save failure")
            cache.put(user)
        }

        override fun observeUsers(): List<User> = cache.getAll()
    }

    private lateinit var cache: UserCache
    private lateinit var viewModel: UserViewModel

    @BeforeEach
    fun setUp() {
        cache = UserCache()
        viewModel = UserViewModel(FakeUserRepository(cache))
    }

    // ── loadUser ──────────────────────────────────────────────────────────────

    @Test
    fun `loadUser returns cached user`() = runBlocking {
        val alice = User("1", "Alice", "alice@example.com", UserRole.ADMIN)
        cache.put(alice)

        val result = viewModel.loadUser("1")

        assertEquals(alice, result)
    }

    @Test
    fun `loadUser returns fallback user when id not in cache`() = runBlocking {
        val result = viewModel.loadUser("unknown-id")

        assertNotNull(result)
        assertEquals("unknown-id", result.id)
        assertEquals("Unknown",    result.name)
    }

    @Test
    fun `loadUser for different ids returns different users`() = runBlocking {
        cache.put(User("1", "Alice", "alice@example.com", UserRole.ADMIN))
        cache.put(User("2", "Bob",   "bob@example.com",   UserRole.EDITOR))

        val alice = viewModel.loadUser("1")
        val bob   = viewModel.loadUser("2")

        assertEquals("Alice", alice.name)
        assertEquals("Bob",   bob.name)
    }

    // ── updateUser ────────────────────────────────────────────────────────────

    @Test
    fun `updateUser saves to cache and refreshes users list`() = runBlocking {
        val user    = User("1", "Alice", "alice@example.com", UserRole.VIEWER)
        val updated = user.copy(role = UserRole.ADMIN)

        viewModel.updateUser(updated)

        assertEquals(1, viewModel.users.size)
        assertEquals(UserRole.ADMIN, viewModel.users.first().role)
    }

    @Test
    fun `updateUser with multiple users refreshes full list`() = runBlocking {
        cache.put(User("1", "Alice", "alice@example.com", UserRole.ADMIN))
        val bob = User("2", "Bob", "bob@example.com", UserRole.VIEWER)

        viewModel.updateUser(bob)

        assertEquals(2, viewModel.users.size)
    }

    @Test
    fun `updateUser throws when repository fails`() {
        val failingRepo = FakeUserRepository(cache, failOnSave = true)
        val failingVm   = UserViewModel(failingRepo)
        val user        = User("1", "Alice", "alice@example.com", UserRole.ADMIN)

        assertThrows<IllegalStateException> {
            runBlocking { failingVm.updateUser(user) }
        }
    }

    // ── sequential suspend calls ──────────────────────────────────────────────

    @Test
    fun `sequential loadUser and updateUser reflect consistent state`() = runBlocking {
        val original = User("1", "Alice", "alice@example.com", UserRole.VIEWER)
        cache.put(original)

        val loaded  = viewModel.loadUser("1")
        assertEquals(UserRole.VIEWER, loaded.role)

        val promoted = loaded.copy(role = UserRole.ADMIN)
        viewModel.updateUser(promoted)

        val reloaded = viewModel.loadUser("1")
        assertEquals(UserRole.ADMIN, reloaded.role)
    }

    @Test
    fun `multiple sequential updateUser calls all persist`() = runBlocking {
        val users = listOf(
            User("1", "Alice",   "alice@example.com",   UserRole.ADMIN),
            User("2", "Bob",     "bob@example.com",     UserRole.EDITOR),
            User("3", "Charlie", "charlie@example.com", UserRole.VIEWER),
        )

        users.forEach { viewModel.updateUser(it) }

        assertEquals(3, viewModel.users.size)
        assertEquals("Alice",   viewModel.loadUser("1").name)
        assertEquals("Bob",     viewModel.loadUser("2").name)
        assertEquals("Charlie", viewModel.loadUser("3").name)
    }
}
