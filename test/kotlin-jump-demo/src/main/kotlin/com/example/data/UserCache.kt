package com.example.data

class UserCache {
    private val store = mutableMapOf<String, User>()

    fun get(id: String): User? = store[id]

    fun put(user: User) {
        store[user.id] = user
    }

    fun getAll(): List<User> = store.values.toList()

    fun contains(id: String): Boolean = store.containsKey(id)

    fun clear() = store.clear()
}
