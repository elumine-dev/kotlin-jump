package com.example.data

/**
 * Repository for managing user data.
 *
 * @param apiService the remote API service
 * @param cache local cache for offline support
 */
interface UserRepository {
    suspend fun getUser(id: String): User
    suspend fun saveUser(user: User)
    fun observeUsers(): List<User>
}

class UserRepositoryImpl(
    private val apiService: ApiService,
    private val cache: UserCache,
) : UserRepository {

    override suspend fun getUser(id: String): User {
        return cache.get(id) ?: apiService.fetchUser(id).also {
            cache.put(it)
        }
    }

    override suspend fun saveUser(user: User) {
        apiService.updateUser(user)
        cache.put(user)
    }

    override fun observeUsers(): List<User> {
        return cache.getAll()
    }
}
