package com.example.ui

import com.example.data.User
import com.example.data.UserEvent
import com.example.data.UserList
import com.example.data.UserRepository

class UserViewModel(
    private val repository: UserRepository,
) {
    var users: UserList = emptyList()
        private set

    suspend fun loadUser(id: String): User {
        return repository.getUser(id)
    }

    suspend fun updateUser(user: User) {
        repository.saveUser(user)
        refreshUsers()
    }

    fun refreshUsers() {
        users = repository.observeUsers()
    }

    fun handleEvent(event: UserEvent) {
        when (event) {
            is UserEvent.Created -> refreshUsers()
            is UserEvent.Updated -> refreshUsers()
            is UserEvent.Deleted -> refreshUsers()
        }
    }
}
