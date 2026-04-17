package com.example.data

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.EnumSource
import org.junit.jupiter.params.provider.MethodSource

/**
 * UserPermissionChecker — role × action matrix, SecurityException on forbidden actions.
 */
class UserPermissionCheckerTest {

    private val checker = UserPermissionChecker()

    private fun user(role: UserRole) = User("1", "TestUser", "test@example.com", role)

    // ── ADMIN ─────────────────────────────────────────────────────────────────

    @ParameterizedTest(name = "ADMIN can {0}")
    @EnumSource(Action::class)
    fun `admin can perform every action`(action: Action) {
        assertTrue(checker.canPerform(user(UserRole.ADMIN), action))
    }

    // ── EDITOR ────────────────────────────────────────────────────────────────

    @ParameterizedTest(name = "EDITOR can {0}")
    @MethodSource("editorAllowedActions")
    fun `editor can read and write`(action: Action) {
        assertTrue(checker.canPerform(user(UserRole.EDITOR), action))
    }

    @ParameterizedTest(name = "EDITOR cannot {0}")
    @MethodSource("editorForbiddenActions")
    fun `editor cannot delete or manage users`(action: Action) {
        assertFalse(checker.canPerform(user(UserRole.EDITOR), action))
    }

    // ── VIEWER ────────────────────────────────────────────────────────────────

    @Test
    fun `viewer can only read`() {
        assertTrue(checker.canPerform(user(UserRole.VIEWER), Action.READ))
        assertFalse(checker.canPerform(user(UserRole.VIEWER), Action.WRITE))
        assertFalse(checker.canPerform(user(UserRole.VIEWER), Action.DELETE))
        assertFalse(checker.canPerform(user(UserRole.VIEWER), Action.MANAGE_USERS))
    }

    // ── requirePermission throws SecurityException ────────────────────────────

    @Test
    fun `requirePermission does not throw for allowed action`() {
        val viewer = user(UserRole.VIEWER)
        // Should not throw
        checker.requirePermission(viewer, Action.READ)
    }

    @Test
    fun `requirePermission throws SecurityException when viewer writes`() {
        val viewer = user(UserRole.VIEWER)
        val ex = assertThrows<SecurityException> {
            checker.requirePermission(viewer, Action.WRITE)
        }
        assertNotNull(ex.message)
        assertTrue(ex.message!!.contains("VIEWER"), "Error should mention role: ${ex.message}")
        assertTrue(ex.message!!.contains("WRITE"),  "Error should mention action: ${ex.message}")
    }

    @Test
    fun `requirePermission throws SecurityException when viewer deletes`() {
        assertThrows<SecurityException> {
            checker.requirePermission(user(UserRole.VIEWER), Action.DELETE)
        }
    }

    @Test
    fun `requirePermission throws SecurityException when editor deletes`() {
        assertThrows<SecurityException> {
            checker.requirePermission(user(UserRole.EDITOR), Action.DELETE)
        }
    }

    @Test
    fun `requirePermission throws SecurityException when editor manages users`() {
        assertThrows<SecurityException> {
            checker.requirePermission(user(UserRole.EDITOR), Action.MANAGE_USERS)
        }
    }

    // ── Full role × action matrix ─────────────────────────────────────────────

    @ParameterizedTest(name = "{0} + {1} → allowed={2}")
    @MethodSource("permissionMatrix")
    fun `permission matrix is correct`(role: UserRole, action: Action, expected: Boolean) {
        assertEquals(expected, checker.canPerform(user(role), action))
    }

    private fun assertEquals(expected: Boolean, actual: Boolean) {
        if (expected != actual) throw AssertionError("Expected $expected but was $actual")
    }

    companion object {
        @JvmStatic fun editorAllowedActions()  = listOf(Arguments.of(Action.READ), Arguments.of(Action.WRITE))
        @JvmStatic fun editorForbiddenActions() = listOf(Arguments.of(Action.DELETE), Arguments.of(Action.MANAGE_USERS))

        @JvmStatic
        fun permissionMatrix() = listOf(
            // ADMIN
            Arguments.of(UserRole.ADMIN, Action.READ,         true),
            Arguments.of(UserRole.ADMIN, Action.WRITE,        true),
            Arguments.of(UserRole.ADMIN, Action.DELETE,       true),
            Arguments.of(UserRole.ADMIN, Action.MANAGE_USERS, true),
            // EDITOR
            Arguments.of(UserRole.EDITOR, Action.READ,         true),
            Arguments.of(UserRole.EDITOR, Action.WRITE,        true),
            Arguments.of(UserRole.EDITOR, Action.DELETE,       false),
            Arguments.of(UserRole.EDITOR, Action.MANAGE_USERS, false),
            // VIEWER
            Arguments.of(UserRole.VIEWER, Action.READ,         true),
            Arguments.of(UserRole.VIEWER, Action.WRITE,        false),
            Arguments.of(UserRole.VIEWER, Action.DELETE,       false),
            Arguments.of(UserRole.VIEWER, Action.MANAGE_USERS, false),
        )
    }
}
