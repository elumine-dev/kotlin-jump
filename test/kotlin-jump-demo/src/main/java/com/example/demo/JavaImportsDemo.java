package com.example.demo;

// KJ-033 fixture: the four Java import forms. Each one has to reach the word
// index, or a usage search silently skips this file.
import java.util.List;
import java.util.concurrent.*;
import static java.util.Collections.emptyList;
import static java.util.Arrays.*;

/** Only the last segment of an import reaches the word index. */
public class JavaImportsDemo {

    private final List<String> names = emptyList();

    public List<String> sorted() {
        return asList("a", "b");
    }

    public Executor executor() {
        return Executors.newSingleThreadExecutor();
    }
}
