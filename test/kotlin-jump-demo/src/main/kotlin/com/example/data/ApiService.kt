package com.example.data

interface ApiService {
    suspend fun fetchUser(id: String): User
    suspend fun updateUser(user: User)
    suspend fun deleteJSDUser(id: String)
}
