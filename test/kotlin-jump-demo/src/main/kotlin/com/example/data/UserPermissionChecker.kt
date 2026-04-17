package com.example.data

enum class Action { READ, WRITE, DELETE, MANAGE_USERS }

/**
 * Role-based permission checker.
 * ADMIN  → all actions
 * EDITOR → READ + WRITE only
 * VIEWER → READ only
 */
class UserPermissionChecker {
    fun canPerform(user: User, action: Action): Boolean = when (user.role) {
        UserRole.ADMIN  -> true
        UserRole.EDITOR -> action == Action.READ || action == Action.WRITE
        UserRole.VIEWER -> action == Action.READ
    }

    /**
     * Throws [SecurityException] if the user cannot perform the given action.
     */
    fun requirePermission(user: User, action: Action) {
        if (!canPerform(user, action)) {
            throw SecurityException(
                "User '${user.name}' with role ${user.role} is not allowed to perform $action"
            )
        }
    }
}
