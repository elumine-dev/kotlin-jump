package com.example.data

data class User(
    val id: String,
    val name: String,
    val email: String,
    val role: UserRole,
)

enum class UserRole {
    ADMIN,
    EDITOR,
    VIEWER,
}

sealed class UserEvent {
    data class Created(val user: User) : UserEvent()
    data class Updated(val user: User) : UserEvent()
    data object Deleted : UserEvent()
}

typealias UserList = List<User>
