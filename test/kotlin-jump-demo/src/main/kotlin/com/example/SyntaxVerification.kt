// ─────────────────────────────────────────────────────────────────────────────
// SYNTAX VERIFICATION FILE — kotlin-jump manual highlight testing
// Open this file in VS Code after `npm run compile` + extension reload.
// Go through doc/plans/syntax-verification.md line by line.
// ─────────────────────────────────────────────────────────────────────────────

package com.example

import kotlin.math.abs
import kotlinx.coroutines.launch

// ── 1. COMMENTS ──────────────────────────────────────────────────────────────

// Line comment

/* Block comment */

/**
 * KDoc comment
 * @param x a parameter
 * @return something
 */

// ── 2. PACKAGE & IMPORT ──────────────────────────────────────────────────────

// (see top of file)

// ── 3. ANNOTATIONS ───────────────────────────────────────────────────────────

@Target(AnnotationTarget.CLASS)
annotation class MyAnnotation

@MyAnnotation
@Suppress("unused")
class AnnotatedClass

// ── 4. CLASS DECLARATIONS ────────────────────────────────────────────────────

class PlainClass

open class OpenClass

abstract class AbstractClass {
    abstract fun abstractFun()
}

inner class InnerClass  // inside another class context (see NestedHost below)

class NestedHost {
    inner class InnerClass
    class NestedClass
    companion object CompanionName
}

// ── 5. DATA CLASS ────────────────────────────────────────────────────────────

data class DataClass(
    val id: Int,
    val name: String,
    var mutable: Boolean,
)

// ── 6. SEALED CLASS ──────────────────────────────────────────────────────────

sealed class SealedClass {
    data class SubData(val value: Int) : SealedClass()
    object SubObject : SealedClass()
    data object SubDataObject : SealedClass()
}

// ── 7. SEALED INTERFACE ──────────────────────────────────────────────────────

sealed interface SealedInterface {
    fun contract()
}

// ── 8. INTERFACE ─────────────────────────────────────────────────────────────

interface RegularInterface {
    fun interfaceFun()
    val interfaceProp: String
}

fun interface FunctionalInterface {
    fun invoke()
}

// ── 9. ENUM CLASS ────────────────────────────────────────────────────────────

enum class Direction {
    NORTH,
    SOUTH,
    EAST,
    WEST,
}

enum class Planet(val mass: Double) {
    MERCURY(3.303e+23),
    VENUS(4.869e+24),
}

// ── 10. OBJECT ───────────────────────────────────────────────────────────────

object Singleton

object NamedObject {
    const val CONSTANT = "value"
}

// ── 11. DATA OBJECT ──────────────────────────────────────────────────────────

data object DataObject

// ── 12. COMPANION OBJECT ─────────────────────────────────────────────────────

class WithCompanion {
    companion object {
        fun create(): WithCompanion = WithCompanion()
    }
}

// ── 13. TYPEALIAS ─────────────────────────────────────────────────────────────

typealias StringList = List<String>
typealias Callback = (Int) -> Unit

// ── 14. FUNCTIONS — TOP-LEVEL ─────────────────────────────────────────────────

fun plainFunction() {}

fun functionWithParams(x: Int, y: String): Boolean = x > 0

suspend fun suspendFunction() {}

inline fun inlineFunction(block: () -> Unit) = block()

infix fun Int.add(other: Int) = this + other

operator fun DataClass.plus(other: DataClass) = DataClass(id + other.id, name, mutable)

tailrec fun factorial(n: Int, acc: Long = 1L): Long =
    if (n <= 1) acc else factorial(n - 1, acc * n)

// ── 15. EXTENSION FUNCTION ───────────────────────────────────────────────────

fun String.shout(): String = this.uppercase()

fun List<Int>.sumPositive(): Int = filter { it > 0 }.sum()

// ── 16. FUNCTIONS — MEMBER ───────────────────────────────────────────────────

class MemberFunctions : RegularInterface, SealedInterface {
    fun memberFun() {}
    private fun privateFun() {}
    protected fun protectedFun() {}
    internal fun internalFun() {}
    override fun interfaceFun() {}
    override val interfaceProp: String = "impl"
    override fun contract() {}
    suspend fun suspendMember() {}
    inline fun inlineMember(block: () -> Unit) = block()
    override fun toString(): String = "MemberFunctions"
}

// ── 17. OVERRIDE + SUSPEND COMBO ─────────────────────────────────────────────

abstract class BaseCoroutine {
    abstract suspend fun fetch(): String
}

class ConcreteCoroutine : BaseCoroutine() {
    override suspend fun fetch(): String = "data"
}

// ── 18. PROPERTIES — TOP-LEVEL ───────────────────────────────────────────────

val topLevelVal: Int = 42
var topLevelVar: String = "hello"
const val CONST_VAL = "constant"

// ── 19. PROPERTIES — MEMBER ──────────────────────────────────────────────────

class PropertyHolder {
    val memberVal: Int = 1
    var memberVar: String = "x"
    lateinit var lateinitVar: String
    val computed: Int get() = memberVal * 2
}

// ── 20. INLINE CONSTRUCTOR PROPERTIES ───────────────────────────────────────

data class Point(val x: Float, val y: Float)

class Wrapper(val inner: String, var count: Int = 0)

// ── 21. ENUM ENTRIES ─────────────────────────────────────────────────────────

// (see Direction and Planet above)

// ── 22. TYPE REFERENCES ──────────────────────────────────────────────────────

fun typeRefs() {
    val list: List<DataClass> = emptyList()
    val map: Map<String, Int> = emptyMap()
    val nullable: Direction? = null
    val lambda: (Int) -> Boolean = { it > 0 }
}

// ── 23. CONTROL FLOW KEYWORDS ────────────────────────────────────────────────

fun controlFlow(x: Int): String {
    if (x > 0) return "positive"
    else if (x < 0) return "negative"
    else return "zero"
}

fun whenExpression(d: Direction): Int = when (d) {
    Direction.NORTH -> 0
    Direction.SOUTH -> 1
    Direction.EAST  -> 2
    Direction.WEST  -> 3
}

fun loops() {
    for (i in 0..10) { }
    var i = 0
    while (i < 10) { i++ }
    do { i-- } while (i > 0)
}

fun exceptionHandling() {
    try {
        throw IllegalStateException("error")
    } catch (e: Exception) {
        // caught
    } finally {
        // cleanup
    }
}

// ── 24. OPERATORS ─────────────────────────────────────────────────────────────

fun operators() {
    val a = 1 + 2 - 3 * 4 / 5 % 6
    val b = a == 1 || a != 2 && a < 3
    val c = a <= 4 || a >= 5
    val d = a === a
    val e = !b
    val f = a..10
    val g = a++
    val h = --a
}

// ── 25. STRING LITERALS ───────────────────────────────────────────────────────

fun strings() {
    val simple = "hello world"
    val interpolated = "value is $topLevelVal"
    val expression = "double is ${topLevelVal * 2}"
    val multiline = """
        line one
        line two
        $topLevelVal
    """.trimIndent()
    val char = 'A'
}

// ── 26. NUMBER LITERALS ───────────────────────────────────────────────────────

fun numbers() {
    val decimal = 1_000_000
    val long = 1L
    val float = 3.14f
    val double = 3.14
    val hex = 0xFF
    val binary = 0b1010
}

// ── 27. BOOLEAN & NULL LITERALS ──────────────────────────────────────────────

fun literals() {
    val t = true
    val f = false
    val n: String? = null
}

// ── 28. LAMBDA & ARROW ───────────────────────────────────────────────────────

fun lambdas() {
    val add: (Int, Int) -> Int = { a, b -> a + b }
    val square = { x: Int -> x * x }
    listOf(1, 2, 3).map { it * 2 }
}

// ── 29. SAFE CALL & ELVIS ─────────────────────────────────────────────────────

fun safeOps(s: String?) {
    val len = s?.length
    val safe = s ?: "default"
    val forced = s!!
}

// ── 30. THIS & SUPER ──────────────────────────────────────────────────────────

open class Base {
    open fun greet() = "Base"
}

class Derived : Base() {
    override fun greet() = super.greet() + " Derived"
    fun self() = this
}

// ── 31. IS / AS / IN ─────────────────────────────────────────────────────────

fun checks(any: Any) {
    if (any is String) println(any.length)
    val s = any as? String
    val inRange = 5 in 1..10
}

// ── 32. COROUTINE SCOPE FUNCTIONS (hardcoded in SemanticTokensProvider) ───────

fun coroutines() {
    // These should get M_ASYNC semantic color:
    // launch { }
    // async { }
    // withContext(...) { }
    // runBlocking { }
}

// ── 33. COMPOSE STATE APIs (hardcoded in SemanticTokensProvider) ─────────────

// These should get M_COMPOSABLE + M_READONLY:
// remember { }
// mutableStateOf(...)
// rememberSaveable { }

// ── 34. METHOD REFERENCE ──────────────────────────────────────────────────────

fun methodRef() {
    val ref = ::plainFunction
    val strRef = String::length
}
