package com.example.data

class ApiServiceImpl(@Suppress("unused") private val baseUrl: String) : ApiService {

    override suspend fun fetchUser(id: String): User {
        // HTTP GET $baseUrl/users/$id
        return User(id, "John Doe", "john@example.com", UserRole.VIEWER)
    }

    override suspend fun updateUser(user: User) {
        // HTTP PUT $baseUrl/users/${user.id}
    }

    override suspend fun deleteUser(id: String) {
        // HTTP DELETE $baseUrl/users/$id
    }
}