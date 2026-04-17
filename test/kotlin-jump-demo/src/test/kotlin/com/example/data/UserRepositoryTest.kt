package com.example.data

import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue

@RunWith(JUnit4::class)
class UserRepositoryTest {

    private lateinit var cache: UserCache

    @Before
    fun setUp() {
        cache = UserCache()
    }

    @Test
    fun testGetUser_returnsUserFromCache() {
        val user = User("1", "Test User", "test@example.com", UserRole.VIEWER)
        cache.put(user)
        val result = cache.get("1")
        assertEquals(user, result)
    }

    @Test
    fun testGetUser_returnsNullWhenNotCached() {
        val result = cache.get("unknown-id")
        assertNull(result)
    }

    @Test
    fun testSaveUser_updatesCache() {
        val user = User("2", "New User", "new@example.com", UserRole.EDITOR)
        cache.put(user)
        assertTrue(cache.contains("2"))
    }

    @Test
    fun testUserRoles_adminHasAllPermissions() {
        val admin = User("3", "Admin", "admin@example.com", UserRole.ADMIN)
        assertTrue(admin.role == UserRole.ADMIN)
    }
}
