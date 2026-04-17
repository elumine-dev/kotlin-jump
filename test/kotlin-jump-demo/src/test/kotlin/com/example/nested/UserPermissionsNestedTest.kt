package com.example.nested

import com.example.data.User
import com.example.data.UserRole
import com.example.data.UserRole.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

/**
 * Container-only outer class — no @Test methods directly on UserPermissionsNestedTest.
 * Tests Feature B: the outer class must still appear as a parent node in the Test Explorer
 * even though it has no direct test methods of its own.
 */
class UserPermissionsNestedTest {

    @Nested
    inner class AsViewer {
        private val user = User("1", "Alice Viewer", "alice@example.com", VIEWER)

        @Test
        fun `has viewer role`() {
            assertEquals(VIEWER, user.role)
        }

        @Test
        fun `is not an editor`() {
            assertNotEquals(EDITOR, user.role)
        }

        @Test
        fun `is not an admin`() {
            assertNotEquals(ADMIN, user.role)
        }

        @Test
        fun `user data is intact`() {
            assertEquals("Alice Viewer", user.name)
            assertEquals("alice@example.com", user.email)
        }
    }

    @Nested
    inner class AsEditor {
        private val user = User("2", "Bob Editor", "bob@example.com", EDITOR)

        @Test
        fun `has editor role`() {
            assertEquals(EDITOR, user.role)
        }

        @Test
        fun `is not a viewer`() {
            assertNotEquals(VIEWER, user.role)
        }

        @Test
        fun `is not an admin`() {
            assertNotEquals(ADMIN, user.role)
        }

        @Test
        fun `editor email is valid`() {
            assertTrue(user.email.contains("@"))
        }
    }

    @Nested
    inner class AsAdmin {
        private val user = User("3", "Carol Admin", "carol@example.com", ADMIN)

        @Test
        fun `has admin role`() {
            assertEquals(ADMIN, user.role)
        }

        @Test
        fun `is not a viewer`() {
            assertNotEquals(VIEWER, user.role)
        }

        @Test
        fun `is not an editor`() {
            assertNotEquals(EDITOR, user.role)
        }

        @Test
        fun `admin id is non-empty`() {
            assertTrue(user.id.isNotEmpty())
        }
    }
}
