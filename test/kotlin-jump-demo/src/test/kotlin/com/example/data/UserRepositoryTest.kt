package com.example.data

class UserRepositoryTest {

    private val cache = UserCache()
    private val apiService = ApiServiceImpl("https://test.example.com")
    private val repository = UserRepositoryImpl(apiService, cache)

    fun testGetUser() {
        val user = User("1", "Test User", "test@example.com", UserRole.VIEWER)
        cache.put(user)
        // repository.getUser("1") should return cached user
    }

    fun testSaveUser() {
        val user = User("2", "New User", "new@example.com", UserRole.EDITOR)
        // repository.saveUser(user) should update cache
    }
}
