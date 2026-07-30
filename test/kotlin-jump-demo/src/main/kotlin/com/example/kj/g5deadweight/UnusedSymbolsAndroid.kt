package com.example.kj.g5deadweight

/**
 * KJ-032: entry points the framework reaches without any Kotlin call site.
 * None of these may ever be reported.
 */

// Alive: the manifest declares it as a <service>. The dot is a separator in
// the harvest, so `android:name=".ManifestOnlyWorker"` yields the token.
class ManifestOnlyWorker {
    fun onRun() = Unit
}

// Alive: a layout instantiates it by fully qualified name.
class GhostCustomView {
    fun render() = Unit
}

// Alive: only a string literal names it, for reflection.
class GhostReflected {
    fun invokeMe() = Unit
}

// Alive: a ProGuard -keep rule names it, so reflection may reach it.
class GhostKept {
    fun keepMe() = Unit
}

// Alive: extends a framework type through a base class of this project, so
// the guard has to walk the inheritance chain to see it.
class GhostScreen : DemoBaseFragment()

abstract class DemoBaseFragment : Fragment()
