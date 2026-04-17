package com.example.ui

import com.example.data.User
import com.example.data.UserCache
import com.example.data.UserEvent
import com.example.data.UserRepository
import com.example.data.UserRole
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

private class FakeUserRepository(private val cache: UserCache) : UserRepository {
    override suspend fun getUser(id: String): User =
        cache.get(id) ?: User(id, "Unknown", "unknown@example.com", UserRole.VIEWER)
    override suspend fun saveUser(user: User) { cache.put(user) }
    override fun observeUsers(): List<User> = cache.getAll()
}

class UserViewModelTest {

    private lateinit var cache: UserCache
    private lateinit var viewModel: UserViewModel

    @BeforeEach
    fun setUp() {
        cache = UserCache()
        viewModel = UserViewModel(FakeUserRepository(cache))
    }

    @Test
    fun testRefreshUsers_returnsEmptyInitially() {
        viewModel.refreshUsers()
        assertEquals(emptyList<User>(), viewModel.users)
    }

    @Test
    fun testRefreshUsers_reflectsCache() {
        cache.put(User("1", "Alice", "alice@example.com", UserRole.ADMIN))
        viewModel.refreshUsers()
        assertEquals(1, viewModel.users.size)
        assertEquals("Alice", viewModel.users.first().name)
    }

    @Test
    fun testRefreshUsers_withMultipleUsers_returnsAll() {
        cache.put(User("1", "Alice", "alice@example.com", UserRole.ADMIN))
        cache.put(User("2", "Bob", "bob@example.com", UserRole.EDITOR))
        cache.put(User("3", "Carol", "carol@example.com", UserRole.VIEWER))
        viewModel.refreshUsers()
        assertEquals(3, viewModel.users.size)
    }

    @Test
    fun testHandleCreatedEvent_triggersRefreshAndUpdatesUsers() {
        val bob = User("2", "Bob", "bob@example.com", UserRole.EDITOR)
        cache.put(bob)
        viewModel.handleEvent(UserEvent.Created(bob))
        assertEquals(1, viewModel.users.size)
        assertEquals("Bob", viewModel.users.first().name)
    }

    @Test
    fun testHandleUpdatedEvent_triggersRefreshAndUpdatesUsers() {
        val original = User("1", "Alice", "alice@example.com", UserRole.VIEWER)
        cache.put(original)
        viewModel.refreshUsers()
        assertEquals(UserRole.VIEWER, viewModel.users.first().role)

        val updated = User("1", "Alice", "alice@example.com", UserRole.ADMIN)
        cache.put(updated)
        viewModel.handleEvent(UserEvent.Updated(updated))
        assertEquals(UserRole.ADMIN, viewModel.users.first().role)
    }

    @Test
    fun testHandleDeletedEvent_refreshesAndReflectsEmptyCache() {
        cache.put(User("1", "Alice", "alice@example.com", UserRole.ADMIN))
        viewModel.refreshUsers()
        assertEquals(1, viewModel.users.size)

        cache.clear()
        viewModel.handleEvent(UserEvent.Deleted)
        assertTrue(viewModel.users.isEmpty())
    }

    @Test
    fun testUsersListStartsEmpty() {
        assertTrue(viewModel.users.isEmpty())
    }
}
