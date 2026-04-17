package com.example.ui

import com.example.app.R
import com.example.data.User
import com.example.data.UserRole

class UserScreen(private val viewModel: UserViewModel) {

    companion object {
        val SCREEN_TITLE = R.string.title_users
        val EMPTY_STATE  = R.string.msg_empty_team
    }

    fun render() {
        println("=== ${R.string.title_users} ===")
        val users = listOf(
            User("1", "Alice", "alice@example.com", UserRole.ADMIN),
            User("2", "Bob", "bob@example.com", UserRole.EDITOR),
            User("3", "Carol", "carol@example.com", UserRole.VIEWER),
        )

        for (user in users) {
            displayUserCard(user)
        }
    }

    private fun displayUserCard(user: User) {
        val roleLabel = getRoleLabel(user.role)
        println("[${R.string.label_user_name}] ${user.name}")
        println("[${R.string.label_user_email}] ${user.email}")
        println("[${R.string.label_user_role}] $roleLabel")
    }

    private fun getRoleLabel(role: UserRole): Int = when (role) {
        UserRole.ADMIN  -> R.string.role_admin
        UserRole.EDITOR -> R.string.role_editor
        UserRole.VIEWER -> R.string.role_viewer
    }
}
