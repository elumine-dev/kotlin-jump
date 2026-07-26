package com.example.kj.stubs

/**
 * Android stubs for the KJ demos: the workspace is a pure JVM project
 * (no Android SDK). These types reuse the NAMES of the Android APIs.
 * The Kotlin Jump regex parser works on text, not on types, so the demos
 * stay representative while still compiling on the JVM.
 */

// ── Logging ──────────────────────────────────────────────────────────────
object Log {
    fun d(tag: String, msg: String): Int = 0
    fun i(tag: String, msg: String): Int = 0
    fun w(tag: String, msg: String): Int = 0
    fun e(tag: String, msg: String, tr: Throwable? = null): Int = 0
}

// ── Context / Broadcast (KJ-016) ─────────────────────────────────────────
class Intent(val action: String = "")
class IntentFilter(val action: String = "")
abstract class BroadcastReceiver {
    abstract fun onReceive(intent: Intent)
}
interface LocationListener {
    fun onLocationChanged(lat: Double, lon: Double)
}
class WakeLock {
    fun acquire() {}
    fun release() {}
}

open class DemoActivity {
    open fun onCreate() {}
    open fun onStart() {}
    open fun onResume() {}
    open fun onPause() {}
    open fun onStop() {}
    open fun onDestroy() {}

    fun registerReceiver(receiver: BroadcastReceiver, filter: IntentFilter) {}
    fun unregisterReceiver(receiver: BroadcastReceiver) {}
    fun requestLocationUpdates(listener: LocationListener) {}
    fun removeUpdates(listener: LocationListener) {}
}

// ── LiveData (KJ-014) ────────────────────────────────────────────────────
open class LiveData<T>(protected var stored: T) {
    fun observe(observer: (T) -> Unit) = observer(stored)
    val value: T get() = stored
}
class MutableLiveData<T>(initial: T) : LiveData<T>(initial) {
    fun postValue(v: T) { stored = v }
    fun setValue(v: T) { stored = v }
}

// ── Room (KJ-010, KJ-020) ────────────────────────────────────────────────
annotation class Entity(val tableName: String = "")
annotation class PrimaryKey(val autoGenerate: Boolean = false)
annotation class ColumnInfo(val name: String = "", val defaultValue: String = "")
annotation class Dao
annotation class Query(val value: String)
annotation class Database(
    val entities: Array<kotlin.reflect.KClass<*>> = [],
    val version: Int = 1,
    val autoMigrations: Array<AutoMigration> = [],
)
annotation class AutoMigration(val from: Int, val to: Int)

// ── Compose helpers missing from JVM runtime ─────────────────────────────
fun stringResource(id: Int): String = "res:$id"
fun <T> kotlinx.coroutines.flow.StateFlow<T>.collectAsState(): T = value

class SupportSQLiteDatabase {
    fun execSQL(sql: String) {}
}
abstract class Migration(val startVersion: Int, val endVersion: Int) {
    abstract fun migrate(db: SupportSQLiteDatabase)
}

// ── Navigation Compose (KJ-013, KJ-018) ──────────────────────────────────
class NavHostController {
    fun navigate(route: String) {}
    fun popBackStack(): Boolean = true
}
class NavDeepLinkBuilder { var uriPattern: String = "" }
class NavGraphBuilder {
    fun composable(
        route: String,
        deepLinks: List<NavDeepLinkBuilder> = emptyList(),
        content: () -> Unit,
    ) {}
    fun navigation(
        startDestination: String,
        route: String,
        builder: NavGraphBuilder.() -> Unit,
    ) {
        NavGraphBuilder().builder()
    }
}
fun rememberNavController(): NavHostController = NavHostController()
fun navDeepLink(builder: NavDeepLinkBuilder.() -> Unit): NavDeepLinkBuilder =
    NavDeepLinkBuilder().apply(builder)
fun NavHost(
    navController: NavHostController,
    startDestination: String,
    builder: NavGraphBuilder.() -> Unit,
) {
    NavGraphBuilder().builder()
}

// ── Misc UI (KJ-004, KJ-019) ─────────────────────────────────────────────
class TextViewStub {
    fun setText(text: String) {}
    fun setText(resId: Int) {}
    fun setHint(hint: String) {}
}
class ViewBinding {
    val title = TextViewStub()
    val subtitle = TextViewStub()
}
class PokemonApi {
    suspend fun fetchPokemon(id: Int): String = "pikachu-$id"
}
