package com.example.kj.g5deadweight

// KJ-022: this single import moves retrofit-core to "1 import" in
// build.gradle.kts, while gson and okhttp stay at "0 imports".
import retrofit2.Retrofit

object DependencyUsageDemo {
    fun builderType(): String = Retrofit.Builder::class.java.simpleName
}
