package com.example.kj.g5deadweight

// KJ-029 demo: the live references that keep resource files alive. Everything
// in res/ that is NOT named here (or in view_kj_banner.xml, or in the
// tools:keep list) is reported as unused.

class ResourceHost {

    fun show() {
        setContentView(R.layout.view_kj_banner) // keeps view_kj_banner alive
        startAnimation(R.anim.fade_kj_in) // keeps fade_kj_in alive
    }

    fun bind() {
        // ViewBinding is often a layout's only reference: view_kj_bound is
        // never named as R.layout.view_kj_bound anywhere.
        val binding = ViewKjBoundBinding.inflate(inflater)
        binding.toString()
    }

    fun loadConfig(): String {
        // A bare literal keeps a dynamically loaded raw resource alive.
        return openRaw("config_kj_dynamic")
    }

    private val inflater = Any()
    private fun setContentView(id: Int) = id
    private fun startAnimation(id: Int) = id
    private fun openRaw(name: String) = name
}

object R {
    object layout { const val view_kj_banner = 1 }
    object anim { const val fade_kj_in = 2 }
}

class ViewKjBoundBinding {
    companion object {
        fun inflate(inflater: Any) = ViewKjBoundBinding().also { inflater.hashCode() }
    }
}
