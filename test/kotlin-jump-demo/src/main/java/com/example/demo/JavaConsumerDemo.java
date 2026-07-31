package com.example.demo;

// KJ-033 fixture: the cross-language path. This file imports and uses a Kotlin
// declaration, which is exactly what used to be invisible to Find Usages.
import com.example.kj.g5deadweight.UnusedSymbolsConsumer;

public class JavaConsumerDemo {

    private final UnusedSymbolsConsumer consumer = new UnusedSymbolsConsumer();

    public String badge() {
        return consumer.badge();
    }
}
