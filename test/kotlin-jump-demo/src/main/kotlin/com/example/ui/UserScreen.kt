package com.example.ui

import com.example.data.User
import com.example.data.UserRole

class UserScreen(private val viewModel: UserViewModel) {

    fun render() {
        val users = listOf(
            User("1", "Alice", "alice@example.com", UserRole.ADMIN),
            User("2", "Bob", "bob@example.com", UserRole.EDITOR),
        )

        for (user in users) {
            displayUserCard(user)
        }
    }

    private fun displayUserCard(user: User) {
        println("${user.name} (${user.role})")
    }
}
