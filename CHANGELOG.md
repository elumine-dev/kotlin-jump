# Changelog

## 1.42.54

Kotlin Jump 1.42.54 gives back the speed the previous release paid for correctness. Folding and semantic tokens answer from cache without reading the document at all when nothing has changed.

### Improvements
- A cache hit is free again. Making the cache key the text itself, in 1.42.53, meant reading and hashing the document on every request, even when the answer was already there. Measured over the 60 largest files of a real Android project, a hit went from 0.00013 ms to 0.037 ms. It is back to 0.00013 ms.
- The trick is that the same document object at the same version is necessarily the same text, because the version is bumped on every change. Comparing the reference costs nothing, and the text is only hashed when the object differs, which is exactly the reopened file the fingerprint was added for.
- Reopening a file after it changed outside the editor is still caught. The fingerprint remains the fallback, and the check that proves it, two texts of exactly 64 characters at the same path and version, still holds.

## 1.42.53

Kotlin Jump 1.42.53 closes a hole the caches had kept since they were first written. Reopening a file after it changed outside the editor could show you the previous version's folds, colours and lenses.

### Fixes
- Closing a document destroys it, and reopening the file builds a new one whose version restarts at 1. The five caches keyed on that version, some also on the text length, so two different texts of the same size at the same URI answered as one. Reproduced with two files of exactly 64 characters: the second was given the first one's fold ranges. Folding, semantic tokens, the sealed when lens, the state provenance lens and the shared symbol analysis all keyed on a content fingerprint now, so the identity is the text itself.
- The fingerprint costs a few percent of what the cache saves. Measured over a real Android project of 3187 Kotlin files, it takes 4.7 microseconds on the average file and 0.095 ms on the largest, against 1.7 ms to recompute one file's folds. The repository benchmark shows no measurable change.

## 1.42.52

Kotlin Jump 1.42.52 gives the last unbounded cache a ceiling. This one is keyed by symbol rather than by file, and it held every usage count the editor ever showed you.

### Improvements
- The usage count cache stops growing with the session. Every lens you scroll past resolves a usage scan whose result was kept for good; the reference project would produce 23 628 of them, each holding a list of usage sites. It now keeps 512, sized on the measurement that a single dense file produces 202 lenses on its own, so several files can be on screen without any rescan.
- A scan still running is never dropped. The ceiling skips entries whose result has not arrived or that a request is still waiting on, so capping cannot cancel work in flight or make the same symbol scan twice.

## 1.42.51

Kotlin Jump 1.42.51 finishes what the previous release started. One of the four per file caches was left behind, and three of the tests written to guard the change could not tell the two behaviours apart.

### Improvements
- The state provenance cache drops the oldest file like the other three. It still emptied itself completely once full, which was the behaviour the shared helper was introduced to replace, since emptying makes every open editor recompute at once. It was the one cache not migrated, in the very release that added the helper to stop them drifting apart.

### Fixes
- Three of the new cache tests were not testing what they claimed. They asserted the cache stays under its ceiling, which is true whether it drops the oldest file or empties itself, so reverting to the old behaviour left them green. They now assert the cache stays full, which only holds for one of the two.

## 1.42.50

Kotlin Jump 1.42.50 gives the two remaining per file caches the ceiling the folding cache got last release, and makes all three drop the oldest file instead of emptying themselves.

### Improvements
- Semantic tokens no longer keep the colouring of every file visited. Measured over a real Android project of 5088 files: 5088 entries holding 892 635 words of token data, for files that had long since left the screen. It now keeps 64.
- The sealed when coverage lens gets the same ceiling: it held 3187 entries to show 207 lenses.
- All three caches now drop the oldest file rather than clearing themselves. Emptying the whole map would have made every open editor recompute at once, which for semantic tokens means a visible repaint. One shared helper does it, so the three cannot drift apart again, which is how the folding one had been missed.

## 1.42.49

Kotlin Jump 1.42.49 puts a ceiling on the folding cache. It kept one entry for every file visited since the window opened, including the thousands you closed hours ago.

### Improvements
- The folding cache holds the files you can actually see. It was keyed by file with nothing ever removed, so browsing a project filled it and it never emptied. Measured over a real Android project of 5088 files: 5088 entries and 44 058 fold ranges retained, none of them on screen. It now keeps at most 64 files, which is far more than anyone has open, so nothing is recomputed in normal use. The same ceiling has been on the state provenance cache since it was added; this one was simply missed.

## 1.42.48

Kotlin Jump 1.42.48 contains no change to the extension. It finishes the previous release, whose fix would have come undone the day someone renamed a private method.

### Fixes
- The two Logcat tests no longer depend on the name of a private method. They stopped the stream by replacing `startStream` on the instance, so renaming it during a refactor would have quietly let them launch a real adb process again, and every test would still have passed. They now replace the adb entry point itself, which no rename can route around.
- Verified across the whole suite: with the adb entry point made to fail on purpose, all 6450 tests still pass, so no test anywhere reaches a real process launch.

## 1.42.47

Kotlin Jump 1.42.47 contains no change to the extension. Two of our own Logcat tests were launching a real `adb logcat` process while the suite ran.

### Fixes
- The unit suite no longer starts a child process. Two tests added in the last few releases called the device switch directly, which starts the stream, which spawns adb. They passed either way, so nothing pointed at it: the result depended on whether adb was installed on the machine, and each run left the two second reconnection timer behind.
- A new test holds the line. It replaces the adb entry point with one that refuses to run and asserts that switching device, clearing, following a process and disposing the service all reach it zero times.

## 1.42.46

Kotlin Jump 1.42.46 pays back the cost of the last two releases. Recognising build variant test source sets had made the path check three times slower, and it runs once per candidate on the Go to Definition path and once per symbol in the dead code scan.

### Improvements
- The test source set check no longer allocates on every call. It split the setting and the whole path into components each time, for every configured segment; it now parses each setting once and walks only the few `src` positions of the path. Measured over the 5088 files of a real Android project, a full pass fell from 26.1 ms to 9.9 ms. Against the release before variant support it is 17 percent slower rather than 209 percent, and it recognises 155 more real test files.
- The answer is unchanged. The rewrite was checked against the previous one over 94 440 combinations of real path and setting, with no difference.

## 1.42.45

Kotlin Jump 1.42.45 finishes the test source set rule shipped in the previous release. Writing the setting with its own `src` prefix used to lose the build variants.

### Fixes
- A source set written as `src/test/kotlin` in the settings now covers `src/testDebug/kotlin` too, the same way `test/kotlin` already did. The rule read the setting as the pair `src` then `test`, looked for a variant of `src`, and found none. What the setting names after the source set is still required exactly, so `src/testDebug/res` stays out.

## 1.42.44

Kotlin Jump 1.42.44 comes from running the extension over a real Android codebase instead of test fixtures: two apps, 3187 Kotlin files, 1901 Java files, 267 000 lines. Every analysis was driven over every file, and the answers were checked against what the file actually contains.

### Fixes
- Expand Selection selects around the cursor, not above it. On a data class whose parameters each carry an annotation on the line above, putting the cursor on the annotation selected the PREVIOUS property. The containment test ran before the walk back over annotation lines, and the range that came out no longer held the cursor. Twenty four files of that codebase were affected.
- Unit tests in a build variant are recognised. That codebase keeps them in `src/testReplica/java` and `src/testAdPreflightLaPresseRelease/java`, and 155 real test files were classified as production code. The variant rule is now anchored where Gradle puts the source set name, the directory right after `src`.
- A production file is no longer mistaken for a test. The first version of that variant rule looked at every component of the path, so a file named `androidTestHelper.kt` and a module named `androidTestUtils` both counted as test code, and Go to Definition hid them from every production file.
- Reopening a file after closing it without saving no longer shows the structure of the previous session. A closed document is destroyed and a reopened one restarts at version 1, so the version alone could not tell two texts apart. When the earlier buffer was longer, the Outline threw and emptied itself.
- The Logcat process filter keeps the main process. It was retired first when the app spawned more processes than the cap, so the rows the reader actually wants disappeared while the noise stayed.
- Reconnecting to the same device no longer replays the whole device buffer. The resume anchor was dropped on any device switch, including a switch back to the device already selected.
- A write at the very end of a file counts. The list of write positions behind the state lens still used the older pattern, which needs a character after the equals sign, so the lens said one write and offered no place to jump to.

## 1.42.43

Kotlin Jump 1.42.43 contains no change to the extension. It replaces one of our own tests that measured a wall clock and failed on a loaded build machine, which left the previous release red even though it shipped correctly.

### Fixes
- A regression test now asserts on behaviour instead of on elapsed time. It guarded a shortcut that skips scanning function bodies when a file declares no state, and it did so with a threshold in milliseconds. It checks the two outcomes that matter instead: a file with no state produces no lens, and a file with a single state keeps its lens and its indirect writes.

## 1.42.42

Kotlin Jump 1.42.42 undoes the damage of its own last four releases. An adversarial pass over those diffs found sixteen defects the fixes themselves had introduced, and this release closes them. Most came from the same mistake: a guard added to stop one wrong answer also silenced the right one.

### Fixes
- Screen Flow draws its arrows again. Two ordinary shapes had been caught by the ambiguity guard added last release: the same route declared in two flavors, which is one destination and not a conflict, and a parameterised screen sitting beside a literal sibling, `profile/{userId}` next to `profile/edit`, which is how a Compose graph is normally written. On a project with flavors the map had become a grid of boxes with no links at all.
- Go to Definition works again inside a variant test source set. Gradle names them by suffix, `androidTest` becoming `androidTestDebug`, and the bounded path comparison introduced two releases ago recognised none of them. From a test in one of those directories, Cmd click returned nothing.
- Switching Logcat device shows rows again. The resume anchor is a timestamp read from the previous device's clock, and it was carried over. An emulator on one clock and a phone on another are hours apart, so the new stream asked for logs from the future.
- A second process of the followed app no longer disappears from Logcat. Restarting the app dropped every process it knew, but a receiver in a `:push` process often starts before the main one, and a foreground service in `:player` outlives the interface being killed. Only the previous main process is retired now, and the set is capped so it cannot grow forever.
- The state provenance lens counts a write glued to another. `_a.value=_b.emit(v)`, with no space, ate the first character of the second write, so one of the two states read as never written.
- Reopening a file that changed while its tab was closed no longer shows the previous lenses. A reopened document starts back at version 1, so the version alone was not an identity for the content.

### Improvements
- Editing a large file is cheaper. The structure of an unsaved buffer was analysed once for the outline, once for folding and once for Expand Selection, and each analysis also filled lookup tables nothing was going to read. Measured on a file of 5000 lines, the outline and folding pair fell from 9 ms to 4.8 ms.
- A file that declares no state costs almost nothing to the provenance lens, which used to scan every function body before discovering there was nothing to report.

## 1.42.41

Kotlin Jump 1.42.41 fixes three things that only show up once you have used the panel for a while: Clear replaying the whole device buffer, the Follow filter letting old processes through, and Run on device failing silently under PowerShell.

### Fixes
- Clear no longer makes the next stream replay the whole device buffer. The resume anchor was read from the ring buffer that Clear had just emptied, so the reconnection started with no anchor at all and every line already seen came back.
- Following the app by process no longer keeps dead processes. Each restart added a process and kept the previous ones forever, and once Android reused one of those numbers for another app its lines passed the filter. A new main process for the followed package now clears the previous generation, and secondary processes still add to it.
- Run on device works when adb sits in a path with a space, under PowerShell. The command started with a quoted path, which PowerShell prints instead of running, so the launch failed with nothing useful on screen. The call operator is now added the same way it already was for gradlew.

## 1.42.40

Kotlin Jump 1.42.40 fixes Back. Pressing it right after a jump used to overwrite the entry you were trying to return to, and switching to a tab you already had open filed it at line 0.

### Fixes
- Back pressed within half a second of a jump no longer destroys the origin. A late selection event for the destination could still land in the entry the cursor had just moved onto, and rewrite it with the destination. The refinement now checks that the entry it is about to update is still the one it created, and moving through the history closes the pending window.
- Switching to a tab that is already open records the cursor where it actually is. No selection event fires for a file you have already visited, so the entry kept its placeholder of line 0, and coming back landed at the top of the file.
- On Windows, a file in a test source set is recognised again. The filter compared a path built with backslashes against segments written with slashes, so no file was ever seen as a test, and the rule that hides test results from a production file did the opposite of what it says.
- Go to Definition no longer treats a directory that merely starts like a test source set as one. It kept a private copy of the path check, written before the bounded comparison landed, so a repository holding a folder named after a test source set lost every definition in it.

## 1.42.39

Kotlin Jump 1.42.39 stops the Screen Flow map from drawing arrows it cannot justify. A navigation whose destination was a variable used to land on whichever screen happened to be declared first, and the map read as a fact.

### Fixes
- A `navigate(dest)` whose target the parser cannot resolve draws no arrow. The target became a placeholder, and a placeholder matched any declared route with the same number of segments, so the first one won. On a graph with a profile screen and an orders screen, both taking one argument, the arrow was a coin flip.
- `navigate("${Screen.Profile.route}/$userId")` now keeps the half it knows. The interpolation was blanked before the route constants were consulted, although the workspace declares that exact constant, so a target the parser could have resolved exactly became a wildcard.
- Two declared routes matching the same target no longer let the map pick one. It keeps the literal target instead, which is either a real screen or nothing at all.
- A route constant declared with the same name and two different values in two modules resolves to nothing. The scan kept whichever file was read last, so an arrow could point at another module's screen, and the answer changed with the file order.
- The legend counts the arrows on screen. Navigations from outside any composable, and targets no screen declares, have no box to start or end at, so they were counted and never drawn.

## 1.42.38

Kotlin Jump 1.42.38 makes the structure of a file follow the text on screen. Three features were reading the index of the last saved version, so any unsaved edit that moved a declaration pushed them onto the wrong lines. The state provenance lens also got its cost back under control.

### Fixes
- Outline, breadcrumbs, folding and Expand Selection now read the live buffer while it is dirty. The index follows the file on disk and is refreshed 150 ms after a save, so between a keystroke and that save every fold and every selection step landed on the lines of the older text. Expand Selection could even jump straight to the whole file, when no indexed symbol still covered the cursor.
- The folding cache no longer replays ranges computed while the buffer was unsaved. Saving does not change the document version, so the version alone could not tell the two states apart.
- A `<uses-permission>` written inside an XML comment no longer gets a risk pill. The manifest scan read the raw text, so a permission the app never requests still showed as dangerous.
- A vector drawable whose path holds a numeric character reference above the last Unicode code point no longer takes down the preview. It threw a RangeError and the panel stayed empty.
- The Reference link of the suppression hover now points somewhere real. One lint check has no published page and its link answered 404, and the Kotlin link went through a redirect stub.

### Improvements
- State provenance analyses a large ViewModel about 40 times faster. It used to strip the comments of the whole file once per state, then build a fresh regular expression for every state, function and writer triple. A ViewModel of 19 000 lines cost 1.5 s per refresh and now costs 34 ms.
- That lens caches its result per document version, so scrolling and typing elsewhere no longer recompute anything.
- A state declared inside a comment is no longer counted as a real state, and the count on the lens now agrees with the list of writes behind it.

## 1.42.37

Kotlin Jump 1.42.37 restores partially qualified names in the chat. Tightening the previous release so it would stop answering about another package went one step too far and lost `Outer.Inner`, the natural way to name a nested class.

### Fixes
- Resolves `Outer.Inner` again. For a nested class the outer name is part of the qualified name, not of the package, so the package equality rule added last release could never be satisfied and the answer became "not found". Three rules apply in order now: the exact qualified name, then a matching package, then a qualified suffix while it points at a single entry.
- Still refuses to guess. A suffix that matches two entries, such as `Holder.Item` declared in two packages, answers nothing rather than picking one, and an unknown package still answers nothing.

## 1.42.36

Kotlin Jump 1.42.36 stops three answers that were confidently wrong. Asking the chat for a fully qualified name answered about a class of another package, asking for implementations of a name the project does not declare returned some other type's, and hovering a suppression id written on its own line showed nothing.

### Fixes
- Honours the package you typed. `/doc com.app.User` and `/usages com.app.User` fell back to the first `User` in the index when the exact name was not found, so the answer described `com.other.User` with nothing saying so. An unknown qualified name now says it found nothing.
- Answers `/implementations` only for the name you asked about. The fallback was meant to be case insensitive, but it went through the fuzzy search without checking the match, so a name the workspace does not declare returned the implementations of whatever type ranked first.
- Shows the hover on a suppression written across several lines. Everything looked at the cursor line only, so an id sitting on its own line under an opening `@Suppress(` had no hover at all, which is the shape used as soon as there are two ids. The id is still read from the cursor line, so an ordinary hover costs one line read.

## 1.42.35

Kotlin Jump 1.42.35 fixes the Screen Flow map on the commonest way to declare routes, a sealed class of objects. A route holding a path parameter was read as an opening brace, so the screens declared after it lost their qualified name and came back as dynamic routes. The JDK sources are also found on a JDK 8 and indexed four times faster.

### Fixes
- Reads a sealed route hierarchy correctly. In `object Detail : Screen("detail/[id]")`, the braces of the path parameter looked like a block opening, so that screen became its own owner and every screen declared after it lost its qualified name. On the map they showed as dynamic routes with no arrow, which is exactly the shape most projects use.
- Keeps such a file in the map at all. The filter added last version to stop the map from freezing only knew the `const val ROUTE = "…"` form, so a file declaring its routes as objects was skipped entirely.
- Finds the JDK sources on a JDK 8, where `src.zip` sits at the root rather than under `lib`, and stops giving up when `JAVA_HOME` points at a runtime with no sources: that is now a fallback while the machine's real JDK is looked for.
- Indexes the JDK four times faster. Four fifths of a modern `src.zip` is the compiler, JShell, flight recorder, Swing and the internal `sun` packages, none of which a Kotlin or Android developer opens. The scan keeps `java.base` and the modules actually navigated, and still takes everything on a JDK 8.

## 1.42.34

Kotlin Jump 1.42.34 undoes seven side effects of its own recent fixes. The dead code detector had gone silent on whole projects, renaming a folder killed the initial index, a `gradlew clean` froze the window, and the Screen Flow map took seconds to open on a large workspace.

### Fixes
- Reports dead code again. The check for a published module was widened to catch version catalog aliases, and it then matched `alias(libs.plugins.maven.publish) apply false`, the line every root build file carries. The root counted as a published module, so the whole workspace read as public API and nothing was ever reported. A plugin declared with `apply false` is declared, not applied.
- Keeps indexing while you rename a folder. Adding or renaming one went through the rescan path, which cancels every scan in flight by design: it killed the initial index, and two renames in a row cancelled each other. Those files get their own scan now.
- Stops sweeping the index on a build. The watcher added to follow deleted folders ignored the exclude patterns, so every `.class` removed by a `gradlew clean` triggered a full pass over the index.
- Opens the Screen Flow map without freezing. Raising the file cap to 20000 meant a character by character comment scan over every Kotlin file in the workspace, navigation or not. Files that hold neither a route nor a navigation are skipped.
- Keeps the Logcat error banner visible. Rows already queued when the stream failed arrived a few milliseconds later and cleared the banner that the same release had just added.
- Stops silencing the Remote Config detector on `items.all { }`. The guard for an app that reads every key matched any `.all` in any file that merely mentions Remote Config, which is the commonest Kotlin idiom there is.
- Refuses to remove a manifest permission on a capped listing, exactly as it already refused for a component: both decide from the same incomplete evidence.

## 1.42.33

Kotlin Jump 1.42.33 fixes a bug our own previous fix introduced: a `"""` written inside a comment made Find Usages treat the rest of the file as text, so a symbol read "0 usages" and Rename left the old name behind. Large JDK classes such as `Arrays` and `Pattern` are navigable again, and the language server no longer misses a file whose folder name contains a comma or an ampersand.

### Fixes
- Counts usages again after a comment mentions a raw string. Tracking added in 1.42.26 counted every `"""` on the line, including one written in a `//` or `/* */` comment. From that line on, the whole file was treated as raw text: the lens said "0 usages", Find Usages and Go to References came back empty, and Rename skipped every call below, leaving the old name and a file that no longer compiles. A single scan of the code now decides the state, and a string holding `http://` is no longer read as a comment.
- Attributes a test result to the right test. The walk looking for a `@DisplayName` above a method crossed blank lines and one line declarations, so a test with no result of its own inherited the name, the state and the failure trace of its neighbour in the Test Explorer.
- Navigates to the big JDK classes. The scanner skipped any source over 200 KB, which is exactly where `Arrays`, `Collections`, `Character`, `Pattern` and `BigDecimal` live: Cmd+Click on them found nothing.
- Matches files whatever the editor's URI encoding. A folder named with a comma, an ampersand or a plus produced a different URI on each side, so a deleted file stayed in the index and an unsaved buffer fell back to its disk copy, both without a word. Paths are compared as paths now.
- Bounds the MCP `get_file_symbols` answer like every other tool, instead of returning a file's entire symbol list.

## 1.42.32

Kotlin Jump 1.42.32 repairs the standalone language server that Neovim, Helix and Zed talk to. Its index was frozen at startup, it could index your home directory instead of your project, and Go to Definition answered with every class of that name in the workspace. The permission hover also stops missing `SET_ALARM`.

### Fixes
- Keeps the index in step with the disk. The server announced document sync in the short form, which does not ask for save notifications, and a conformant client therefore never sent one. Since save was the only refresh path, a deleted class stayed navigable, a renamed one appeared twice, and only a restart fixed it. The server now asks for save notifications and registers a file watcher, so deletions and renames land immediately.
- Indexes your project, not your home directory. A client that sends `workspaceFolders` with a null `rootUri`, which is the modern form, fell through to the process working directory. Started from `~`, the server walked everything the user owns. All announced folders are indexed now, a project with several roots included, and no root announced means nothing scanned rather than a guess.
- Answers Go to Definition with the class you imported. Three same named `User` classes in a project is ordinary, and the server offered all three every time. An explicit import settles it, a wildcard import narrows to its package, and otherwise the declaration from the file's own package wins.
- Reports references at the right lines. They were read from the disk copy, so a few unsaved lines inserted above shifted every result. Open buffers are read from the editor now, and `includeDeclaration: false` is honoured instead of ignored.
- Stops indexing what is not code. Saving a README injected its words as symbols, a symlink inside the project walked the scan out of the project, and nothing capped the walk.

## 1.42.31

Kotlin Jump 1.42.31 repairs three things that were plainly broken: Organize Imports could turn the rest of a file into a comment, test coverage never appeared at all, and a `"""` written inside a comment killed the semantic colours from that line to the end of the file. Postfix completion on a safe call also stops producing Kotlin that does not compile.

### Fixes
- Keeps a comment written inside the import block. Organize Imports copied only the lines starting with `*` or `//`, so the inside of a `/* … */` vanished. When the lost line carried the `*/`, the comment stayed open and swallowed the rest of the file, class included: the module stopped compiling. An import commented out inside such a block is also no longer sorted as a real one.
- Shows test coverage. The class name was read from the wrong attribute of the report, `sourcefilename` instead of `name`, so every entry resolved to a file called `Foo.kt.kt` and was dropped in silence. Coverage now also looks under the module that ran the tests, in the KMP source sets, and for Java files, instead of only `src/main/kotlin` of the first workspace folder.
- Stops breaking the file on a safe call. Typing `viewModel?.` and picking a postfix template inserted `if (viewModel? == null)`, `val value = viewModel?` or `!viewModel?`, none of which compile. The question mark belongs to the dot, not to the receiver, and `let` still produces the `?.let` you want.
- Restores the colours after a `"""` written in a comment. An example of a raw string inside a `//` or `/* */` comment opened a raw string that never closed, so semantic highlighting, occurrence highlighting and KDoc folding stopped there and never came back in that file.
- Prints the release notes as written. This panel escaped everything and interpreted nothing, so the file names and flags quoted in the notes showed their backticks to the reader.

## 1.42.30

Kotlin Jump 1.42.30 fixes the dead code family where it could break a build or a running app: a Delete quick fix that landed on the wrong lines after an unsaved edit, a manifest activity reported as missing on a large project and offered for removal, a custom view constructor whose `attrs` parameter looked unused, a shrinker keep list reported as an unused resource, and Room enums whose entries come back from the database.

### Fixes
- Deletes what you selected, not what moved. A finding carries the offsets of its scan; after an unsaved edit above the declaration the quick fix removed a neighbouring line and left a fragment that did not compile. The extent is now recomputed on the text as it is, a declaration that moved is skipped, and the shared corpus drops its cache as soon as an open editor differs from what was scanned.
- Removes the annotation with its declaration. A `@Deprecated(` spanning several lines, or one whose argument contains a word like `val`, stayed behind and applied itself to the next declaration. A qualified `@org.greenrobot.eventbus.Subscribe` is now removed with its handler too.
- Stops offering to remove a live manifest component. Past four thousand source files the listing was capped, the class was simply not in it, and the badge said "class not found" with a Remove action: the app then threw ActivityNotFoundException at launch. A capped listing now proves nothing, for components and for unused dependencies alike.
- Keeps the constructor that inflates a custom view. `class MyView(context: Context, attrs: AttributeSet? = null)` reported `attrs` as unused; removing it compiled and threw InflateException the moment a layout used the view.
- Keeps `res/raw/keep.xml` and everything it protects. The shrinker keep list was reported as an unused raw resource with a Delete action, and the drawables named by its `tools:keep` wildcards were reported alongside it.
- Applies the dynamic lookup guard to resource keys. A string reached through `getIdentifier(key, "string", pkg)`, the shape of server driven copy, was reported unused and deleted; the guard already existed for resource files and now covers the values in them.
- Leaves Room enums alone. An `@Entity` stores an enum by name without any converter, so an entry no code mentions is still read back from every row already in the database. Deleting one turned an existing row into an exception.
- Recognises a Kotlin test class wherever it lives. A class holding `@Test` methods under `src/e2e/kotlin` is a runner entry point, not dead code, even though the folder is no Gradle test source set.
- Withdraws a fix that would break the build. `val (id, name, url) = repo.profile()` reads three fields without naming the class, so the verdict stands but the parameter is no longer offered for removal.
- Sees a module declared through a version catalog. `alias(libs.plugins.android.library)` and publishing convention plugins were invisible, so a published module's public API read as unreferenced and Remove all would have deleted it. Remote Config also stops reporting keys when the app iterates them all, and a commented out entry is no longer a declaration.

## 1.42.29

Kotlin Jump 1.42.29 fixes what the panels drew: a vector icon whose background covered its glyph, a badge scaled towards the corner instead of its centre, gradient shapes rendered empty, a preview panel stuck on the previous file, a Screen Flow map with a missing arrow and boxes drawn on top of each other, and a "libs" badge that counted the whole Gradle cache.

### Fixes
- Draws vector paths and groups in document order. A `<group>` background emitted after the top-level `<path>` covered the glyph in the preview panel, the gutter icon and the hovers.
- Scales a `<group>` about its pivot like Android does. A centred `scaleX="0.5"` badge shrank towards the top-left corner.
- Fills a `<gradient>` shape with its first colour instead of nothing, keeps `strokeLineCap`, `strokeLineJoin` and `strokeMiterLimit` (rounded outline icons had square ends), reads `android:width` even when `viewportWidth` comes first, and decodes XML entities once (`&amp;` in a path no longer doubles).
- Keeps the Vector Preview on the file you look at. Switching to a drawable that did not convert yet left the previous file's title and drawing, and edits to the new file never refreshed it. The panel now says the file is not renderable yet and follows the edits.
- Scans only workspace files for the "N references" lens of a drawable. With a warm Gradle cache every entry of every sources JAR was read, and again after each save.
- Connects a `navigate("detail/42")` to a `composable("detail/{id}")` declared in another file on the Screen Flow map. The legend counted the navigation but no arrow was drawn and the screen sat in the unreached column.
- Draws one box per route on the Screen Flow map. The same route in `src/main` and `src/debug`, or two dynamic routes at the same line of two files, drew on top of each other; a click now offers the files. The map reads up to 20000 Kotlin files instead of 2000 and says so when the cap is hit.
- Counts missing library sources by coordinates. The badge compared the declared dependencies with the size of the whole Gradle cache, so a cache filled by other projects read "300 libs, all indexed" while none of this project's had sources, and the download prompt never showed.
- Stops following redirects after five hops (a looping mirror kept the progress notification spinning forever) and refuses a captive portal's HTML page in place of a sources JAR, which used to be written to the cache and never retried. The summary says "failed" for a network fault and "not found" for a 404.
- Lists a module's files honestly in the Android view: 5000 instead of an arbitrary 500, with a closing entry when the cap is hit, and the `anim` folder no longer includes `animator/`.

## 1.42.28

Kotlin Jump 1.42.28 fixes what the index remembered wrongly: ghosts of renamed functions after a restart, a "not in equals/copy" hint on every data class property until the file was edited, a workspace class shadowed by its published JAR, a Cmd+T list full of local variables, files of `:app-widgets` filed under `:app`, and folders deleted or renamed in the explorer that stayed navigable.

### Fixes
- Restores a file from the snapshot without leaving ghosts. A file open at startup was scanned, restored, then scanned again, and the entries of the first scan stayed behind: a renamed function was still in Cmd+T and Cmd+Click jumped to its old line, a deleted class still resolved. The restore now replaces the file's entries like a scan does.
- Persists `expect`, `actual` and primary constructor parameters in the snapshot (version 24). After every restart, each property of a data class received the "not in equals/copy" hint, the KMP badges vanished and "show actuals" found nothing until the file was edited. `actual` also wins over `expect` whatever the restore order.
- Prefers the workspace over a JAR for the same symbol. With a library checked out next to an app that depends on its published artefact, Cmd+Click on `Result` opened the read-only JAR source. The bundled stdlib wins over another JAR the same way; among workspace files the newest still wins.
- Keeps local variables out of Cmd+T. 250 functions with a `val item` filled the 200-result cap before `ItemRepository`, which VS Code never received.
- Attaches a file to the most specific Gradle module. `:app-widgets` files were filed under `:app`, `:feature:home` under `:feature`, and on Windows nothing matched at all; "Run test" then ran the wrong Gradle task and answered "No tests found".
- Follows folders deleted or renamed in the explorer, `rm -rf` from a terminal, and workspace folders added or removed. VS Code reports one event for the folder, none for the files inside, so the index kept them: Cmd+T listed the classes, Cmd+Click opened "file not found", the renamed folder's files did not exist for navigation.
- Empties a file the rescan skips. A file that outgrew the size limit while VS Code was closed kept its old symbols and line numbers after the restore.
- Applies a relative exclude pattern in the watchers too. `app/build/**` is valid for the initial scan, but the watcher matched only absolute paths, and the first Gradle build indexed `app/build/generated/**`: duplicates in Cmd+T and two candidates on Cmd+Click.

## 1.42.27

Kotlin Jump 1.42.27 fixes the Logcat panel and Android Run: a device switch that left the panel empty, an unplugged phone that respawned adb every two seconds and then replayed its whole buffer, accents turned into replacement characters, a secondary process hijacking the PID filter, a Run that picked the emulator over the phone without asking, and a build command Windows could not run.

### Fixes
- Follows the app on the device you switch to. The PID resolved on the previous device stayed in the filter, so every row of the new device was dropped and the panel stayed empty until the app was launched again.
- Handles an unplugged device. adb exited at once and was respawned every two seconds with no message while the pill said "streaming"; when the device came back, adb replayed its whole buffer and every row already on screen appeared a second time. The stream now stops with a "Stream error" banner (it clears when rows flow again) and resumes from the last row once the device is listed again.
- Decodes UTF-8 across stdout chunks. A multi-byte character split between two chunks came out as two replacement characters in the panel, the search and the export.
- Keeps the main process when a secondary one starts. `Start proc 4600:com.app:sync` used to replace the followed PID, and the main process vanished; both are followed now. Turning the PID filter on also drops the rows still queued from other processes, which used to appear under the filtered replay.
- Reads logcat like the device writes it: `--------- beginning of system` is no longer glued to the previous message, frames such as `toString-impl`, `main$lambda-3`, `SourceFile:12` and `Unknown Source` are recognised (so the release build banner shows on an actual release build), a top-level function is found through its `UtilsKt` frame, and the export keeps the device wall-clock instead of switching to UTC.
- Keeps the rows under your eyes while the buffer is full. Reading back through a stack trace, every batch shifted the content up by the number of evicted rows; the scroll position now moves with them.
- Finds adb installed later in the session. The resolved path was cached, so the "adb binary not found" banner never went away after installing Android Studio without a reload.
- Asks which device to run on. With a phone and an emulator connected, Run installed on the first one adb listed, usually the emulator, with the phone's app never updated. A picker now appears, with the last choice first.
- Runs the build on Windows. `ANDROID_SERIAL="x" gradlew.bat …` is a POSIX spelling that PowerShell and cmd.exe rejected; the serial now travels in the terminal's environment and PowerShell gets its `&` before the quoted path.
- Launches the enabled launcher. Alternative app icons are `<activity-alias android:enabled="false">` entries carrying LAUNCHER; the first one used to win over the real MAIN activity and the launch failed after a successful build.

## 1.42.26

Kotlin Jump 1.42.26 fixes what the counters and the hints showed: a parameter hint placed inside a string, "0 usages" on every symbol of the default package, a lens count that disagreed with the panel it opened, a Test Explorer that skipped `src/testDebug/` and reported a `@DisplayName` test as skipped, and test names with spaces that Gradle on Windows never found.

### Fixes
- Places parameter hints on the arguments, not inside them. `send("a, b", 3)` put the `count:` hint after the comma in the string; a `//` comment or a `/* */` block among the arguments, and a `"""` raw string spanning lines, were counted the same way. A call inside a multi-line block comment received hints too.
- Stops borrowing a workspace function's parameters for an imported one. With `import kotlinx.coroutines.launch`, a `launch(a, b)` call was labelled with the names of the project's own `launch`.
- Counts usages the panel will show. The lens subtracted one hit for the declaration while the panel dropped the whole declaration line, so a recursive call read "1 usage" in one place and nothing in the other; only the declaration token is left out now. A lens request cancelled by a fast edit cut the shared scan short and the next lens read the partial count. The scan now stops only once every request waiting on it is gone.
- Finds usages in the default package. Two files without a `package` line could not reference each other, so every symbol in a small project or a scratch file read "0 usages" and Find Usages came back empty.
- Reads raw strings and open comments like the compiler. Every `id` in a multi-line SQL string counted as a usage of the property, and a `/*` opened after code on a line (`val x = 1 /* note`) hid nothing on the lines that followed. Only `$name` and `${…}` templates count inside a raw string.
- Discovers tests in every Gradle test source set. `src/testDebug/kotlin/` and `src/screenshotTest/` got a Run lens and then "test not found in index", while a `contest/java/` folder passed for `test/java/`.
- Matches a `@DisplayName("adds two numbers")` test to its result instead of reporting it skipped, targets a JUnit 5 `@Nested` class under both `Outer.Inner` and `Outer$Inner` so either Gradle version runs it, and quotes the arguments on Windows: `--tests "T.returns 404 (not found)"` reached cmd.exe as three words and Gradle answered "No tests found".

## 1.42.25

Kotlin Jump 1.42.25 fixes the Android detectors: lifecycle warnings on code that releases itself (and a quick fix that did not compile), Room migration drift on entities it could not even see, a Screen Flow map that painted reachable screens as orphans, implementation counts inflated by homonyms, and a raw resource offered for deletion while a video player named it.

### Fixes
- Stops the lifecycle warning on `FragmentDetailBinding.bind(view)`, `lifecycle.addObserver(x)`, `ProcessLifecycleOwner.get().lifecycle.addObserver(…)` and `onBackPressedDispatcher.addCallback(viewLifecycleOwner) { }`: the binding is released by `_binding = null`, the others detach themselves. The quick fix used to insert `unbind(view)`, `removeObserver(x)` without receiver or `removeCallback(viewLifecycleOwner)`, none of which compiled.
- Reads the resource of an acquisition from the right place. `wakeLock.acquire(10 * 60 * 1000L)` reported "10", `requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 10f, listener)` reported "LocationManager", `ContextCompat.registerReceiver(this, receiver, filter, flags)` reported "this", and `fusedClient.requestLocationUpdates(request, callback, looper)` was never matched by `removeLocationUpdates(callback)`. Any identifier argument or the receiver now pairs with the release; `bus.unsubscribe(h)` is no longer a `subscribe`.
- Pairs lifecycle methods within their own class. A `DefaultLifecycleObserver` declared in the Activity, or a second class in the file, used to be taken for the mirror `onStop`: a false orphan, and a quick fix that added a second `unregisterReceiver` ("Receiver not registered" at runtime).
- Generates a lifecycle mirror that behaves: `super.onStop()` first (Activities and Fragments throw without it), the release goes through the acquiring receiver (`manager.removeListener(l)`), a one-line `override fun onStop() { super.onStop() }` receives the call inside its braces instead of after them, and an expression-bodied mirror gets no fix rather than a duplicate method.
- Sees every Room entity. `@Entity(tableName = "x", indices = [Index(value = ["name"])])` and `@Entity(…)` followed by `@Parcelize` were silently skipped, so the database looked clean. `AutoMigration(from = 1, to = 2, spec = …)` no longer reads as a hole in the chain.
- Reads migration coverage per table. `ALTER TABLE pokemon ADD COLUMN updatedAt` served as the baseline of a `Trainer` entity with its own `updatedAt`, which then reported `badges`; a `CREATE TABLE pokemon_new (… nickname …)` migration (the SQLite way to change a column) now counts for the columns it lists. The diagnostic underlines the property, not the `"name"` inside its `@ColumnInfo`, and the provider stays silent past `maxIndexedFiles` instead of inventing holes.
- Draws the Screen Flow edges that start inside a screen. `navController.navigate("detail/42")` in `HomeScreen`'s own file was dropped, so `detail/{id}` showed as an orphan in red; the edge now comes from the screen, and a literal target reaches its declared pattern. `object Home : Screen("home")` resolves `Screen.Home.route`.
- Counts implementations honestly. A private homonym, a companion helper or a nested object's method counted as an implementation of an interface method; with `Handler` in two packages, the implementor of one counted for both. Only direct overrides count, and the parent is matched through the implementor's imports.
- Keeps a raw resource named in a URI. `"android.resource://" + packageName + "/raw/intro_video"` left `intro_video` "never referenced" with a Delete quick fix.

## 1.42.24

Kotlin Jump 1.42.24 fixes the inline actions that could break code: Surround With turned `$name` into `name`, "Remove expired TODO" cut a URL in half, Extract String Resource made a placeholder out of `$100`, and removing an unused Gradle dependency left its `{ exclude(…) }` block behind. The decorations also stop drifting: method separators in a Hilt ViewModel, `!!` and swatches with the feature off, dispatcher hints on comments.

### Fixes
- Keeps the selected code intact in Surround With. The selection went into a snippet unescaped: `"$name $total"` came out as `"name total"` and `Regex("\\d+")` lost its backslash ("Illegal escape").
- Removes exactly the expired TODO comment. The quick fix read the whole file, so the first `//` anywhere above made `"http://x.io" // TODO(2020-01-01)` lose `//x.io"`, a `/* TODO(…) */` was left unclosed, a TODO inside a string got the fix, and one dated today was offered before it was due.
- Extracts a string resource that compiles. `"Price: $100"` became `%1$s` with a `100` argument; a Java literal was read for Kotlin templates; `"Hello ${user.name ?: "anon"}"` was cut at the inner quote; `"$pct% done"` produced a mix of positional and bare `%` that aapt refuses; `"@home"` became a resource reference; a `@Preview(\n…\n)` above the function hid `@Composable` so `Text(R.string.x)` was inserted; a literal in `onClick = { }` got `stringResource` outside a composable; and `val s = R.string.x` put an Int where a String was.
- Removes an unused dependency with its block. `implementation("…") { exclude(…) }` lost only its first line.
- Draws method separators in a class whose header wraps (`class Vm @Inject constructor(\n …\n) : ViewModel() {`, the Hilt shape) and no longer loses them after a `"{"` inside a string.
- Respects the setting and the language on every keystroke for `!!` highlights and hex swatches: typing brought them back with the feature off, painted `!!` in Java, and with two editor columns the wrong editor was repainted.
- Stops the dispatcher hints on `viewLifecycleOwner.lifecycleScope.launch(Dispatchers.IO)`, on a `// TODO: move api.fetch` comment, on a URL string and on `apiKey.length`.
- Folds a constant to its own file's value first. `private val TAG = "Repo"` was folded to another file's `const val TAG = "MainActivity"`, and `Color.RED` (the framework's) to the project's `Palette.RED`.
- Counts state writes on code only (a commented `_count.value = 0` counted), says "readers in this file" instead of a false "0 readers", and gets the plural right.
- Shows KMP expect badges for the targets of the expect's own module: `shared` no longer gets a ✗ for `composeApp`'s desktop and wasmJs.

## 1.42.23

Kotlin Jump 1.42.23 tidies the wiring: commands that answered "not found" when a feature was turned off, toolbar buttons dead during the first index, a sealed class hover that listed one subtype out of four, online docs that opened a 404, and the web build missing four providers the desktop had.

### Fixes
- Keeps every declared command alive when Logcat or Android Run is turned off. `kotlinJump.logcat.enabled: false` removed the eight Logcat commands, so the palette entry and `ctrl+alt+l` showed "command 'kotlinJump.logcat.show' not found" and the Logcat views said "no data provider registered"; `androidRunEnabled: false` did the same to the eight Android commands. They now explain that the feature is disabled and offer to enable it and reload; the Logcat views hide while the feature is off.
- Registers the inline feature toggles before the first index on desktop. On a cold large project the editor title buttons (color folding, const folding, hex swatch, null assertion highlight) and `shift+alt+i` answered "command not found" for the whole indexing time, with the icons showing the features as disabled.
- Lists every subtype in a sealed class hover. `data class Err : Result()` declared after the class, `object Loading` in another file and every implementation of a `sealed interface` were missing: "Subtypes (1)" for a hierarchy of four. The companion object is still not one.
- Reads the KDoc where the declaration actually is. While the declaring file was open with lines added above, the signature followed the declaration but the KDoc came from the indexed line, which was the neighbour's.
- Stops the name fallback from contradicting an explicit import. With `import com.example.util.format` naming a library the index does not hold, hover on `format` showed `fun format` of another package; a word on an import line showed a class of that name.
- Opens the right online documentation page. Dokka publishes a function as `launch.html`, not `launch/`: every function of kotlinx and the stdlib opened a 404 when the online docs fallback was on. A composable call (`Text(`, `Column {`) opens the package summary anchor instead of a type page that does not exist.
- Gives the web build the four providers the desktop had: lifecycle pairing, Room migration drift, resource shadowing and the strings.xml hover; their settings did nothing on vscode.dev. The web now indexes every `values*/*.xml`, not only `strings.xml` and `colors.xml`.
- Hides the internal test and Find Usages commands from the palette ("Debug Test" did nothing, "Run Test" answered "test not found in index: undefined"), activates on Java projects too, applies `statusBarEnabled` without a reload, lets "Copy FQN" work in Java, tells you to open a file when a walkthrough link is clicked with none focused, and describes what Alt+F7 does in the walkthrough.
- Shows the library sources bar as scanning from activation instead of "0 libs" with an "all indexed" tooltip.
- Cleans the hover text: a commented-out line, a `// region` or a `// TODO` above a declaration is no longer its documentation, a multi-line `@Suppress(\n…\n)` no longer hides the KDoc, `@property` renders like `@param`, a `*/` on the last line is dropped, an enum entry shows its own segment instead of the whole `RED, GREEN, BLUE` line, and a `where` clause stays in the signature.

## 1.42.22

Kotlin Jump 1.42.22 fixes the resource layer and the version catalogs. A commented-out `<string>` was a real resource, a library's or an SDK's `R.string` was a red error, a second catalog had every alias reported dead, and a Gradle version written `strictly = "[4.0, 5.0["` made its catalog unreadable.

### Fixes
- Reads `strings.xml` the way aapt does. A commented-out `<!-- <string name="old_title"> -->` was indexed: hover showed it, Go to Definition landed in the comment, and the "cannot resolve" error stayed silent on a key that does not compile. `<string translatable="false" name="app_name">` (name in second position), `<string name="empty"/>` and `<item type="string" name="x">` were invisible instead. Same for `<color>` and `<dimen>`.
- Stops flagging generated and library strings. `R.string.default_web_client_id`, `google_app_id` and the other SDK-owned keys, a `resValue("string", "build_time", …)` from a build script, and a qualified `com.other.lib.R.string.x` were all "Cannot resolve string resource" errors on code that compiles.
- Resolves `R.string.x` to the module of the file that names it. With `error_generic` defined in `app` and `core:ui`, hover and Go to Definition showed whichever module was indexed first; the drawable index already did this right.
- Shows Android escapes decoded in the string hover: `Don\'t panic&#8230; %1$s\nnext` reads as "Don't panic… %1$s" on two lines.
- Keeps two version catalogs apart. `create("libs") { from(files("gradle/libs.versions.toml")) }` next to `create("testLibs") { … }` mapped both files to `libs`, so every alias of the second catalog was "never referenced by any build file", with a Delete quick fix.
- Parses a rich version. `okhttp = { strictly = "[4.0, 5.0[", prefer = "4.12.0" }` (the example in Gradle's own documentation) swallowed the rest of the file: the hover showed `okhttp:okhttp:okhttp` and the dead alias check went silent for that catalog. A multi-line entry now carries its diagnostic on the alias line, not on the closing brace, so its quick fix is offered.
- Reads convention plugins from any included build. `includeBuild("gradle/plugins")` in settings was not one of the two hardcoded names, so the aliases those plugins reference with `findLibrary(…)` were reported dead.
- Scores `app/` as the application in the resource shadowing hover. Only a single-module project at the workspace root was recognized, so the "wins" badge went to the library and the app's own value was struck through.
- Puts the "▶ Run task" lens on module build scripts only. On a precompiled script plugin under `buildSrc/src/main/kotlin` the click ran `:buildSrc:src:main:kotlin:task`.
- Downloads the right sources. A version with a trailing comment (`retrofit = "2.9.0" # keep in sync`), a multi-line catalog entry and an `okhttp_core` alias were skipped by "Download library sources", and `"com.foo:bar:$fooVersion"` was requested from Maven as written.
- Hears a sticky event read back by hand. `getStickyEvent(SessionEvent::class.java)` counts as a subscription, so a `postSticky` consumed that way is no longer "nothing subscribes".

## 1.42.21

Kotlin Jump 1.42.21 repairs the actions that edit code. Two quick fixes left the build broken (a trailing lambda after "Remove unused parameter", a double comma after "Delete unread DTO field"), the sealed `when` branch insertion could not compile in a file that imports its subtypes one by one, and Move File forgot the Java importers and the same-package neighbours. Two detectors also stop calling live code dead.

### Fixes
- Removes the trailing lambda with the parameter it stands for. "Remove unused parameter `onDismiss`" rewrote `showDialog("Yo", onDismiss = { })` and the signature but left `showDialog("Hi") { … }` untouched: "Too many arguments". A lambda outside the parentheses is the last parameter; it goes with it, and a class body after `: Owner(a, b)` is never taken for one.
- Deletes a DTO field without leaving `,,` behind. With ktlint's trailing comma, "Delete unread DTO field avatarUrl" turned `val name: String,\n val avatarUrl: String,\n)` into `val name: String,,`.
- Imports the subtype an inserted `when` branch names. In a file that writes `is B ->` after `import com.demo.S.B`, the click inserted `A -> TODO()` with no import: "Unresolved reference: A". The missing import lines are added with the branch.
- Stops the sealed `when` lens from counting a wrapped condition as missing. `Weather.Sunny\n    -> "a"` showed "2/3 branches, missing: Sunny" and the click inserted a duplicate branch; a `/* legacy */` comment before the arrow hid the branch the same way. Both shapes are read correctly, and a condition the analysis cannot parse now hides the lens instead of miscounting.
- Rewrites Java importers on Move File. `import com.app.data.UserRepository;` and `import static com.app.data.UserRepositoryKt.helper;` kept the old package ("cannot find symbol"); the `;` and `static` forms are recognized, and the Kotlin file facade name moves with the file.
- Adds the imports a move makes necessary. A neighbour in the old package (`class UserViewModel(private val repo: UserRepository)`) and a `import com.app.data.*` importer reached the moved class without an import and stopped compiling in silence; the moved file itself lost its old neighbours the same way. Each gets an `import` line. Open editors with unsaved changes are edited as displayed, not as on disk.
- Keeps an enum that is resolved at runtime out of the dead entries. `enumValueOf<Mode>(s)`, `enumValues<Mode>()`, `enumEntries<Mode>()` and `Mode.class` count as a walk of the whole enum; so does an enum typed on a field of a DTO (Gson and Moshi map it by name with no annotation) or named next to a Room `@TypeConverter`. Deleting such an entry threw at the first payload.
- Stops reporting a request body as "deserialized but never read". `LoginRequest(mail, pwd)` built by the app is serialized, its fields are read by the JSON library. A hand-built response keeps its verdict without the fix, as before.
- Reads the Compose outline through comments and char literals. A `// }` closed the Column and dropped the Footer, a commented-out `Card { }` became a node, and an `'{'` emptied the tree. Named slots (`topBar = { TopAppBar(…) }`, `floatingActionButton = { … }`) now show their content, and `this@Column.AnimatedVisibility(…)` keeps its node.

## 1.42.20

Kotlin Jump 1.42.20 fixes the ranges behind folding, Expand Selection and the Outline, stops generic and constructor arguments from posing as supertypes, and repairs signature help on the shapes every Android project has: a comma inside a string, `emptyMap<String, Int>()`, `private val` constructor parameters, overloads. The index snapshot is rebuilt once after the update.

### Fixes
- Ends a member's folding range at its own closing brace. It ran to the line before the next member, so folding `first()` hid the KDoc and the `@Suppress` of `last()`, and folding the last member of a class hid the class's `}`. Expand Selection from inside the last function of a class selected up to that `}` too, and its Outline entry claimed the same lines. A one-line `val` no longer gets a folding chevron of its own.
- Keeps locals out of the Outline, folding and selection. A `val result = withContext(IO) { … }` inside a function was listed as a child in the Outline and carried a chevron that folded the rest of the function. Locals stay indexed for Go to Definition.
- Records only the type as a supertype. `class ItemAdapter : ListAdapter<Item, ItemViewHolder>(DiffCb)` made ItemAdapter a subtype of `Item`, of `ItemViewHolder` and of `DiffCb` in the type hierarchy, the `⬇ implementations` lens and Go to Implementation; `BaseViewModel<UiState>(Dispatchers.IO)` put a ViewModel among the subtypes of `UiState`, which the sealed `when` coverage then counted. Generic arguments, constructor arguments and `by` delegates are ignored now.
- Reads a supertype list that continues on the next lines. `class LongActivity :\n    AppCompatActivity(),\n    Callback {` (the ktlint layout for a long header) recorded no supertype at all, and `) : Base(),\n    Callback {` after a multi-line constructor kept only `Base`: the subtypes of `Callback` missed them.
- Makes signature help count arguments correctly. A comma inside `"Hello, world"` or inside `emptyMap<String, Int>()` moved the highlight one parameter over; a `)` inside `":)"` dismissed the popup; a `// TODO: see show(` comment above the call brought up show's signature; and a call inside a `"${greet(` template showed nothing.
- Lists the constructor parameters of `class MainViewModel(private val repo: Repo, private val logger: Logger)`. The visibility modifier hid every parameter, and `data class Ok(override val id: Int, val payload: String)` highlighted `payload` for the first argument. Java methods (`String tag, String msg`) get their parameters too.
- Shows every overload. `load(` with `fun load(id: Int)` and `fun load(name: String, force: Boolean)` showed nothing at all (two matches were read as an ambiguity); both signatures are listed now and the active one follows the arguments already typed.
- Puts the `⬇ implementations` lens on an interface member declared after a nested class. `interface Repo { data class Params(…); val name: String; fun load(p: Params) }` had no lens on `name` or `load`, because the nested class was taken for their owner; `val` members count as implementations too.
- Attributes a call in a property initializer or an `init` block to that property or class in the call hierarchy. `val state = flow.map { other() }` and `init { helper() }` were dropped, so `other` showed "No callers".
- Labels an anonymous object in the type hierarchy as "Anonymous object (line N)" instead of `$anon$4`.
- Stops highlighting the inside of a KDoc or of a `"""` block. The `@param name` line and the SQL of a Room `@Query("""…""")` lit up with the parameter's occurrences.

## 1.42.19

Kotlin Jump 1.42.19 is about editing: three renames that broke the build, an Organize Imports that removed the import behind `by remember`, and a handful of smaller wrongs in Find Usages, auto-import and postfix completion.

### Fixes
- Keeps a local rename inside its function. Renaming the `val user` of `load()` scanned to the end of the file, so `show(user: User)`, `Text(user.name)` and even `this.user` (the class property) further down were rewritten and the class stopped compiling. The scan now ends at the function's closing brace and skips `this.x` / `other.x` member accesses.
- Renames a parameter at its call sites and leaves other functions' labels alone. With one argument per line (the ktlint layout every Compose screen uses), `TopAppBar(\n title = { Text(title) },` had its `title =` label renamed to a parameter TopAppBar does not have, while `Screen(title = "x")` in the Preview kept the old name. The label check now looks across lines, and the calls of the renamed function, in the file and in the workspace when the function name is unique, get their `title =` updated.
- Stops Organize Imports from removing `getValue`, `setValue`, `provideDelegate` and operator imports (`plus`, `component1` …). They are resolved by convention, never spelled at the use site, and every Compose file with `var x by remember` lost them and failed with "Property delegate must have a getValue method". The unused import diagnostic already knew this; the action did not.
- Treats `data`, `value`, `field`, `open`, `out`, `expect`, `actual` and the other soft keywords as identifiers in Find Usages and Rename. `val data: T` in a Resource wrapper only matched `?.data`: the declaration and `data == null` stayed behind on rename, F2 on `value` did nothing at all, and `assertEquals(expected, actual)` had no usages. `data class`, `value class`, `actual fun` and `@field:` are still not usages.
- Leaves the bare name alone in a file that imports the renamed class under an alias. `import com.app.model.User as DomainUser` next to a local `class User` had that class and its extension receiver renamed too; only the import line changes now.
- Stops a one-line expression body from claiming the block below it. `fun Int.dp() = this * 2` right above `class Repo {` made the members of Repo look like locals of `dp()`, so renaming `cache` never left the file and the other files stopped compiling; same for a `companion object` after such a function.
- Makes F2 on the first letter of a local `val` behave like F2 in the middle of it. The binding under the cursor was excluded, the rename fell through to the workspace and rewrote a same-named property of another class, or refused with "You cannot rename this element".
- Stops offering "Add import" for a name that is already imported from a library. `import androidx.compose.material3.Text` is not in the index, so Ctrl+. on `Text("hi")` proposed the project's own `Text` and produced a conflicting import. Same for `Button`, `Card`, `Icon`.
- Takes a string literal as one receiver in postfix completion, and escapes it for the snippet. `"Hello $name".let` inserted `$name".let { }` and dropped the `$name`; `"Hello world".val` produced `val value = world`.
- Recognizes Java import lines with their `;`. Organize Imports did nothing on a .java file, and auto-import inserted the new line right under `package`, above the existing block.

## 1.42.18

Kotlin Jump 1.42.18 gives the Java parser the same treatment 1.42.17 gave the Kotlin one, and fixes Go to Definition on a captured local and three semantic colouring errors. A Java field without a modifier (`@Inject AnalyticsAdapter analytics;`, `@Mock UserRepository repository;`, an interface constant) was never indexed, a Room `@Query("SELECT count(*) …")` hid the method after it, and a local read inside a string or a comment was where Go to Definition sent you.

### Fixes
- Indexes Java fields declared without a modifier. Hilt and Dagger forbid `private` on an injected field, Mockito's `@Mock` fields and interface constants have none either: they had no Outline entry, no hover and no usages. Worse, their same-line annotations leaked onto the next method: `@Deprecated String legacy;` struck through the method below it in the Outline, and `@Ignore @Test int bogus;` marked it "test ignored". Locals inside method bodies stay out of the index, as before.
- Accepts a same-line annotation with nested parentheses. `@Query("SELECT count(*) FROM t") int count();`, `@Query("… IN (:ids)") List<T> byIds(…)` and `@Entity(indices = {@Index("a")}) class Nested` were dropped whole. An `@interface Mode` without `public` (the `@IntDef` pattern) was swallowed as an annotation and never indexed.
- Reads Java enum constants in full. `Home` was indexed as `H` and `Settings` as `S`, so hover and Go to Definition on them found nothing; the arguments of `DETAILS(\n Bar.BAZ,\n OTHER_CONST\n)` became constants of their own; `@Deprecated OLD,` marked the next method deprecated; and the constructor after a constant body (`PLUS("+") { … };`) was listed as a constant.
- Keeps the Java brace count right across comments and text blocks. A `/*` left open at the end of a line no longer indexes the commented-out method below it, `int x = 1; /* { */` and a Javadoc `{@code` no longer push the next method one level deeper, and the lines of a `"""` text block (Room SQL) no longer produce phantom methods named after table names. `static { System.loadLibrary("…"); }` is not a method.
- Ignores a local binding that sits inside a string or a comment, in Java and in Kotlin. Cmd+Click on `name` after `"user name = " + name` landed inside the string, `id` in `use(id)` landed in `"WHERE id = ?"`, and a commented `// val repository = Fake()` above `repository.fetch()` captured the click and removed the property's colour.
- Resolves a local captured by an anonymous class. Inside `new View.OnClickListener() { public void onClick(View v) { open(url, title); } }` the `url` parameter and the `title` local of the enclosing method resolved to nothing, or to a same-named symbol elsewhere in the workspace. Same for a Kotlin `object : Listener { override fun onClick() { use(outerVal) } }`.
- Stops taking the continuation of a Java ternary (`? format(value)`) for a method header, which made Go to Definition on `value` there jump to the line itself instead of the parameter.
- Colours a nested `enum class State` as an enum, not as an enum member: its declaration and every `Foo.State` reference took the constant colour, a very common shape in a ViewModel.
- Stops painting semantic colours inside a multi-line `/* … */` block: code commented out that way kept its class and function colours over the comment grammar unless every line started with `*`.
- Places the declaration token of a backtick test name on the name itself. `fun \`returns user when found\`()` had its selection start on the backtick and end one letter early in the Outline, and the word `user` inside the name was coloured as a property.

## 1.42.17

Kotlin Jump 1.42.17 is a parser release. A class, property or enum entry with an annotation on the same line (`@AndroidEntryPoint class`, `@Entity(tableName = "users") data class`, `@Inject lateinit var`, `@SerializedName("a") ACTIVE`) was not indexed at all, so it had no Outline entry, no Go to Definition and no usages. An unnamed `companion object` now appears in the Outline with its members under it. The index snapshot is rebuilt once after the update so the fix reaches files you have not touched.

### Fixes
- Indexes a declaration whose annotation sits on the same line. `@AndroidEntryPoint class MainActivity`, `@Parcelize data class Point`, `@Inject lateinit var api` and constructor parameters like `@field:SerializedName("user_name") val userName` were skipped by the parser: nothing in the Outline, "No definition found", zero usages, and dead-code checks could not see them. `value class` and the `final` modifier are recognized too.
- Shows an unnamed `companion object` in the Outline as `Companion`, with its constants and factories nested under it. They used to hang under whatever member came before, usually a function. The FQN of a member stays `Foo.TAG`, the way it is written and imported, and the entry gets no usage lens and no workspace search hit.
- Indexes enum entries carrying an annotation (`@SerializedName("ACTIVE") ACTIVE`, `@Json(name = "b") INACTIVE(1)`), and puts the column on the entry, not on its copy inside the annotation string. Same for `@JvmName("getFoo") fun getFoo()` and `@SerializedName("Foo") class Foo`, whose Go to Definition landed inside the annotation.
- Indexes an extension property under its own name. `val List<Int>.sum3` was recorded as a property called `List`.
- Stops a `;` line in an enum from turning the next uppercase continuation line into a phantom entry. After `GREEN("#0f0"),` and `;`, a `NAME` on the line following `override fun toString() =` showed up as an enum entry in the Outline and in "Add missing when branches".
- Keeps the brace count right across a block comment in the middle of a line. `class A { /* { */ }` shifted every declaration after it one level deeper, and a `/*` left open at the end of a line hid nothing, so the commented-out code was still indexed.
- Stops indexing a `val` declared inside a lambda passed as a named argument (`foo(onClick = { val x = 1 })`) as a primary-constructor property of the enclosing class.
- Fixes the Outline icon of an enum class that follows another enum: it got the EnumMember icon of that enum's last entry. Visibility is now read from the declaration's own modifiers, so `class Foo @Inject constructor(private val x: Int)` is no longer a private class and in `(private val a, val b)` only `a` is a private field.
- Applies the `hoverEnabled`, `foldingEnabled` and `signatureHelp` settings live. They were read once at activation, so turning one off did nothing until the window was reloaded.
- Stops the Compose accessibility hint "role?" on a `clickable` whose `role =` argument sits on a following line.
- Rejects a reversed day-of-week range in the cron tooltip (`5-1`) instead of explaining it as if it were valid.

## 1.42.16

Kotlin Jump 1.42.16 fixes a regression of 1.42.15 in Java switches, stops the rating prompt from re-arming on every window, renders Javadoc HTML in hovers instead of showing the tags, and corrects the call hierarchy, Expand Selection, the chat participant and the Find Usages panel where they told you something false.

### Fixes
- Resolves a lambda parameter on a classic `case RED:` line again. The 1.42.15 rule for switch arms stopped at `->` but not at `:`, so `case RED: items.forEach(i -> log(i))` lost the binding of `i`: "No definition found", and Rename treated it as a workspace symbol.
- Persists the rating prompt's count and snooze before showing it. A toast left in the bell until the window closed never resolved, so neither the cap of three prompts nor the 30-day snooze applied and the prompt came back on every activation.
- Renders Javadoc HTML in hovers and signature help. Since 1.42.14 the generic escape showed `<p>`, `<code>` and `<ul>` literally on Java methods; the common tags and `{@code}` / `{@link}` now become Markdown, and generics still survive.
- Attributes a call to the function whose body holds it. The call hierarchy took the last function declared above the call, so a property initializer, an `init` block or a class declared after a function were listed as calls from that function; and the declaration line of an overload (`fun load(name: String)`) was listed as a caller of `fun load(id: Int)`. File names in the detail are decoded and the dash no longer hangs without a package.
- Stops Expand Selection at the end of a function. Its range ran to the line before the next declaration, which is that declaration's KDoc and annotations; in Compose every function is annotated.
- Reads "usages of the UserRepository class" and "usages of `Foo`" in the chat participant. The word after "of" was taken as the symbol, and the answer was "Symbol `the` not found".
- Says when the Find Usages panel is stale. Rows keep the line numbers of the search; after an edit above them the labels, excerpts and clicks landed elsewhere with no warning.
- Anchors the qualified-`R` rule at the start of the qualifier. `\bandroid\.` also excluded a module named `com.example.android`, whose own `R` lost folding, hovers and Go to Definition; and Google's `gms` and `firebase` libraries were not excluded, so their `R` was flagged. The rule now excludes `android.R`, `androidx.*.R` and `com.google.android.*` / `com.google.firebase.*` `R`, and nothing else.
- Highlights `$name` and `${name}` in string templates like the declaration they refer to, as Find Usages already did.

## 1.42.15

Kotlin Jump 1.42.15 is the second re-check of recent fixes. It closes the holes the first re-check left: a library component still offered for removal under another label, Remove All Unused Resource Keys still reading the disk, an Rx pairing that missed `?.dispose()`, a KDoc escape that broke the deprecation blockquote, and a qualified-R rule that had gone too far and would have hidden a module's own `R`.

### Fixes
- Leaves a library component alone entirely. The 1.42.14 change stopped calling `androidx.startup.InitializationProvider` "class not found" but then judged it "never referenced" and still offered "Remove … (declared but never referenced)". A class outside the workspace's packages is now simply fine.
- Makes "Remove All Unused Resource Keys" read open editors, the way Remove All Unreferenced Symbols does since 1.42.13. Lines added to `strings.xml` without saving shifted every deletion below them.
- Pairs `disposable?.dispose()` and `d!!.dispose()` with their `subscribe()`, and takes `val d: Disposable = …subscribe(` as an assignment to `d`, not to `Disposable`. The 1.42.14 pairing missed the safe call and reported an orphan again.
- Escapes only generic-looking brackets in KDoc. The 1.42.14 escape also caught the `>` that opens the deprecation blockquote, which showed a literal `\>` in the hover of every `@deprecated` declaration.
- Narrows the qualified-`R` rule to the platform and library classes that are never in the index: `android.R`, `androidx.….R`, Material's `R`. The 1.42.14 rule excluded every qualified `R`, which would have hidden a module's own `com.app.feature.R.string.x` from folding, hovers and Go to Definition; it now applies to those surfaces too (folding, hovers, definition, usage badges, resource index), not only to the diagnostics.
- Shows a disabled "`<serial>` (offline)" placeholder in the Logcat device picker while the host's device is away. The 1.42.13 change stopped switching devices behind the user's back, but a `<select>` displays its first option regardless, which read as streaming from the wrong device and swallowed the click on it.
- Disposes the online-docs content provider with the extension (its active-editor listener survived deactivation), and writes "· companion" on every status bar update of the web extension too.
- Treats `case RED, GREEN -> paint()` as a switch arm, not a lambda binding `GREEN`; the 1.42.13 rule only covered a single label. Keeps a Kotlin char literal `'{'` and a `@file:Suppress("unused(")` or a multi-line `@file:[ … ]` header from breaking the signature read and the import block bounds. A `/* … $name */` block comment on one line is not a template usage. `androidNativeMain` covers the `androidNative*` targets. Renaming a file invalidates the dead-code corpus.

## 1.42.14

Kotlin Jump 1.42.14 corrects what the editor was telling you: an error on `android.R.string.ok`, a "class not found" on a FileProvider from AndroidX with a removal quick fix behind it, a dispatcher lens accusing `viewModelScope` of touching the View, a signature help highlighting the wrong parameter behind a named argument, and a few more. It also removes a small regression of its own: Go to Definition rebuilt the scope index on every call since 1.42.6.

### Fixes
- Stops flagging a qualified `R`. `android.R.string.ok` and a library's `com.x.R.color.y` are outside the workspace's resource index, and the check reported them as errors.
- Stops calling a library component "class not found". `androidx.core.content.FileProvider`, `androidx.startup.InitializationProvider` and Firebase's init provider are not in the workspace sources; the badge said the class was missing, grayed the line and offered to remove it. Only a class in a package the workspace declares can be missing. A `<uses-permission … tools:node="remove">` is no longer badged as an unused declaration either.
- Keeps the dispatcher lens off `viewModelScope` and `viewState`. The View pattern matched any `view…`, so `viewModelScope.launch(Dispatchers.IO) {` flagged its own line. The Main-thread hint now reads "possibly blocking call", since a main-safe suspend call looks the same to a regex.
- Highlights the parameter named at the cursor in signature help. `greetX(greeting = "Yo", name = |` highlighted `greeting`, the second position; and a parameter named `x` was located at the tail of `index: Int` rather than at its own `x: Int`.
- Pairs an Rx `subscribe()` with the `dispose()` of the Disposable it returns. `disposable = observable.subscribe(…)` in `onStart` with `disposable.dispose()` in `onStop` was reported as an orphan on `observable`.
- Lets an `actual` in `nativeMain`, `appleMain` or `iosMain` cover the targets below it in the KMP badges, instead of `[ios ✗] [iosArm64 ✗]` beside `[native ✓]`.
- Stops an expression-body composable from "showing" the strings of the class below it in the reverse string map: `fun Spacer8() = Spacer(…)` took the next class's brace for its own body.
- Keeps `Flow<User>` readable in a hover's KDoc. The angle brackets reached the Markdown renderer as an HTML tag and were dropped, leaving "the Flow stream". A signature such as `val OPEN = "{"` is no longer cut at the brace inside the string, and a `@Composable` already on the fun line is not prefixed a second time.
- Shares one scope index per document across Go to Definition, References and Rename. Since 1.42.6 those built a full index per call, ten times the cost of the old walk on the benchmark; with the per-document cache they run at or below the previous numbers.
- Says "every minute" and "every hour" in the cron tooltip for `*/1`, and drops the "⏱ Debug" lens the `testCodeLens` setting described but never had.

## 1.42.13

Kotlin Jump 1.42.13 re-checks every fix shipped since 1.42.3 against the code and completes the ones that had a hole: a Remove All that still read the disk, a Java import without its semicolon, a header rule that lost the import block behind a multi-line file annotation, a catalog lookup defeated by a space in the path, and a few more.

### Fixes
- Makes "Remove All Unreferenced Symbols" read open editors too. The corpus took its offsets from the editor's unsaved text since 1.42.11, but Remove All still read the disk copy, so a deletion in a file being edited landed lines off. The single-finding fix already read the document; both agree now.
- Ends a Java import with its semicolon. The `@VisibleForTesting` quick fix added the annotation and `import androidx.annotation.VisibleForTesting` without the `;`, which does not compile in Java.
- Keeps the import block behind a multi-line `@file:Suppress(`. The header rule introduced in 1.42.9 stopped at the annotation's argument lines, so Organize Imports did nothing, unused imports were no longer grayed and Add import inserted under `package`, above the block.
- Keys version catalogs by file path instead of percent-encoded URI. A project directory with a space or an accent never matched the build file's path, and the hover fell back to the first catalog read. The same applies to the catalog removed on delete.
- Scans the active editor last when the hex colour swatches rescan a split. The line map is one per provider; left on the other editor, the next keystroke painted that file's swatches into the active one.
- Parses a dirty Java document with the Java parser for the outline. The 1.42.9 live outline used the Kotlin parser for every language, so typing in a `.java` file emptied methods and fields from the outline until the save.
- Stops setting `kotlinJump.vectorPreview.autoOpen` to false from opening the panel. The 1.42.3 change forced an evaluation on any change of the setting, past the auto-open check.
- Brings four 1.42.10 to 1.42.12 fixes to the web extension: the dead-code corpus is invalidated on save, create and delete; the status bar counter follows the watcher; turning a detector off clears its warnings; and the file cap warning shows. On the desktop, turning `kotlinJump.unusedResources` off now clears its warnings too, and "· companion" is written on every status bar update, not only the deferred one.
- Leaves the Logcat device alone while it is briefly offline. The picker still chose the first ready device and asked the host to switch when its own device dropped to offline or unauthorized for a moment, which cut the stream of a running app and emptied the buffer.
- Recognises a Java method header behind an annotation with arguments (`@SuppressWarnings("unchecked") public void foo(Bundle b)`), which the 1.42.10 rule missed, letting Rename on `b` reach the workspace again; and no longer reads `case RED -> paint()` as a lambda binding `RED`.
- Opens the online documentation page when its tab is actually shown, not when VS Code resolves its text for the Cmd+hover preview. Removes a manifest component from the `android:name` line too, the line the badge sits on when Android Studio splits the tag. Keeps soft-wrapped Logcat rows across an append batch (the 1.42.3 renderer was defeated by a full recycle before each render). Counts neither `"\$name"` nor a `// … $name` comment as a template usage in Rename. Emits the "adb not found" event once on the synchronous failure path, like the asynchronous one.

## 1.42.12

Kotlin Jump 1.42.12 looks at the web extension and the indexing pipeline. Companion mode never detected the JetBrains Kotlin extension, the dead-code family published its findings on phantom paths on github.dev, a dozen providers were advertised on the web with nothing behind them, and Re-index silently dropped the bundled stdlib.

### Fixes
- Detects the JetBrains Kotlin extension under its real ids. `companionMode: auto` looked for `JetBrains.kotlin-lsp`, which never existed; the Marketplace id is `JetBrains.kotlin-server` and the GitHub VSIX is `JetBrains.kotlin`. With the JetBrains extension installed, every navigation provider was registered twice: doubled hovers, two groups in the outline, duplicate parameter hints. The status bar now says "· companion" when the mode is on.
- Publishes dead-code findings on the editor's own URIs. The corpus keyed files by `fsPath` and rebuilt `file://` URIs from it, which on vscode.dev and github.dev point nowhere: the Problems panel listed phantom paths, no squiggle appeared and the quick fixes read a file that does not exist. The original URI is kept per path, and the code actions no longer demand the `file` scheme.
- Reloads the bundled stdlib after "Re-index workspace". The command cleared the whole index, stdlib entries included, and only the JAR scan ran again: Cmd+Click on `listOf` or `String` answered "No definition found" until a reload, always on the web. Re-index also re-reads `excludePatterns` and `maxIndexedFiles` instead of the values captured at activation.
- Registers on the web the providers that only the desktop had: unused-import graying and its quick fix, method separators, dispatcher lenses, state provenance lenses, postfix completion, hardcoded-string lint, resource and dependency usage badges, manifest necessity badges, the dead-weight quick fixes, the expired-TODO, `!!` and missing-branch lightbulbs, and Extract string resource. Their settings were shown on vscode.dev with nothing behind them, and the `kmpTargetBadges` toggle now fires on the web too.
- Follows `kotlinJump.excludePatterns` live in the file watchers. The matcher was built once at activation, so a folder added to the exclusions kept feeding the index on every save until a reload.
- Says when the file cap is reached. A 12000 file project indexed 10000 of them without a word, and the tooltip read "in 10000 files" as if that were all. A warning names `kotlinJump.maxIndexedFiles`.
- Keeps the status bar counter current. It was written at activation, Re-index and JAR scans only, so a checkout of 300 files or a deleted file left it stale.
- Adds the `androidx.annotation.VisibleForTesting` import with the annotation the quick fix inserts, and clears a dead-code detector's warnings from Problems the moment its setting is turned off.

## 1.42.11

Kotlin Jump 1.42.11 audits the edits the dead-code family writes. A removal that could climb to the licence header, a catalog fix that broke the next alias, a "Delete file" offered on a file a test still needs, offsets computed on the disk copy of a file you were editing, and a manifest removal that stopped at the first child tag.

### Fixes
- Keeps "Delete unreferenced …" to the declaration, its own doc comment and its own annotations. The extent walked up from any line ending with `*/` to the nearest `/*` in the file, so a `/* warm */` at the end of the line above deleted everything from the licence header down. An annotation line that declares something itself (`@JvmField val analytics`) is no longer absorbed either. The same walk feeds the member, island and "Delete file" fixes.
- Frees a `[versions]` entry only through its last referrer. Two dead aliases sharing a version got separate fixes, the first one deleted the version, and the second was left pointing at nothing, which Gradle refuses at the next sync. The "version entries freed" count follows.
- Offers "Delete X.kt (nothing else in it)" only when every finding in the file is removable. A file holding a test-only symbol next to an unreferenced one was offered for deletion, and Remove All deleted it, breaking the tests.
- Reads the dead-code corpus from open editors when they have unsaved edits. Offsets computed on the disk copy were applied to the document you were typing in, a few characters off, and the deletion left a fragment that did not compile.
- Removes a manifest component as a whole. The removal ended at the first `/>` inside it, so an activity with an intent filter lost its opening lines and kept an orphan `</intent-filter>` and `</activity>`.
- Never mixes a file deletion and a text edit on the same file in one Remove All. VS Code rejected the whole edit without a word when a stale-import removal targeted a file the same edit deleted.
- Says what the Remote Config quick fix does: "Delete unread Remote Config key X here (2 other variants left)" instead of "from all 3 defaults files … (2 other variants left)".
- Keeps the comments inside the import block through Organize Imports. A `// ktlint-disable` between two imports vanished; it now stays where it stands, and the imports on each side of it are sorted separately.
- Moves a trailing line comment after the chain in Smart Join. `val x = listOf(1) // ints` joined with `.map { … }` used to turn the chain into comment text.
- Runs the unreferenced-symbol scan once in "Find Everything Unused" instead of twice.

## 1.42.10

Kotlin Jump 1.42.10 closes the fifth audit: a dead-code corpus that a cancelled scan could poison, Java parameters that Rename treated as workspace symbols, an Android Run button that could pin a non-existent Gradle task forever, and a Logcat banner whose trigger could never fire.

### Fixes
- Never caches a dead-code corpus cut short by Cancel. The files skipped after the click left no trace, the partial corpus was served for a minute, and "Remove All Unreferenced Symbols" could delete code those unread files use. Saving a Kotlin, Java, XML, Gradle or TOML file now invalidates the corpus too, so a fixed finding does not linger at its old line.
- Resolves Java parameters, locals and lambda parameters as locals. The scope index only knew Kotlin's `fun`, so in a Java method Cmd+Click on `name` jumped to a Kotlin property elsewhere and F2 on a parameter renamed every `name` the workspace could reach.
- Stops Android Run from caching a fallback `install<Variant>` task when discovery timed out. A cold Gradle daemon over 30 s counted as "no install tasks", the fallback was pinned in workspace state, and every later Run failed with "Task 'installDebug' not found" until a manual reset. A timeout now tries the fallback once, uncached.
- Restores the Run button's command once the Gradle project resolves. After a "Pick Gradle Project" or an invalid setting, the label read Run but a click still opened the picker or the settings page. The persisted project choice is honoured by Run itself, not only by the diagnostic. Escape in the variant picker no longer leaves the button on "Detecting tasks…".
- Launches the app with the resolved adb binary. The build used the configured path, the launch step typed a bare `adb` into the terminal, and a PATH without platform-tools ended in "adb: command not found" after a successful build.
- Shows the Logcat "adb binary not found" banner when adb really is missing. Node does not throw when spawning a missing binary, it reports the error a tick later, so the banner's only trigger never fired and the watcher retried every 3 seconds instead of polling.
- Fetches AndroidX, Android Gradle plugin and Google library sources from Google's Maven instead of failing three times each on Maven Central. The download progress counts each coordinate once instead of reaching 100% halfway, and failures are reported in a message rather than in a status that the next refresh erased.
- Reads the library sources bar right: "7/10 libs missing" when 7 are missing, "stdlib ✓" only when the bundled stdlib loaded, and the bar hides or shows as soon as `kotlinJump.indexSourcesJars` changes.
- Fixes texts: "No unreferenced top-level symbols, 3 used only from tests" instead of "0 unreferenced top-level symbols ()", singular forms for one symbol, key, declaration or file, the file rename label for a Java file, and a warning when "Remove All Unread Remote Config Keys" gives up on a truncated corpus.

## 1.42.9

Kotlin Jump 1.42.9 fixes edits that destroyed code. Organize Imports could replace a class body, Remove unused function could delete everything up to the file header, Rename rewrote imports of unrelated symbols, and a quick fix that was supposed to add a release() call had never appeared at all.

### Fixes
- Bounds the import block to the file header. The block used to run from the first `import` line to the last one anywhere in the file, so an `import` inside a raw string or a KDoc sample became its end, and Organize Imports replaced the class body in between with the sorted imports. Add import and the unused-import check used the same bound.
- Keeps "Remove unused function/property" to the declaration and its own doc comment. A `/* px */` at the end of the line above satisfied the "ends with `*/`" test, the walk climbed to the nearest `/*` in the file, and the removal started there.
- Renames only the import of the renamed symbol. Any import line containing the word qualified: renaming `State` rewrote `import androidx.compose.runtime.State`, and renaming a property `repository` rewrote `import com.app.repository.UserRepo`. The imported name has to be the word, and the path has to be the symbol's own.
- Renames `$name` and `${name}` in string templates for members and constructor properties. The workspace scan skipped them as string content, so `"Hello $name"` kept the old name after the rename. Find References had the same hole.
- Offers no cross-file "Remove unused parameter" edit when the owner's name is declared elsewhere too. Only the homonym's own file was skipped; the callers of the other declaration were edited. The count of ambiguous sites is still reported. Open editors' unsaved text is used over the disk copy, so the edit lands on the right line.
- Reads the outline and breadcrumbs from the live document while it is dirty. The index follows the file on disk, so after inserting lines an outline click landed above its target, and deleting the last lines emptied the outline with a range error.
- Makes the "Add release() in onStop()" quick fix appear, and land inside the class. It looked up the pairing table by the lifecycle method name instead of the acquiring call, so it never showed; and its indentation arithmetic assumed four spaces, which put the new function outside the class with tabs. The enclosing function's own indentation is used now, tabs included.
- Resolves "Add names to call arguments" through the file's imports. With two functions of the same name and arity in different packages, the first one indexed won and produced parameter names the compiler refused.

## 1.42.8

Kotlin Jump 1.42.8 finishes the third display audit's list: a test run you could not stop, test source sets the explorer never looked at, a backtick test name reported as skipped, the wrong module's icon in a multi-module project, and a string extraction that mangled raw strings.

### Fixes
- Lets Stop end a run started from the ▶ Run lens. That path handed the runner a cancellation token nobody ever cancelled, so the Test Explorer's Stop button did nothing until Gradle finished on its own.
- Discovers tests under `androidUnitTest/`, `sharedTest/` and the KMP target source sets (`iosTest/`, `jsTest/`, `nativeTest/`, `desktopTest/`). Their classes had a ▶ lens, and clicking it said "test not found in index".
- Matches a backtick test name ending with a parenthesis to its result. `returns 404 (not found)()` in the JUnit report was cut to `returns 404`, which matched nothing, and the test showed as skipped. Only an empty or type-list parameter group is stripped now.
- Shows the referencing module's drawable when two modules declare the same name. The first module indexed won in the hover and the gutter.
- Extracts a single-line raw string as a whole. `Text("""Hello""")` was seen as three literals and only the middle one was replaced, leaving `""stringResource(…)""` behind. An escaped `\# Changelog

 is now a literal dollar instead of a template with a bogus argument.
- Clears only the gutter icons an editor actually showed, and releases the decoration types no visible editor uses. Every flush, 32 ms after a keystroke, called setDecorations once per type minted in the session, per editor.

## 1.42.7

Kotlin Jump 1.42.7 closes the list left by the third display audit: multi-root workspaces that ran tests against the wrong Gradle build and read the wrong version catalog, a Find Usages panel that disagreed with its own lens, a Recent Locations picker that opened a hundred files before showing up, and a few settings and pills that did not do what they said.

### Fixes
- Runs each test against the Gradle project its file belongs to. The root came from the active editor, so with two Gradle projects in the workspace a class run from the Test Explorer while another project's file had focus went to the wrong build: "No tests found for given includes" and every test errored.
- Keeps one version catalog per project. A single in-memory catalog meant the last `libs.versions.toml` read won, so a hover in project A showed project B's versions, and deleting any toml emptied every hover. The build file's own project now answers.
- Applies `kotlinJump.excludeFromReferences` in the Find Usages panel. The lens said "3 usages" and the panel opened with "5 usages", listing the excluded files.
- Shows Recent Locations without opening its files. The picker opened up to a hundred documents one by one for their excerpts, each open waking every scanner listening for opened documents. Open editors lend their text, the rest is read as bytes, sixteen at a time. File names are decoded too: `Caf%C3%A9.kt` reads `Café.kt`.
- Puts a permission pill on a `<uses-permission>` split over several lines, the way Android Studio writes it as soon as the tag carries `android:maxSdkVersion` or a `tools:` attribute. The line scan never saw those.
- Makes `kotlinJump.semanticHighlighting` take effect without Reload Window. The provider was only registered when the setting was on at activation.
- Removes classes and methods that a checkout deleted or renamed from the Test Explorer. The discovery pass that follows a change of nine files or more only ever added, so the old names stayed as ghosts.
- Stops reporting `@Ignore` and `@Embedded` fields as missing a Room migration. Neither is a column of its own.

## 1.42.6

Kotlin Jump 1.42.6 fixes the slowest thing in the extension and seven display defects around it. On a 5000 line file outside any function, a Koin module or a design system object, every keystroke walked backwards through the file once per coloured token: 13.9 seconds of frozen extension host, measured. It is one pass now.

### Fixes
- Replaces the per-token backward scope walk with one index per document. Semantic highlighting asked "is this word a local?" for every reference token, and each answer scanned upwards to the enclosing function, or through 5000 lines when there was none. Measured on a 5000 line `object`: 13.9 s per keystroke before, under 0.5 s for the same 5000 queries after, with the 27 existing scope tests unchanged. Inlay hints share the index.
- Leaves tests unmarked when a run is stopped. Stop killed Gradle, nothing was parsed, and every test in the run turned red with "Gradle exited with code 1".
- Re-checks `R.string` and `R.color` references while typing, 300 ms after the last edit, and clears them when `kotlinJump.resourceDiagnostics` is turned off. A fixed key stayed red with the old name until the next save, and the setting left every error in Problems until each file was reopened.
- Stops marking `items.first()`, `.count()`, `.single()`, `.last()` and `.toList()` with ⚡ on ordinary collections. With the coroutines sources indexed, each name also has a suspend Flow overload and any homonym was enough. When a name resolves to both, only an explicit import of a suspend candidate earns the marker.
- Shows `R.mipmap.ic_launcher` in the hover and the gutter. The adaptive-icon XML won over the density rasters and rendered to nothing; when the XML is not a vector, the default density raster beside it is used.
- Lists only locales in the string hover grid. `values-night`, `values-v23`, `values-sw600dp` and `values-land` appeared with a ✗, as if a translation were missing, and so did a `values-fr` holding only dimensions.
- Refreshes lenses, colours and counts when a file is deleted. Removing a sealed subtype's file kept its "missing branch" lens, its colour in open editors and its place in every usage count until the next save of any Kotlin file.
- Keeps Room warnings on screen while a save re-reads the workspace, reads the files sixteen at a time instead of one by one, and computes ranges from the open editor's text so an unsaved entity is underlined on the right line.

## 1.42.5

Kotlin Jump 1.42.5 is the third pass of the display sweep, this time on what the editor shows inline: two caches that outlived the files they described, a hover reading the wrong annotation, a swatch that stopped following the cursor, a history that sorted every jump destination last, and two settings whose toggle did nothing.

### Fixes
- Refreshes parameter name and inferred type hints when a declaration changes. Both caches were keyed by symbol and lived for the whole session, so after renaming a parameter or changing a return type and saving, every call site kept showing the old `name:` and `: OldType` until a settings toggle or a reload. The file watcher now evicts the symbols of the changed file and every cached signature pointing into it.
- Refreshes the "N usages" lens of a symbol declared in another file. Adding a call to `foo()` in B and saving left A reading "1 usage": the eviction only dropped the symbols declared in B. It now also drops the counts whose results reached into B and those whose name appears in B's new text, still one file at a time rather than a wholesale clear.
- Reads the `@Deprecated` annotation glued to the hovered symbol. Two deprecated declarations within eight lines of each other put both annotations in the window, and the hover showed the upper one's message and ReplaceWith on the lower symbol.
- Keeps the hex colour swatch following the active editor in a split. Re-scanning all visible editors left the tracked editor on the last one, so typing in the active one no longer moved the swatch until the next editor switch.
- Sorts jump destinations correctly in Recent Locations. The entry refined after a file switch lost its timestamp, so every destination sorted last with time zero, behind positions from long before.
- Makes the `kotlinJump.gradleTaskLens` and `kotlinJump.kmpTargetBadges` toggles take effect immediately. Neither provider raised a change event, so the lenses and badges stayed, or stayed away, until the next edit of the file.
- Reads a signature from the right line of an unsaved file. The index only moves on save, so after inserting lines at the top of a file the hover showed the KDoc or the previous declaration as the signature. The declaration is now located by name around the indexed line.
- Stops the `R.string` hover from re-reading the workspace twice and parsing files that cannot match. Two hovers inside the load window each started a full read of up to 4000 files; every file then went through function and class span extraction even without the key. One load is shared, files without the key are skipped, the hover honours cancellation, and open editors' unsaved text is used over the disk snapshot.
- Gives each inlay hint pass its own call regex. A shared global one had its position clobbered by a concurrent pass in a second editor, which duplicated or dropped hints on first paint.

## 1.42.4

Kotlin Jump 1.42.4 finishes the display sweep started in 1.42.3 with the four items that audit left open: a vector preview that could not be read on a light theme, theme colours that rendered black, a decoration leak in the inline drawable icon, and an Android project view that duplicated every module and never noticed a new file.

### Fixes
- Draws the vector preview's checkerboard over the editor background instead of two hard coded dark greys. On a light theme a black icon, which is what an unresolved theme colour falls back to, was invisible on it.
- Converts `?attr/…`, `@color/…` and `@android:color/…` colours to `currentColor` instead of passing them through as an invalid paint, which meant a black fill and no stroke. The preview panel sets that colour to the editor foreground, so a themed icon reads on both themes.
- Releases the gutter icon's decoration types. Every distinct SVG minted its own type and its own cache file and none was ever disposed, so typing in a vector file grew both for the whole session and every refresh re-applied the whole pile. Only the SVGs a visible editor shows are kept.
- Stops the Android project view from listing an "app (root)" module above the declared ones. Its globs ran under the whole workspace, so each module's manifests and res folders appeared twice. A multi module project now shows its modules plus one Gradle Scripts node; a project with no include() keeps the root as its single module.
- Refreshes the Android project view when a Kotlin, Java, XML or image file is created or deleted. It used to wait for the next settings.gradle or manifest change. One refresh per burst, paths under build/ ignored, and nothing runs while the view is hidden.

## 1.42.3

Kotlin Jump 1.42.3 is a sweep of the parts users look at rather than the parts that scan code: settings that were declared and never read, a banner that never showed, a Logcat panel that lost its filter on Clear and opened empty after a Run, vector icons that rendered as nothing, and five commands that vscode.dev advertised but could not run.

### Fixes
- Reads `kotlinJump.logcat.followAppPid` and `kotlinJump.logcat.colorScheme`. Both were in the settings UI and neither was ever consulted: the panel always opened following the app PID with the studio colours, and the monochrome and high contrast schemes had no CSS behind them. They now apply when the panel opens and live when they change, and the host filter is kept in step with the checkbox, so an unchecked box no longer hides rows from other processes.
- Shows the "adb binary not found" banner in the Logcat panel. The device watcher raised the event, nothing listened to it, and the webview handler for it was dead code. The banner also has to be replayed after the webview's ready handshake, since the watcher starts before it, and it clears on its own when adb turns up again.
- Addresses filtered Logcat rows by position instead of sequence number. The host only forwards rows that pass the follow PID filter, so the mirror's ring has holes in its numbering, and a search or level filter could put the wrong line under the cursor.
- Fills the Logcat panel with what was already captured when it opens. After a Run, the stream auto-starts before the panel exists and every batch was dropped for lack of a visible view, so a panel opened a few seconds later showed only new rows while its counter read thousands; hiding and re-showing the tab was the only way to get the history. The buffer is now replayed on the first open, and again after Resume and when Follow app PID is turned off, since rows held back by the filter were counted and exported but never shown.
- Keeps the Logcat filter across Clear and a device switch. Both emptied the mirror and silently dropped the filter flag while the level chips and the tag field still showed it, so every new row came through unfiltered until the next edit.
- Keeps the device picker, the Devices tree and the host on the same device. Opening the panel with two devices connected picked the first one in the list and switched the stream away from the phone a Run had just targeted; picking in the tree left the dropdown on the old device and picking in the dropdown left the tree's marker on the old one. The host's current device and package are now the single source and every surface follows them.
- Makes the pause button and the status pill follow Pause and Stop from the command palette and the status bar. The button kept its last local state, so it took two clicks to resume, and Stop still read "streaming".
- Removes ghost rows in soft wrap mode. Rows recycled after a filter, a Clear or a wrap toggle were parked off screen with a transform the soft wrap rule overrode, so they stayed in the flow above the real results. The soft wrap renderer also redrew all of its 2000 rows on every batch and every scroll frame; it now keeps the rows that did not move.
- Renders vector drawables written with Android's alpha first colours. `#FF000000`, the fill every icon out of Vector Asset Studio carries, was passed to the browser as CSS `#RRGGBBAA`, meaning red at alpha zero: an empty checkerboard in the preview panel, the hover and the gutter. 8 and 4 digit colours are now split into colour and opacity, and the opacity multiplies with `fillAlpha`.
- Previews a vector whose path colour is a resource reference. A self closing `<path>` with `android:fillColor="@color/primary"` or `?attr/colorControlNormal` never matched the path pattern, which refused a slash inside the tag, so the drawable converted to nothing and had no preview at all.
- Stops the Compose Outline from rebuilding on every cursor move. Each keystroke reparsed the whole file and replaced the tree with new nodes, which also reset every node the user had expanded; the tree is now kept while the cursor stays in the same composable, and nodes carry stable ids so the expansion survives a refresh.
- Makes only a ready device clickable in the Logcat devices tree. Switching to an offline or unauthorized device tore down the live stream and emptied the buffer for nothing; those now show their state in a tooltip instead.
- Registers Recent Locations, Surround With, Smart Join Lines, Screen Flow Map and Compose Outline in the web extension. They were contributed with no web gate but only the desktop entry point registered them, so on vscode.dev their shortcuts failed with "command not found" and the Compose Outline view was an empty panel.
- Empties the Compose Outline when the active editor is not a Kotlin file, or the feature is turned off. The tree of the previous file stayed on screen after switching to a repository class, a JSON file or the terminal.
- Lets the Screen Flow Map navigate to routes added since it was first opened. Reopening it redrew them, but the click handler still read the navigation graph from the first render.
- Brings the vector preview back when `kotlinJump.vectorPreview` is edited after a dismissal. Re-enabling auto open did nothing for the rest of the session.
- Clears the inline drawable icon when an edit turns a vector into another drawable type. The old code returned early on a file with no `<vector>` tag and left the previous icon in the gutter.
- Shows the Android project view without a window reload once the first `AndroidManifest.xml` appears, and hides it again if the last one goes. The check ran once at activation.
- Hides the Android project view and the Android Run and JAR sources walkthrough steps in the web extension, where Gradle and adb cannot run, and scopes the Toggle All Inline Features shortcut to Kotlin and Java files so it stops intercepting Shift+Alt+I elsewhere.

### Improvements
- Implements `kotlinJump.fallbackToOnlineDocs`, which was declared and did nothing. With it on, Go to Definition on a symbol with no local source opens its reference page in the browser: kotlinlang.org for `kotlin.*` and `kotlinx.*`, docs.oracle.com for the JDK, developer.android.com for `android.*` and `androidx.*`. The symbol must be pinned down by an explicit import, or by the file's only wildcard import; a name that could belong to two wildcards opens nothing rather than a 404. Off by default since it opens external tabs.

## 1.42.2

Three false positives found by running the dead-code checks against real Android and Kotlin projects instead of trusting them. The first one gave advice that stops a module from compiling.

### Fixes
- Stops reporting imports that Kotlin resolves by convention. `import androidx.compose.runtime.getValue` is required by `var state by remember { … }`, and the word `getValue` appears nowhere in the file, so the import scan called it unused. Removing it on that advice fails the build with "Property delegate must have a `getValue(…)` method", verified with a real Gradle compile. The same held for `componentN` from destructuring, `div` from `basePath / "sub"`, `set` from `x[i]` and every other operator convention. On one 4100 file project the import check reported 222 findings, of which 206 were this defect; the vendored kotlin-lsp corpus carried 7 more. The name list already existed and already guarded declarations, it had simply never been applied to imports.
- Makes Find Dead Islands agree with the member scan about Java accessors. Kotlin reads a Java `getBar()` as `bar`, so a call site can never spell the method name; the member scan has known that since 1.42.1, the island scan did not, and reported live code as dead. On the same project it reported 12 accessors, 6 of them referenced from production Kotlin, and one dragged a live class into an island with it.
- Counts `f.isBar = true` as a write to a Java `setBar()`. A Java `isX()`/`setX()` pair becomes one Kotlin property named `isX`, so the setter is never written `f.x = v`, and it was reported as unreferenced.

### Notes
- `scan-dead-islands.ts` gains `--name=<substring>`, which prints why each matching candidate is alive with the file and line that keeps it so. The outcome histogram collapsed `alive:root(path:line)` to `alive:root`, hiding exactly what an audit needs.

## 1.42.1

Two defects found by auditing the dead-code family against its own promise. One turned detectors off without saying so, the other invented a declaration that does not exist and then took a live class down with it. Both were reproduced on a real repository before being fixed, and the fix was measured against that repository afterwards.

### Fixes
- Reads `@file:Suppress` in the file header only. It used to be matched anywhere in the raw text, so quoting the annotation in a KDoc, a string or a commented-out TODO silenced every dead-code check for that file, with nothing logged and nothing reported. Nested block comments, which Kotlin allows, count as comments now, and `packageName` no longer passes for the start of the body.
- Honours the two spellings that were being ignored: `@file:[JvmName("X") Suppress("unused")]` and `@file:kotlin.Suppress("unused")`. A file its author had marked kept being reported.
- Stops reporting anonymous objects as dead declarations. The parser names `object : Base { }` `$anon$<line>` so it can count anonymous implementors; at file scope that synthetic name reached the unreferenced-symbol scan, where no word in any file can match it, so it passed every guard. On the kotlin-lsp repository it produced one phantom finding, and in Find Dead Islands it dragged `LSJavaHoverProvider`, a live class, into a dead island with it.

### Notes
- The five per-file detectors (unused imports, parameters, private declarations, locals, write-only variables) now live in modules that do not import `vscode`, so they can run outside the editor. The behaviour is unchanged: on 659 files, all 279 findings and the edits of every quick fix are byte for byte what they were.
- Adds `scripts/scan-dead-code-sweep.ts`, which runs those five over a whole project from the command line. They had never been measured on a corpus, and they now can be.

## 1.42.0

Kotlin Jump 1.42.0 closes the two biggest gaps left in dead-code detection: class members nothing references, and code kept alive only by other dead code. Two functions calling each other with no outside caller both look referenced, so both survive every per-symbol scan. Along the way this is the first release that reads the build rather than the code, and the version catalog parser that reading needed gets repaired.

### Improvements
- Adds "Kotlin Jump: Find Unreferenced Members", covering `public`, `internal` and `protected` class members, the largest tier of dead code left. A comparable tool reports 506 members here with a measured 57% false-positive rate; this scan reports 92 on the same project, each hand-verified, by counting any mention of the name anywhere as a use, XML and string literals included. Colliding member names silence each other instead of producing wrong reports.
- Judges membership by structure rather than by brace depth: a local in a function body, a member of an `object :` literal and a `val` inside `init { }` are never candidates, while companion members are, even though the parser emits no symbol for the companion itself.
- Adds a third verdict, **could be private**, for members referenced only from inside their own class. Its one-keyword fix is fully re-checked by the compiler, and once applied the file-local checks track the member in real time.
- Treats Java conservatively: `@Override` being optional, a Java class with any supertype at all keeps its members out of scope, and only supertype-free classes are examined, which is where the real dead utilities hide.
- Never reports a member of a class the unreferenced-symbol scan already reports whole: one finding per root cause.
- Adds "Kotlin Jump: Find Unread DTO Fields", covering fields of deserialized models that nothing reads: data the app pays to parse and then drops. This deliberately reopens the population the member check excludes, under stricter conditions: only visible wire contracts, never a class the corpus might destructure, and never a generated model. Measured on a 6410 file project: 36 fields across 7 classes, 33 of them in one hand-maintained configuration model, each verified by hand.
- Adds "Kotlin Jump: Find Write-Only Keys": Intent extras nothing gets back, preference keys nothing reloads, permissions nothing exercises. Bugs more than dead weight, and honest about limits: a read whose key cannot be resolved makes its category unprovable, and the scan reports that instead of guessing. On the same project it found a game id silently lost between two screens and a boot permission whose receiver was removed years ago.
- Completes the event-bus check with its second direction: subscriptions nothing ever posts to. A starved `@Subscribe` handler is code waiting for an event that will never come. The burden of proof flips here, so every post's delivered type must be BOUNDED to workspace types: constructors, static factories, factory and builder return types, `when` arms, smart casts and function-typed parameters all resolve, and a post that stays unbounded blocks the proof visibly instead of silently, with an inline marker to hand the claim back to you. Measured on a 6410 file project: 8 starved subscriptions, every one confirmed by hand, out of 25 a comparable tool reports with its known false positives.
- Extends the private-member check and the dead-code sweep to Java. A private Java member no word of its own file names was covered by nothing before, and since Java's `private` is visible to its compilation unit alone, the file-local proof is complete. A private constructor is never reported (its name is the class's own), `native` methods and annotated fields are left alone, and the other four sweep detectors stay Kotlin-only rather than trade correctness for coverage.
- Adds "Kotlin Jump: Find Unreferenced Catalog Aliases", which reports version catalog entries no build file ever names. A type-safe accessor, a lookup by name or membership of a live bundle all count as a reference, and `buildSrc` and `build-logic` are read even though nothing is reported inside them, since a convention plugin is often the only place naming an alias. When an alias dies and its version entry serves nothing else, both go in one previewable change. Measured on a 6410 file project: 5 aliases and 2 version entries, in 0.4 seconds.
- Stops at the catalog on purpose. Reporting a dependency a module declares without importing cannot be made safe from text alone: a coordinate does not say which packages it brings. Measured on the same project, one library declared in 29 modules is imported in 2, the other 27 reaching it through a transitive, and acting on that report would remove it from their compile classpath.
- Adds "Kotlin Jump: Find Dead Islands", which reports groups of declarations that reference only each other and are referenced by nothing else: the mutual pair, the chain behind a dead entry point, the interface plus its only implementation that no one constructs. Every whole-word mention that cannot be placed inside an island's own declarations is a root and keeps it alive. XML, ProGuard rules, string literals, manifests and generated-code naming conventions (`DaggerX` reaches `X`) all count, so every approximation error makes code live, never dead. Measured on a 6410 file project: 22 islands, 52 declarations, 29 of them invisible to per-symbol counting, in 11 seconds.
- Validates that claim the hard way before shipping it: every island hand-verified against the whole corpus, cross-checked against the R8 shrinker's own dead list where the module is in its scope, and every deletable one actually deleted on a branch of the real project with the app builds and unit test suites green. A comparable tool's reachability covers this terrain with a measured 57% false-positive rate; this one shipped its audit instead.
- Turns both false positives the audit caught into guards with named regression tests: a duplicated `@Component` interface whose annotation hid behind the duplicate-name guard, and an ALL_CAPS companion property reached from Java through its verbatim accessor (`getIGNORED_CHILD_CLASSES`), which the usual `getFoo` to `foo` mapping can never see.
- Deletes an island atomically or not at all: one reviewed change through the Refactor Preview covering every member and every import that would dangle, with outer declarations winning over their nested ones. An island still referenced from tests is reported but never auto-deleted, since removing tests is a human call, and an island with one undeletable member keeps its verdict and loses its fix.
- States its false negatives instead of hiding them: bodyless interface methods, private-only chains and resource files are named, accepted populations with their reasons, not silent gaps.

### Fixes
- Fixes the member scan's `external` guard matching the word anywhere on the declaration line: a Java parameter named `external` was enough to shield its method from the scan.
- Fixes the version catalog reader ignoring `module = "group:artifact"`, the form most catalogs are written in. On a catalog using it throughout, all 164 libraries were invisible and the catalog hover was silently blank. It now also reads `[plugins]`, `[bundles]`, multi-line inline tables, and stops at a comment rather than reading through it.
- Fixes catalog accessors resolving by prefix rather than by segment. Where `foo` and `foo-bar` both existed, `libs.foo.bar` was treated as a reference to both.

## 1.41.0

Kotlin Jump 1.41.0 makes every navigation feature see Java code that uses Kotlin, stops Rename from breaking those files, and reports unreferenced Java classes alongside Kotlin ones. It also corrects what the unreferenced symbol scan does with duplicated names, imported nested types and `@Suppress`: on a 6410 file project that dropped 7 findings which would have broken the build and added 26 real ones.

### Improvements
- Adds "Kotlin Jump: Find Unread Remote Config Keys", which reports keys sitting in a Remote Config defaults file that no line of the project reads. A default only matters when the client asks for that key, so this needs no network call and no credential to be certain. Measured on a 6410 file project: 29 keys across 98 declarations, in 3.6 seconds, matching another tool's result exactly.
- Recognises the defaults file by its shape rather than its name, since it is passed to `setDefaultsAsync` under any name, and reports a key once even when every build variant declares its own copy.
- Adds "Kotlin Jump: Find Unused Enum Entries", which reports enum entries nothing in the project ever names. An enum collects dead variants faster than anything else, because removing the last use of one still compiles and nothing in the build complains. Measured on a 6410 file project: 40 entries across 21 enums, in 2.2 seconds.
- Applies those guards to the whole enum rather than one entry at a time. `values()`, `entries`, `valueOf(...)`, a `::class` reference or any annotation outside a short benign list make every variant reachable without naming one, so the enum is skipped entirely. Judging entries one by one would report the variant that happens not to appear while its siblings do, which is the worst kind of wrong: it looks right.
- Adds "Kotlin Jump: Find Unheard Events", which reports events posted on an event bus that nothing subscribes to. Unlike every other check here it reports a missing behaviour rather than dead weight: someone wrote the trigger and the receiver went away. Measured on a 5225 file project: 22 posts of 12 event types, every one confirmed by hand, in 1.3 seconds.
- Learns what the bus is from `register` call sites instead of hardcoding a library, so Otto, greenrobot EventBus and a house-built bus all work, and `handler.post(...)`, `postDelayed(...)` and `view.post { }` never count as posting an event.
- Understands that a subscription on a supertype hears its subtypes, which is how a bus dispatches, including through Java interfaces and Kotlin sealed hierarchies. A container object holding unrelated nested classes is not a hierarchy, and is not treated as one.
- Reports nothing at all when a single subscription cannot be read, and flags that subscription instead. An event is only unheard when every subscription is accounted for, so a silent zero would claim something that was never established.
- Offers both fixes side by side: remove the post, or write the missing `@Subscribe` handler back. The handler name and the annotation import are learned from the project rather than assumed.
- Reports Java classes, interfaces and enums that nothing in the project references, in the same scan as the Kotlin ones. On a project with 1731 Java files it found 18 more, every one confirmed by hand, with no Kotlin finding lost.
- Never reports a Java file holding an entry point the project never names by hand: a `main` method, a `native` method bound to a C symbol, or a JUnit test method.
- Reads a class header that wraps `extends` or `implements` onto the next line, which Java does and Kotlin does not.
- Reports a name declared in two places when nothing in the project mentions it anywhere else. Two files declaring `foo` used to silence each other, because a `foo` token elsewhere could mean either one. When there is no such token, there is nothing to attribute: neither is referenced, and both are now reported.

### Fixes
- Fixes Find Usages, Find References, Call Hierarchy and the usage counter missing every Java file that uses a Kotlin symbol. The Java parser never reported the file's imports, so those files were skipped before being searched. On a project with 1731 Java files, a class imported by 58 of them returned none of them.
- Fixes Rename corrupting Java files. It rewrote their import lines while leaving every use in the body pointing at the old name, because the two halves of the rename disagreed about which files to touch. Renaming a Kotlin class used from Java now updates both, or neither.
- Fixes Rename not offering to rename `Foo.java` alongside the class it declares, which already worked for `Foo.kt`.
- Fixes the unused parameter fix ignoring Java call sites. It could remove a parameter that a `new Owner(a, b)` still passed. It now reads Java files, and refuses to touch a file where the call is hidden behind a constructor reference, a subclass calling `super(…)`, or a same-named type.
- Fixes the same fix silently scanning only the first 2000 files of a project. Missing a call site breaks the build, so a scan that cannot see everything now offers nothing at all.
- Recognises Java's static imports and nested-class imports, both of which name a type without spelling it in the last segment.
- Refreshes the Test Explorer when a Java test file changes, and links stack frames from Java test failures.
- Never reports anything inside a file whose header says a generator wrote it. The next build rewrites the file, so acting on a finding there is wasted, and generator conventions (one variant per schema value, `@SerializedName` on each) read as dead code to a textual scan. On the project measured above, 165 files carry such a header.
- Fixes live sealed classes being reported as unreferenced. `import p.Outer.Nested` names `Outer`, and a file importing a variant that way breaks if the parent goes away, even though its body only ever writes the variant's name. Seven types on the project measured above were reported this way.
- Fixes `@Suppress` being read as a framework annotation, which made any declaration carrying one unreachable-proof. It addresses the compiler, never a framework. `@Suppress("unused")` and `@SuppressWarnings("unused")` remain an explicit opt-out.
- Fixes `@file:Suppress("UNUSED_PARAMETER")` silencing the unreferenced symbol, unused declaration and write-only variable checks across the whole file. Those are different diagnostics, and matching them on a shared prefix conflated them.
- Fixes import lines being counted as a use of the declaring file's own symbol, but not in the corpus-wide count. The two sides of that subtraction now count the same way.

## 1.40.0

Kotlin Jump 1.40.0 finds the classes, objects and functions that nothing in the whole project references, the first check here that reasons across files rather than within one.

### Improvements
- Adds "Kotlin Jump: Find Everything Unused", which runs every check in one pass and reports a single summary. The three workspace checks share one read of the project, so running them together costs barely more than the slowest one alone.
- Adds "Kotlin Jump: Find Unreferenced Symbols", covering top-level classes, objects, interfaces, functions and properties. Measured on a 3444 file project: 77 findings, every one of them confirmed by hand, in under two seconds.
- Detects test source sets by Gradle convention rather than from a list, so `savedAndroidTestLaPresse`, `screenshotTest`, `testFixtures` and every `test<Flavor>` variant are recognised without configuring anything. Relying on the configured list alone reported twelve test classes as dead production code.
- Stops counting static analysis baselines as references. A detekt or Lint baseline records which warnings to silence: it names a class without using it, and one real 904 line baseline listed 376 class names that all read as live references.
- Treats the Compose contract annotations (`@Stable`, `@Immutable`, `@ReadOnlyComposable`, `@NonRestartableComposable`) as benign. They promise something about a type, they do not make it reachable.
- Adds "Remove All Unreferenced Symbols", which also deletes the imports left dangling in other files. Without those the project stops compiling the moment the declaration goes away, so they are part of the fix rather than an extra.
- Deletes the whole file when nothing but the dead declaration is left in it. On the project measured above that applied to 42 files.
- Reports symbols only the tests reference as a separate category, with no removal offered: deleting one breaks the test that exercises it, so the quick fix suggests @VisibleForTesting instead.
- Counts a reference wherever it really is: manifests, layouts, navigation graphs, Gradle scripts, ProGuard rules, META-INF/services entries and plain string literals. A class named only by an aliased import or by a fully qualified call with no import stays alive.
- Never reports anything carrying an annotation outside a short benign list, anything extending an Android or Gradle type directly or further up the chain, a sealed class whose variants are deserialized, operator and convention functions, or a name declared more than once.

### Fixes
- Fixes the workspace file cap being applied before exclusions rather than after. On a project that had been built, generated output filled the cap, the scan reported a truncated workspace, and every check that reasons about absence silently refused to run. Affected unused resource files and resource keys as well.
- Fixes comment stripping inside a multi-line raw string. A `//` on a later line of a `"""…"""` literal blanked live content, which could hide a reference and make a used resource look unused.
- Fixes write-only variable detection inside a method whose name matches a scope function, such as `fun run()` or `fun apply()`. Those methods were read as `run { }` and `apply { }` blocks, which silenced the check across every `Runnable` implementation.

## 1.39.0

Kotlin Jump 1.39.0 finds the individual entries in `values/*.xml` that nothing references, and removes a key across every one of its configuration variants at once.

### Improvements
- Adds the "Kotlin Jump: Find Unused Resource Keys" command, covering strings, colors, dimensions, styles, attributes, integers, booleans, arrays and plurals. Measured on a 3444 file project: 248 dead keys out of 3204 declared.
- Adds "Remove All Unused Resource Keys", which clears every one of them in a single Refactor Preview, and a per-key quick fix that removes the entry in `values/`, `values-night`, `values-fr` and every other qualifier variant together.
- Treats a redeclaration in a qualified folder as a variant rather than a usage, so a key that only exists to be overridden in dark mode is still reported once, with the number of variants in the message.
- Keeps a style alive through its dotted children, so declaring `Widget.App.Button.Primary` protects `Widget.App.Button` even though the parent name appears nowhere.
- Never reports configuration keys a third-party SDK reads by name (`com_braze_*`, `fb_*`, `google_api_key`), attributes named for a platform attribute such as `android:textColor`, or anything a shrinker report happens to mention.
- Makes this the single source of truth for `res/values*`: the older per-line lightbulb stands down and the usage badge keeps its count but stops graying, so a key we refuse to call dead no longer looks dead.

## 1.38.0

Kotlin Jump 1.38.0 gathers every dead code check into one workspace scan, and can clear what it finds in a single previewable change.

### Improvements
- Adds the "Kotlin Jump: Find Dead Code" command, which sweeps the whole workspace for unused imports, parameters, private declarations, local variables, and write-only variables at once, and reports the total per category.
- Reports findings for files you do not have open, where dead code actually accumulates; a file you open keeps its own live warnings instead of showing everything twice.
- Adds "Kotlin Jump: Clean Dead Code in This File" and "Clean Dead Code in the Workspace", removing everything that has a safe fix in one step, always through the Refactor Preview so nothing is applied unseen.
- Skips a finding whenever two checks disagree about the same range, so a sweep can never make an edit that no single check would have made on its own.

### Fixes
- Fixes write-only variable detection inside a method whose name matches a scope function, such as `fun run()` or `fun apply()`. Those methods were treated as `run { }` and `apply { }` blocks, which silenced the check across every `Runnable` implementation.

## 1.37.0

Kotlin Jump 1.37.0 adds a workspace-wide scan for unused Android resource files, with a one-step, previewable quick fix to remove them.

### Improvements
- Adds the "Kotlin Jump: Find Unused Resource Files" command, scanning layouts, menus, anims, animators, and raw files for anything nothing in the project references.
- Adds a quick fix that removes an unused resource file and every one of its density variants in a single, previewable change.
- Adds an opt-in setting (kotlinJump.unusedResourcesIncludeDrawables) to also flag unused drawables and mipmaps, off by default and reported under needs review rather than deleted outright.
- Keeps detection conservative: tools:keep attributes, ViewBinding class references, and bare string literals all count as real usage, and the scan reports nothing if it could not read the whole workspace.

## 1.36.0

Kotlin Jump 1.36.0 adds three new dead code detections that flag unused private declarations, unused local variables, and variables that are written but never read.

### Improvements
- Adds warnings for private functions, properties, classes, objects, and interfaces that are never referenced in their file, so dead code is easy to spot before it piles up. A quick fix removes the declaration or adds @Suppress("unused") in one step.
- Adds warnings for local variables that are never read, unused named lambda parameters, and unused catch bindings, with quick fixes that rename a binding to _, delete a dead variable when its initializer is safe to remove, or drop just the variable when the call could still run code.
- Adds warnings for variables, including private var properties, that are assigned, sometimes repeatedly, but never read, with a quick fix that removes the variable and every assignment to it at once.
- Ships all three checks enabled by default (kotlinJump.unusedDeclarations, kotlinJump.unusedLocals, kotlinJump.writeOnlyVariables), skipping overloads, operators, delegates, lateinit, annotated declarations, and other framework-required patterns, and working in both the desktop extension and the web build.

### Fixes
- Fixes unused import scanning so raw strings whose content ends in a quote (for example a regex literal like """URI="x"""") close correctly, preventing incorrect scanning of the code that follows and false unused import warnings.

## 1.35.0

Kotlin Jump 1.35.0 adds unused parameter detection with a one-click removal fix, and corrects unused import detection for $name string templates.

### Improvements
- Adds unused parameter warnings for primary-constructor parameters, private val/var constructor properties, and private function parameters, so dead parameters are easier to spot and clean up.
- Ships a quick fix that removes an unused parameter at its declaration and at every unambiguous call site, cutting out manual cleanup.
- Skips override, operator, and annotated declarations, plus data classes and enums, so signatures required by frameworks or contracts are never flagged.
- Enabled by default (kotlinJump.unusedParameters) and works in both the desktop extension and the web build.

### Fixes
- Counts $name string template references as real usage of an import, alongside the existing ${…} template support, removing false positive unused import warnings.

## 1.34.1

### Fixes
- Room migration drift diagnostics are now scoped to their own database, so two databases that each declare an entity with the same class name no longer trigger false missing migration warnings.

## 1.34.0

Kotlin Jump 1.34.0 adds a fast editing toolkit, new structure views, static execution checks, and dead weight detection, plus a semantic highlighting fix.

### Improvements
- Added a fast editing toolkit (named arguments, postfix completion, live templates, surround with, smart join lines) that brings common IntelliJ gestures to the lightbulb, cutting down repetitive edits.

  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/named-arguments.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/postfix-completion.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/live-templates.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/surround-with.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/smart-join-lines.webp" width="640" /></p>

- Added a dedicated view container with Compose Outline, Android project view, Screen Flow Map, and UDF X-Ray, showing app structure without running a build.

  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/compose-outline.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/android-project-view.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/screen-flow-map.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/udf-xray.webp" width="640" /></p>

- Added static execution checks for lifecycle pairing, dispatcher misuse, and Room migration drift, surfacing bugs that would otherwise only appear at runtime.

  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/lifecycle-pairing.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/dispatcher-lens.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/room-migration-drift.webp" width="640" /></p>

- Added dead weight detection with usage badges on resources, dependencies, and manifest entries, each with a quick fix to remove what is unused.

  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/unused-imports.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/resource-usage-badges.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/dependency-usage-badges.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/manifest-necessity.webp" width="640" /></p>

- Added resource tools (extract string resource, resource shadowing, reverse string map, hardcoded string lint) and a quick fix sweep for expired TODOs, unsafe !! assertions, and missing when branches.

  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/extract-string-resource.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/resource-shadowing.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/reverse-string-map.webp" width="640" /></p>


- Added editor comfort touches: IntelliJ-style method separators, SQL syntax colors inside Room @Query strings (single-line and multi-line), and a recent locations picker with previews.

  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/method-separators.webp" width="640" /></p>
  <p align="center"><img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/main/assets/demos/recent-locations.webp" width="640" /></p>

### Fixes
- Fixed semantic highlighting so declaration tokens stay accurate after unsaved edits and multiline strings mask correctly, keeping colors reliable while typing.

## 1.33.5

Kotlin Jump 1.33.5 fixes the file watcher so it skips build and .gradle folders, the same exclusion already applied at startup.

### Fixes
- Excluded build/ and .gradle/ folders from the file watcher, matching the exclusion already used during the initial project scan, so ongoing file tracking no longer wastes time on generated output.

### Notes
- No other functional changes to extension behavior in this release.

## 1.33.4

Kotlin Jump 1.33.4 finishes bounding activation time concurrency, extending the 1.33.3 fix so no remaining startup scan can slow down large projects.

### Fixes
- Bounded the concurrency of all remaining activation scans, not just R-index reads, using a shared batching helper. This closes the last gap that could still slow startup or exhaust file handles on large projects. Applies to both desktop VS Code and VS Code for the Web.

### Notes
- No other functional changes to extension behavior in this release.

## 1.33.3

Kotlin Jump 1.33.3 fixes a potential slowdown during activation on projects with many Android resource files by capping concurrent R-index reads.

### Fixes
- Capped R-index activation reads at 16 concurrent files, preventing potential slowdowns or file-handle exhaustion when a project has many Android resource files. Applies to both desktop VS Code and VS Code for the Web.

### Notes
- No other functional changes to extension behavior in this release.

## 1.33.2

Kotlin Jump 1.33.2 fixes a stall where large git operations could freeze editor responsiveness while the file watcher processed a burst of changes.

### Fixes
- Fixed a stall where a burst of file changes during git checkouts, branch switches, or pulls could saturate the extension host, keeping VS Code responsive instead of freezing while Kotlin Jump's file watcher caught up.

### Notes
- No other functional changes to extension behavior in this release.

## 1.33.1

Kotlin Jump 1.33.1 is a documentation and version update with no changes to extension behavior.

### Notes
- Refreshed the README's Recent Releases section, which had fallen ten versions behind, so the listed history now matches what's actually shipped.
- No functional changes to extension behavior in this release.

## 1.33.0

Kotlin Jump 1.33.0 adds inline risk pills on AndroidManifest.xml permission lines, showing each permission's risk level without a hover.

### Improvements
- Added inline risk pills on AndroidManifest.xml uses-permission lines, marking each permission as normal, dangerous, or signature level right in the manifest.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.manifestPermissionBadges setting.

## 1.32.0

Kotlin Jump 1.32.0 warns when a data class property declared in the class body gets silently left out of equals() and copy().

### Improvements
- Added warnings for data class properties declared in the class body, since only primary constructor properties participate in the generated equals(), hashCode(), and copy(). It is a common source of subtle bugs.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.dataClassFieldWarnings setting.

### Notes
- Fixed an internal release check that could trigger false CI failure alerts, improving release reliability.
- No other functional changes to extension behavior in this release.

## 1.31.0

Kotlin Jump 1.31.0 adds inline badges on expect declarations that show which Kotlin Multiplatform targets have a matching actual implementation.

### Improvements
- Added inline badges on expect declarations showing which Kotlin Multiplatform targets have a matching actual implementation, making platform coverage visible at a glance instead of requiring a manual check per target.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.kmpTargetBadges setting.

## 1.30.0

Kotlin Jump 1.30.0 adds a CodeLens that runs Gradle tasks directly from build.gradle.kts declarations.

### Improvements
- Added a CodeLens above Gradle task declarations in build.gradle.kts files, letting you run a task with one click right where it's defined.

### Notes
- No other functional changes in this release.

## 1.29.0

Kotlin Jump 1.29.0 adds inline hover tooltips that translate cron and ISO 8601 duration string literals into plain language.

### Improvements
- Added hover tooltips that translate cron expressions and ISO 8601 duration string literals (schedules, timeouts, delays) into plain language, right where you're reading the code.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.literalTooltips setting.

## 1.28.0

Kotlin Jump 1.28.0 flags deprecated Kotlin symbols with a strikethrough and shows the suggested replacement code directly on hover.

### Improvements
- Added strikethrough rendering for deprecated Kotlin symbols, making outdated APIs visible at a glance instead of requiring a manual check.
- Added a hover tooltip on deprecated symbols that shows the ReplaceWith snippet, so the suggested replacement is visible without navigating to the declaration.
- Available in both desktop VS Code and VS Code for the Web.

### Notes
- No other functional changes in this release.

## 1.27.0

Kotlin Jump 1.27.0 adds numbered step badges that show execution order on multi-line Kotlin Flow chains.

### Improvements
- Added numbered badges on multi-line Kotlin Flow chains, marking the order each operator executes so long chains are easier to read at a glance.
- Available in both desktop VS Code and VS Code for the Web.
- Can be turned off via the kotlinJump.flowChainBadges setting.

## 1.26.0

Kotlin Jump 1.26.0 adds inline accessibility hints for Jetpack Compose, flagging accessibility gaps directly in your UI code.

### Improvements
- Added inline hints that flag Jetpack Compose accessibility gaps right where you're writing UI code, making them easy to catch early instead of during a later review pass.
- Can be turned off via the kotlinJump.composeAccessibilityHints setting if you don't want the extra inline markers.

## 1.25.0

Kotlin Jump 1.25.0 adds hover tooltips that explain Android permissions directly in your code and in AndroidManifest.xml.

### Improvements
- Added hover tooltips for Android permissions covering 61 permissions, showing the protection level (normal, dangerous, or signature) and a plain-language description without leaving the editor.
- Included migration notes on legacy permissions such as WRITE_EXTERNAL_STORAGE, BLUETOOTH, and USE_FINGERPRINT, clarifying how they behave on newer Android versions.
- Extended hover support to AndroidManifest.xml, so permission entries there get the same tooltips as permission references in Kotlin code.

## 1.24.0

Kotlin Jump 1.24.0 highlights overdue dated TODO comments in red so stale work is easy to spot.

### Improvements
- Dated TODO comments that have passed their due date now render in red, making overdue work visible at a glance instead of requiring a manual scan through the file.
- Works in both desktop VS Code and VS Code for the Web.
- Can be toggled with the kotlinJump.todoExpiry setting.

## 1.23.1

Kotlin Jump 1.23.1 fixes a test explorer bug that could target the wrong test when files share the same fully qualified name.

### Fixes
- Fixed test run and debug targeting from the gutter and CodeLens: tests sharing the same fully qualified name across different files now each resolve to their own test instead of risking a mismatch.

## 1.23.0

Kotlin Jump 1.23.0 adds an optional rating prompt with editor-aware review links, plus a leaner package and a more reliable release pipeline.

### Improvements
- Added a rating prompt that appears after Kotlin Jump has been active for at least 10 sessions over a week, caps at three lifetime prompts, and honors "Don't ask again" permanently.
- Routed the rating prompt and the What's New panel's review link to the correct store for your editor: the VS Code Marketplace, or Open VSX for Cursor, Windsurf, VSCodium, and other forks.

### Packaging and Docs
- Excluded stray development tool artifacts, such as debug logs and session data, from the packaged extension, keeping installs clean.
- Hardened the automated web test suite by forcing headless Chromium, cutting spurious failures during release checks.

## 1.22.0

Kotlin Jump 1.22.0 brings Move File, bundled stdlib navigation, and drawable hover previews to VS Code for the Web, fixes test task overrides in multi-root workspaces, and adds automated web testing to the release process.

### Improvements
- Move File now works in VS Code for the Web, including package inference and import rewriting, instead of showing a "not available" message.
- The bundled Kotlin stdlib (List, String, Sequence, and the rest) now resolves from a prebuilt index shipped with the extension, so it works offline on the first file open, on both desktop and web.
- The drawable XML hover preview now works in web workspaces; the always-on gutter thumbnail stays desktop-only since it needs local disk access.
- Opening the Logcat panel or its device list in VS Code for the Web now shows a clear message pointing to desktop VS Code or a GitHub Codespace instead of a generic error.
- The README now documents exactly which features work in the browser versus which need a real machine behind the editor.

### Fixes
- Fixed `kotlinJump.testTaskOverrides` in multi-root workspaces: it now resolves from the module's own workspace folder instead of a single window-wide setting, so different Gradle modules apply their own overrides correctly.

### Packaging and Docs
- Added an automated test suite that runs the extension inside a real VS Code for the Web instance, catching browser-specific regressions before they reach a release.

## 1.21.2

Fixes a Logcat panel performance bug that could make VS Code as a whole feel sluggish during or after a debugging session, makes `kotlinJump.logcat.stop` actually stop the stream, and resolves the v1.21.0 Marketplace install failure.

### Fixes
- Fixed the Logcat webview's mirror buffer, which evicted rows with `Array.prototype.shift()`, an O(n) operation per row that ran on every incoming log line once the buffer filled, inside the webview's rendering process. Replaced with the same O(1) ring buffer already used on the extension host side.
- Fixed the webview's tag/search/level filter to update incrementally instead of rescanning the entire buffer on every batch of incoming lines (this ran at up to 60Hz while a filter was active).
- Fixed `kotlinJump.logcat.stop`, which only muted forwarding to the panel (`pause()`) without stopping the underlying `adb logcat` process. The stream, parsing, and stack-trace resolution kept running in the background indefinitely after a Stop. Stop now tears the stream down for real, and the status bar pill shows a distinct "Stopped" state.
- The ADB device watcher no longer starts unconditionally at extension activation. It now starts lazily, on first opening the Logcat panel, running a command that needs it, or a successful Android Run. A Kotlin file in the workspace no longer implies an always-on `adb` process for non-Android projects.
- The webview no longer keeps re-filtering and re-rendering while the Logcat panel is hidden; it resyncs in one pass when the panel becomes visible again.

### Notes
- v1.21.0 could fail to install from the Marketplace with a `PackageIntegrityCheckFailed` error: two Release workflow runs fired concurrently on that tag and each published its own build under the same version number, leaving a mismatched package signature. This release is a fresh, single-build publish and is unaffected.
- No changes to navigation, indexing, Gradle integration, or Android Run itself.

## 1.21.0

Adds a built-in Logcat panel with real-time ADB streaming, clickable stacktrace deeplinks, and automatic start on Android Run.

### Features
- Added a Logcat panel that streams ADB output from connected Android devices in a dedicated VS Code webview, removing the need to switch tools during development.
- Stack traces in the live stream render as clickable deeplinks; selecting a frame navigates to the exact file and line in your source.
- Logcat starts automatically when Android Run launches the app and follows its PID, so the panel shows only that app's output from the first moment.
- A status bar pill reflects the current stream state and provides one-click access to start, stop, pause, resume, clear, and device switching.
- A configurable ring buffer caps memory usage during long sessions; logs can be exported to a plain-text file for sharing or post-mortem analysis.

## 1.20.0

Adds a sealed `when` coverage CodeLens that shows branch coverage inline and inserts every missing case in one click. Works on sealed classes, sealed interfaces, and enums, on desktop and on vscode.dev.

### Features
- A CodeLens above every `when` over a sealed hierarchy or enum shows coverage at a glance: `✓ 3/3 branches` when exhaustive, `⚠ 2/3 branches, missing: Draw` when incomplete, and `✓ else covers 2 remaining` when an `else` hides unhandled subtypes.
- Clicking an incomplete lens inserts the missing branches with `TODO()` bodies. Insertion is kind-aware (bare name for objects and enum entries, `is` for classes) and mirrors the qualification style already used in the file. The cursor lands on the first inserted `TODO()`.
- No compiler involved: the hierarchy is recovered from the branches themselves through the import-aware resolver. When a branch is ambiguous or unresolved the lens stays silent rather than showing a wrong count. Kotlin 2.1+ guard branches (`is A if cond ->`) are recognized and correctly excluded from exhaustiveness.
- Toggle with `kotlinJump.sealedWhenCoverage` (on by default). Every analysis step and skip reason is traced as `[SealedWhen]` lines in the Kotlin Jump output channel.

### Fixes
- Enum entries written in UpperCamelCase are now indexed correctly: `enum class Screen { Home, Battle }` used to produce phantom one-letter symbols inline and drop the entries entirely in multi-line bodies, polluting Go to Symbol results.
- Fixed the column position of enum entries with constructor arguments, which produced overlapping semantic tokens in the editor.

## 1.19.0

Version 1.19.0 makes Kotlin Jump work on VS Code for the Web. Activation previously crashed on vscode.dev; the full pure JavaScript feature set now runs in the browser, verified end to end on a live web extension host.

### Improvements
- The browser build now registers everything that does not need Node.js: the editor toolbar toggles for string, color, and const val folding, hex swatches, and null assertion highlighting (with the Shift+Alt+I master toggle), the @Suppress hover, R.drawable hover thumbnails, the auto-opening vector drawable side preview with its references CodeLens, and clickable inlay hint navigation.
- A shared encoding utility now backs every byte-to-text conversion in code common to both hosts. Desktop keeps the zero-copy Buffer fast path; the web host uses TextDecoder and btoa with identical output, BOM handling included.
- Desktop-only commands (library sources download, Gradle detection) show a clear "Not available in VS Code for the Web" message instead of failing silently when invoked in the browser.
- Added a companion tools section to the README documenting detekt-lsp and SearchDeadCode as complementary Kotlin development tools.

### Fixes
- Fixed extension activation on vscode.dev: the parser worker pool read `__dirname` outside its fallback guard, which crashed activate() in the web worker before indexing could start.
- Fixed Find Usages, index snapshot persistence, and the What's New panel in the browser; all three relied on the Node-only Buffer global and threw on first use.
- Fixed viewport semantic highlighting in the browser: the range tokens provider scheduled its cache fill with Node-only setImmediate and failed on every freshly opened document.
- Fixed inlay hint navigation in the browser: the post-navigation suppression guard introduced in 1.18.3 was missing from the web entry, so jumping to a parameter from a hint opened the References peek on top of the destination.
- The vector preview references CodeLens provider is now disposed on deactivation, on desktop and web alike.

## 1.18.3

Adds plain-English hover for @Suppress codes, fixes Cmd+Click on inlay hints to jump to the parameter declaration rather than the function name, and standardizes all user-facing UI text.

### Improvements
- Hovering over a @Suppress, @SuppressLint, or @SuppressWarnings code now displays a plain-English description of what that suppression disables, with coverage for Kotlin compiler diagnostics, Android Lint checks, and Java warnings.
- Cmd+Click on a parameter inlay hint now resolves to the correct parameter declaration rather than the function or constructor name, making navigation from call sites precise.
- All user-facing strings in tooltips, quick-pick labels, status bar text, and menu items were standardized for consistent, clean prose across the extension.

### Notes
- The in-editor walkthrough now mentions KDoc hover, the string locale grid, and suspend call markers in existing steps, making those features easier to discover after install.
- The Marketplace and Open VSX display name was updated to include Android Studio to improve search discoverability for Android developers.
- No changes to indexing, code folding, Gradle integration, Android Run, or Find Usages behavior since v1.18.2.

## 1.18.2

Drawable gutter thumbnails now refresh reliably when files are edited or saved.

### Fixes
- Fixed drawable gutter thumbnails to refresh reliably on every file edit and save, so the preview in the gutter always reflects the current state of the drawable.

### Notes
- No changes to navigation, indexing, code folding, inlay hints, Gradle integration, or any other feature since v1.18.1.

## 1.18.1

Improves Gradle project root detection across all workspace layouts, adds automatic Windows wrapper fallback, and sharpens settings documentation for non-standard configurations.

### Improvements
- Gradle root detection walks up from the active editor and stops at the first settings.gradle(.kts), treating a standalone build.gradle as a provisional fallback only when no settings file exists higher up the tree. The same rule Gradle itself uses.
- On Windows, the gradlew wrapper resolver tries gradlew.bat before the bare script, so no manual kotlinJump.gradleWrapper change is needed on that platform.
- When detection finds more than one Gradle root in the workspace, a QuickPick prompt appears; the chosen project is remembered for the session and used by both Test Explorer and Android Run.
- The Android Run status bar button now shows four actionable states (resolved, ambiguous, setting-invalid, and wrapper-missing) each with a tooltip and a command that opens the relevant fix.

### Notes
- No changes to navigation, indexing, code folding, inlay hints, or any other non-Gradle feature since v1.18.0.

### Settings Documentation
- kotlinJump.gradleWrapper now documents that the path is relative to the detected gradleProjectRoot, not the workspace folder, preventing a common misconfiguration.
- kotlinJump.gradleProjectRoot now includes explicit guidance for sub-module layouts (e.g. opening app/ instead of the project root), flat-style projects (e.g. master/), and a clearer description of how auto-detection tiers work.

## 1.18.0

Kotlin Jump 1.18.0 adds live vector drawable previews with gutter thumbnails, hover, CodeLens, and a side panel, brings hex color swatches to XML resource files, and ships multi-phase startup and memory performance improvements alongside a batch of precision fixes.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.18.0/media/demos/vector-preview.webp" width="720" alt="Vector Drawable Preview" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.18.0/media/demos/private-file-isolation.webp" width="720" alt="File-Private Isolation in Find Usages" />
</p>

### Improvements
- Index snapshots are now written as gzip-compressed files, reducing disk I/O and cutting the time to restore a warm index on subsequent startups.
- Eliminated per-document allocations in the parser hot path and interned repeated kind and supertype strings to reduce GC pressure on large projects.
- Widened stat concurrency during the initial scan, improved trigram cache hit rate, and cached hot regex and path lookups in the usages engine to reduce repeated-search latency.

### Fixes
- Fixed the vector preview CodeLens to remain clickable after first activation; the references panel now closes automatically when a reference is picked.
- Fixed R.drawable.<name> usage search to scan the full workspace directly, so the reference count shown in the CodeLens is accurate.
- Fixed color folding to skip <color> tags inside XML comments, and fixed @color/X resolution to scan every values*/*.xml folder including locale and variant directories.
- Fixed folding decorations for R.plurals and R.array to use distinct visuals so they are no longer confused with R.string.
- Fixed Find Usages to correctly isolate file-private symbols, fixed const-val folding to respect block comments, and fixed plurals indexing to cover all values*.xml files.

## 1.17.10

Fixes null assertion highlighting to exclude Java files, where !! is a boolean double-negation, not a Kotlin null-assertion operator.

### Fixes
- Null assertion highlighting (!! operator) no longer triggers in Java files, where !! is a boolean double-negation rather than a null-assertion operator.

### Notes
- This is a focused single-fix release. No commands, settings, navigation behavior, or other UI changed since v1.17.9.

## 1.17.9

Fixes Cmd+Click on parameter inlay hints to navigate directly to the declaration without triggering the Find Usages panel as a side effect.

### Fixes
- Cmd+Click on a parameter inlay hint now performs navigation only. It jumps to the parameter declaration without also opening the Find Usages panel.

### Notes
- This is a focused single-fix release. No other commands, settings, navigation behavior, or UI changed since v1.17.8.

## 1.17.8

Fixes Cmd+Click on parameter inlay hints to navigate to the correct parameter declaration.

### Fixes
- Fixed Cmd+Click on parameter inlay hints. The action now navigates to the actual parameter declaration rather than resolving to the wrong symbol or doing nothing.

### Notes
- This is a focused single-fix release. No other commands, settings, navigation behavior, or UI changed since v1.17.7.

## 1.17.7

Removes em-dashes from the extension `displayName`, `description`, the in-VS Code "What's New" panel, and the supporting Markdown files. The Marketplace listing now reads in plain human punctuation across the title, tagline, and onboarding copy.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.6.
- `displayName` em-dash separator switched to a colon: `Kotlin Jump: Fast Kotlin & Android Navigation`.
- `description` em-dashes replaced with periods.
- `media/whats-new.json` and the supporting `ANDROID-SETUP.md` / `CONTRIBUTING.md` files cleaned in the same pass.

## 1.17.6

Removes 26 em-dashes from the README that gave the listing an AI-generated feel. Replaced with periods, commas, or sentence breaks depending on context. The copy now reads like a human wrote it.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.5.
- Pure copy edit: 26 em-dashes (`—`) replaced with natural punctuation.

## 1.17.5

README rewrite focused on conversion: removes redundant sections (Get Started, Performance, How it works, Build from source) that were duplicating header content or speaking to post-install audiences, condenses Android Run setup and Library Sources into tighter prose, kills the configuration jsonc dump, and trims emoji noise on section headings. Net result: ~30 % shorter for the same feature coverage, with a denser ratio of demos per scroll.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.4.
- README slimmed from 499 to ~355 lines (~43 % fewer words).
- Android monorepo / multi-flavor configuration moved to the new `ANDROID-SETUP.md`.
- Build-from-source instructions moved to the new `CONTRIBUTING.md`.
- "What's new" section renamed to "Recent" and refreshed with concrete labels (no version numbers in headings).

## 1.17.4

Removes the README "Limitations" section that was misrepresenting the extension's capabilities (it claimed "no full refactoring" while rename, move file, organize imports, and auto-import are all shipped) and was placed immediately before the rate/install CTAs, suppressing conversion at the worst possible moment.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.3.
- Removed README "Limitations" section. The single legitimate caveat (String folding is Android-only) is already stated in the String Resource Folding section itself, and completion guidance is covered by the Companion Mode section.

## 1.17.3

Fixes the broken Marketplace install/rating badges in the README and Marketplace listing. The previous shields.io endpoints were silently returning a "retired badge" placeholder. Migrated to the Microsoft-hosted vsmarketplacebadges.dev provider.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.2.
- Badge URLs migrated from `img.shields.io/visual-studio-marketplace/{i,r}/...` (deprecated) to `vsmarketplacebadges.dev/{installs-short,rating-short}/...` (Microsoft-hosted).

## 1.17.2

Marketplace metadata release. Refines the listing for better discoverability (description, keywords, categories, badges) and converts the README header for the migration cohort coming from Android Studio. No changes to extension commands, settings, navigation, or any user-facing behavior since v1.17.1.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.17.1.
- Updated Marketplace listing metadata (description, keywords, categories, qna, badges) to improve discoverability for the Android Kotlin developer cohort.
- Refreshed README hero and added a rate CTA; reordered features to surface Android-specific capabilities earlier.

## 1.17.1

Fixes local-scope handling across six providers, adds a declaration-to-usages jump, corrects code lens behavior, and improves const-val folding performance.

### Improvements
- Const-val folding decorations are now cached by document version and lookups are memoized, eliminating scroll lag on large files.
- Local scope resolution now checks function parameters and block-level bindings before falling back to the workspace index, improving definition accuracy throughout.

### Fixes
- Rename and hover providers now recognize local variables and parameters, preventing workspace-wide symbol rewrites when renaming a local and showing accurate hover information.
- Go to Definition on a plain string literal or comment text no longer returns a spurious result.
- Named-argument left-hand sides (e.g., `name =` in a function call) now resolve to the correct parameter declaration.
- Navigation history Back command preserves the cursor column; Forward remains available after navigating across files.
- The const-val folding provider no longer folds the identifier on the declaration line of a val or var.

## 1.17.0

1.17.0 adds drawable resource previews. Hover over any R.drawable reference to see a rendered thumbnail tooltip, and VectorDrawable XML is converted to SVG so both raster and vector assets display correctly.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.17.0/media/demos/drawable-hover.webp" width="720" alt="Gutter Drawable Thumbnails" />
</p>

### Fixes
- Fixed the What's New panel opening two VS Code windows instead of one when previewing release notes.
- Fixed the What's New panel loading stale content; the webview now reads the current release JSON on every open.

### Features
- Added drawable resource indexing that tracks all res/drawable entries across density qualifiers and reacts to file changes in real time.
- Added a hover provider for R.drawable references that renders a thumbnail preview. VectorDrawable XML files are converted to SVG inline, so no external renderer is needed.
- Added gutter thumbnail decorations alongside any line that references a drawable resource, giving a persistent visual cue without opening the asset file.

## 1.16.1

Maintenance patch correcting v1.16.0 release note text and version references; no changes to extension functionality.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.16.0.

## 1.16.0

Version 1.16.0 adds hover documentation for suppression annotations, dispatcher-aware inlay badges on coroutine suspend calls, and default keyboard shortcuts for common navigation and editor actions.

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.16.0/media/demos/suppress-hover.webp" width="720" alt="Hover tooltip showing a plain-English explanation of a suppression ID" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/elumine-dev/kotlin-jump/v1.16.0/media/demos/suspend-call-marker.webp" width="720" alt="Suspend call markers with dispatcher badges inline" />
</p>

### Features
- Added hover documentation for @Suppress, @SuppressLint, and @SuppressWarnings annotation IDs. Hovering over a suppression string shows a plain-English description of the warning or lint check being silenced.
- Added dispatcher-specific inlay badges to coroutine builder calls that specify a dispatcher (e.g. Dispatchers.IO, Dispatchers.Main), so dispatched suspension points are visually distinct from plain suspend calls at a glance.
- Registered default keyboard shortcuts for: Find Usages (Alt+F7), Go to Test (Alt+Shift+T), Go to Composable Preview (Alt+Shift+P), Organize Imports (Shift+Alt+O), Rename (Ctrl/Cmd+R), Navigate Back/Forward (Ctrl/Cmd+Alt+←/→), Copy FQN (Shift+Alt+C), and Toggle Inline Features (Shift+Alt+I).

## 1.15.0

Adds a visual at-a-glance infographic to the marketplace listing; no changes to extension commands, settings, or navigation behavior.

### Improvements
- Added a visual infographic to the marketplace README to give users an at-a-glance overview of the extension's features before installing.

### Notes
- No changes to extension commands, settings, navigation, or any other user-facing behavior since v1.14.1.

## 1.14.1

v1.14.1 reduces the extension download size by approximately 30 MB by removing nine unused walkthrough GIFs, and sharpens the built-in Library Sources walkthrough step with a more realistic example.

### Improvements
- Removed nine unused GIF files from the extension package, reducing the VSIX download size by approximately 30 MB.
- Updated the Library Sources step in the built-in walkthrough to demonstrate the feature with a coroutines library jar, making the guided example more accurate and realistic for new users.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.14.0.

## 1.14.0

v1.14.0 updates the built-in walkthrough for accuracy and ships no changes to navigation, commands, or settings.

### Improvements
- Updated the inlay hints step in the built-in walkthrough to match current extension behavior, keeping the guided introduction accurate for new users.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.13.0.

## 1.13.0

v1.13.0 improves navigation accuracy for standard Kotlin and Java built-in types, and adds correct expect/actual resolution for Kotlin Multiplatform projects.

### Improvements
- Added implicit default import awareness for Kotlin (kotlin.*, kotlin.collections.*, kotlin.io.*, and related packages) and Java (java.lang.*). Go to Definition now works on built-in types that appear without an import statement.
- Added expect/actual modifier support for Kotlin Multiplatform projects; FQN lookups now prefer the actual declaration, giving more precise jump targets in multi-platform codebases.

## 1.12.1

Packaging fix. Reduces VSIX size by excluding demo capture artifacts that were accidentally shipped in 1.12.0.

### Fixes
- Excluded `tmp-demo-e2e/` and `tmp-demo-frames/` from the published VSIX. These directories are gitignored but were missing from `.vscodeignore`, inflating the package by ~19 MB with demo capture artifacts that have no runtime purpose.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.12.0.

## 1.12.0

**Library sources, reproducible everywhere. No JVM, no LSP, no setup.**

- **Bundled Kotlin stdlib** (~600 KB shipped). `List`, `String`, `Sequence`, etc. navigable from minute zero, even on a cold Gradle cache or offline. Project-pinned versions take precedence when present.
- **JDK source indexing**. `java.lang.*`, `java.util.*` and the rest of the JDK become navigable via `JAVA_HOME` auto-detection (macOS `/usr/libexec/java_home`, Linux `update-alternatives`, Windows scan). Multi-JDK aware (prefers JDK 17+).
- **HTTP source download**. When a library's `-sources.jar` is missing from the local cache, click the new **`$(library)` status bar item** → "Download missing sources". Direct HTTPS fetch from Maven Central. No `./gradlew dependencies`, no JVM, no terminal.
- **Status bar UX**. Dedicated item showing indexed-libs count, JDK badge, stdlib badge, missing count. Click for an actions menu.
- **Inline-feature toolbar buttons**. Five new editor-toolbar buttons (color folding, const val folding, hex color swatches, !! highlight, master `$(layers)` toggle) join the existing string-folding 👁 button.
- **6 new settings**. `kotlinJump.jdkHome`, `kotlinJump.useBundledStdlib`, `kotlinJump.suppressFirstScanPrompt`, `kotlinJump.fallbackToOnlineDocs`, plus the per-feature toggles. All have sensible defaults.

Backward-compatible: existing settings (`gradleCacheDir`, `indexSourcesJars`, `companionMode`) are respected.

## 1.11.0

Maintenance release with no changes to extension behavior. Corrects duplicate changelog entries and hardens the release pipeline for more reliable future publishes.

### Fixes
- Removed duplicate changelog sections for v1.7.0, v1.0.0, and v0.7.6 that were incorrectly present in the published history.
- Release script now validates that no matching tag already exists before proceeding, preventing accidental double-publishes.

### Notes
- No changes to extension commands, settings, navigation, or any user-facing behavior since v1.10.0.
- This release corrects the published changelog and improves release infrastructure only.

## 1.10.0

Kotlin Jump 1.10.0 adds Android Studio-style navigation history, inline resource diagnostics for broken R references, and a richer set of Kotlin and Android code insights.

### Improvements
- Added Android Studio-style navigation history with Back, Forward, and Clear History commands, making it easier to retrace jumps between definitions, implementations, and usages.
- Added resource diagnostics that flag unresolved R.string and R.color references inline, exposing broken Android resource lookups directly in the editor without running a build.
- Added const val folding, suspend call markers, version catalog hover, override/implement gutter indicators, and R.color resource folding for richer in-editor context on Kotlin and Android projects.

### Fixes
- Fixed Go to Class Implementation and related navigation commands so they register reliably and open the target editor correctly during navigation flows.
- Fixed parser, definition, and hover edge cases involving string interpolation, Android R.type.name references, inherited properties, and same-file symbol resolution.

### Notes
- Added a dedicated browser entrypoint with browser-safe stubs, bringing web-hosted installs closer to feature parity with the desktop extension for supported features.
- Expanded the CI test suite with a comprehensive real-world Kotlin/Android project covering coroutines, sealed classes, annotations, resource files, and multiple test frameworks. Improving confidence in parser correctness across a wider range of code patterns.

## 1.9.1

Maintenance release that resyncs package-lock.json with npm@10 for consistent CI builds; no changes to extension behavior, commands, or settings.

### Notes
- No changes to extension commands, settings, or navigation behavior since v1.9.0.
- Updated manual install instructions in the README to reference the 1.9.1 package.

### Packaging
- Resynced package-lock.json with npm@10 to prevent lock file drift and ensure reproducible CI builds.

## 1.9.0

Adds wireless Android device connection and pairing via mDNS, and reduces annotation scan CPU overhead with incremental processing.

### Improvements
- Added a Connect via ADB WiFi command that uses mDNS (dns-sd) to discover Android devices on the local network and connects wirelessly. Removes the need for a USB cable after first setup.
- Added a Pair via ADB WiFi flow with guided step-by-step instructions for first-time wireless pairing.
- HexColorFoldingProvider and NullAssertionProvider now perform incremental line scanning. Only lines that changed are reprocessed on each edit, reducing CPU overhead in files with many annotations.

### Fixes
- Fixed a race condition where ADB WiFi connection failed because IP resolution had not yet completed. The extension now connects using the stable .local mDNS hostname.
- Fixed device detection to prefer the HOST:PORT address format and fall back to the adb-XXXX-YYYY serial, preventing misidentified or dropped device connections.

## 1.8.0

Adds wireless ADB connection and pairing from VS Code, fixes device detection reliability, and reduces CPU overhead during editing with incremental annotation scanning.

### Improvements
- Added a Connect via ADB WiFi command that discovers Android devices on the local network using mDNS (dns-sd) and connects wirelessly. Removes the need for a USB cable after first setup.
- Added a guided Pair via ADB WiFi flow with step-by-step instructions for first-time wireless pairing, so the process works even without prior adb experience.
- HexColorFoldingProvider and NullAssertionProvider now perform incremental line scanning. Only lines that changed are reprocessed on each edit, cutting CPU overhead in files with many annotations.

### Fixes
- Fixed a race condition where ADB WiFi connection failed because IP address resolution had not completed. The extension now connects using the stable .local mDNS hostname instead.
- Fixed device detection to prefer the HOST:PORT address format and fall back to the adb-XXXX-YYYY serial, preventing misidentified or dropped device connections.

## 1.7.1

Version 1.7.1 reduces CPU overhead during active editing by debouncing decoration scans and caching per-document symbol lookups in semantic highlighting.

### Notes
- No new commands, settings, or navigation features in this release. All changes are performance and reliability improvements to existing visual annotations.
- Adversarial and performance test suites were added for the affected providers, increasing confidence that decoration and semantic highlighting remain correct under edge conditions.

### Performance
- Debounced keystroke-driven scans in NullAssertionProvider, HexColorFoldingProvider, and StringResourceFoldingProvider. Rapid typing no longer triggers a full document scan on every character.
- Added a per-document word cache in SemanticTokensProvider so symbols that appear multiple times in the same file are resolved only once per render pass.

## 1.6.1

1.6.1 adds a one-click Android Run button, visual Kotlin code annotations (hex swatches, !! highlighting, @RequiresApi hints), extended string resource intelligence, and extends availability to VS Codium via the Open VSX Registry.

### Improvements
- Added a Run button to the status bar that builds, installs, and launches the Android app on the connected device or emulator in one click. No terminal, no manual adb commands.
- Auto-detects the app module and Gradle install task, supports multi-flavor and multi-app projects via `kotlinJump.androidProjects`, and offers to boot an AVD if no device is connected.
- Added hex color swatches alongside color literals in Kotlin and Java files so color values are visible without a separate color picker.
- Added highlighting for !! null-assertion operators to make unsafe dereferences immediately visible during code review.
- Added @RequiresApi inlay hints, R.plurals and R.array folding with format argument substitution, and a locale grid in string resource hover previews.

### Fixes
- Fixed extension activation failure on VS Code versions predating 1.87, where an unguarded vscode.chat API call prevented the extension from loading entirely.

### Packaging and Docs
- Published to the Open VSX Registry. Kotlin Jump is now available for VS Codium and other VS Code-compatible editors.
- Updated the README with an Android Run walkthrough and an animated step-by-step demo.

## 1.7.0

Kotlin Jump 1.7.0 adds a one-click Android Run button, visual code annotations for hex colors and null assertions, richer string resource intelligence, and fixes a crash that prevented loading on older VS Code versions.

### Improvements
- Added a Run button in the status bar that builds, installs, and launches an Android app on the connected device or emulator in one click. No terminal, no manual adb commands.
- Auto-detects the app module and Gradle install task; supports multi-flavor and multi-app workspaces via `kotlinJump.androidProjects`; offers to start an AVD if no device is connected, so the first Run click always works.
- Added hex color swatches alongside color literals in Kotlin and Java files, making color values visible without a separate color picker.
- Added highlighting for `!!` null-assertion operators so unsafe dereferences stand out immediately during code review.
- Added `@RequiresApi` inlay hints, `R.plurals` and `R.array` folding with format argument substitution, and a locale grid in string resource hover previews.

### Fixes
- Fixed an activation failure on VS Code versions predating 1.87, where an unguarded `vscode.chat` API call prevented the extension from loading entirely.

### Packaging and Docs
- Kotlin Jump is now published to the Open VSX Registry. Available for VS Codium and other VS Code-compatible editors.
- Updated the README with an Android Run walkthrough and an animated step-by-step demo.

## 1.6.0

1.6.0 ships instant XML↔Kotlin string resource navigation via a pre-built index and fixes KDoc hover at declaration sites.

### Improvements
- Replaced per-navigation file scanning with a pre-built RResourceIndex, making jumps from R.string.* references to their XML definitions (and back) instant regardless of how many resource files the project contains.
- Added two-way string resource navigation: jump from an R.string.* reference in Kotlin or Java to its XML definition, and from an XML string entry back to all Kotlin and Java usages.

### Fixes
- Suppressed KDoc hover at a symbol's own declaration site, where it was redundant and visually noisy.
- Fixed base method lookup depth in KDoc resolution. Hover now correctly surfaces inherited documentation from the nearest supertype rather than stopping prematurely.

### Notes
- Added adversarial test suites covering navigation providers, the hover provider, and the resource index. These are internal but directly increase confidence that navigation results remain correct across malformed inputs and edge conditions.

## 1.5.1

Documentation-only release: the README was fully rewritten with complete feature coverage, updated copy, and eight animated GIFs. No changes to extension behavior.

### Notes
- No changes to extension behavior, commands, settings, parsing, or navigation logic. This release is documentation only.

### Packaging and Docs
- Rewrote the README with complete, accurate coverage of all major features: Go to Definition, Find Usages, Code Lens, Test Navigation, onboarding walkthrough, AI assistant, String Folding, and Inlay Hints.
- Added eight animated GIFs to the README (one per feature area) so users can see each capability in action before installing.
- Added dedicated sections for the Code Lens, walkthrough, and AI assistant features, which lacked dedicated documentation in previous versions.

## 1.5.0

1.5.0 ships an interactive 8-step onboarding walkthrough and fixes a cluster of Go to Implementation, Code Lens, and Find Usages accuracy issues.

### Improvements
- Added an 8-step interactive walkthrough that opens automatically on first install; each step includes an animated demo covering Go to Definition, Find Usages, Code Lens, Test Navigation, String Folding, Inlay Hints, and the AI assistant. Reopen anytime with "Kotlin Jump: Open Walkthrough" from the command palette.

### Fixes
- Go to Implementation now resolves correctly from call sites and navigates directly to the target without opening the interface file as an intermediate step.
- Cmd+Click on an override method now navigates to the supertype declaration rather than stopping at the override.
- Abstract and open functions are now indexed; Code Lens implementation counts correctly reflect their actual number of implementations.
- Find Usages eliminates Kotlin keyword false positives and no longer leaks debug log lines into search results.
- The @kotlin-jump chat participant handles more natural-language phrasings, case variations, and fully-qualified name lookups correctly.

## 1.4.1

1.4.1 adds a "What's New" panel that appears automatically after each update, improves type hierarchy with sorted subtypes and override counts, fixes outgoing call detection in expression-body functions, and tightens symbol disambiguation across all navigation providers.

### Improvements
- Added a "What's New" panel: appears once per version update and shows the release summary with highlights and links; reopen anytime with "Kotlin Jump: See What's New" from the command palette.
- Type hierarchy subtypes are now sorted by kind (interfaces first, then sealed, concrete, data classes, objects, and enums) and each subtype item shows how many parent methods it overrides (e.g. "overrides 2/5"). Sealed class lists show an exhaustive count ("3/3 exhaustive").
- Implementation counts in CodeLens and type hierarchy now apply a same-name collision guard, preventing inflated counts when identically named classes exist in different packages.
- Import aliases (e.g. `import com.example.Foo as Bar`) are now recognized in symbol resolution. Navigation and rename work correctly when the alias name is used in code.
- Rename now uses import context to identify the precise class declaration when multiple classes share the same simple name, preventing the wrong .kt file from being renamed.

### Fixes
- Call hierarchy outgoing calls now include functions called inside expression-body (`fun f() = expr`) and inline-block (`fun f() { call() }`) declarations, which were previously not scanned.

### Notes
- Ten new adversarial and fuzz test suites were added covering call hierarchy, code lens, import resolution, the Java and Kotlin parsers, rename, symbol index, type hierarchy, and organize imports. Increasing confidence in correctness across edge conditions.

## 1.4.0

Clicking a usage-count CodeLens now opens the Find Usages panel immediately by reusing the already-computed scan, and repeated searches are faster thanks to in-memory file content caching.

### Improvements
- Clicking a usage-count CodeLens with `kotlinJump.smartNavigation` enabled now populates the Find Usages panel from the cached scan results instead of rescanning the workspace. The panel opens instantly rather than re-reading every file a second time.
- File content is now cached in memory across Find Usages calls within a session, so repeated searches on the same files avoid redundant disk reads on large codebases.
- Find Usages now correctly disambiguates member symbols. Enum entries, companion constants, and similarly named members in different classes. By checking which parent class is visible in the calling file, reducing false positives in search results.
- Editing a file now triggers surgical CodeLens cache eviction: only the usage counts for symbols defined in the changed file are invalidated and recomputed, rather than clearing the entire cache on every save.

### Notes
- New adversarial, invariant, and performance regression test suites were added for the symbol indexer and word index. These are internal but directly increase confidence that navigation results remain correct and fast as the codebase evolves.

## 1.3.0

Adds string resource hover tooltips and a one-click editor title bar toggle for string folding in Kotlin and Java files.

### Improvements
- Added hover tooltips for R.string.* references. Hovering over a resource reference now shows its resolved string value from strings.xml, so you can inspect resource values without switching files.
- Added string folding toggle buttons to the editor title bar. An eye icon appears for open Kotlin and Java files, letting you enable or disable string resource folding with a single click rather than through the command palette or settings. The icon updates to reflect the current folding state.

## 1.2.0

Adds R.string.* resource value folding. Inline string previews directly in Kotlin source, no language server required.

### Improvements
- Added string resource folding: `R.string.foo` references are replaced inline with their actual string values from `strings.xml`, matching Android Studio's Resource Value Folding behaviour. The real code reappears when your cursor is on the line.
- String value overlays use the editor's string literal colour for visual consistency.
- Watches `**/res/values*/strings.xml` for changes and reloads automatically. Toggle with `kotlinJump.stringResourceFolding` (enabled by default).

## 1.1.0

Adds inferred-type inlay hints enabled by default and overhauled parameter-name hints.

### Improvements
- Added inferred-type inlay hints: variable and expression types now appear inline as you write Kotlin and Java code, so you can follow code flow without manually tracing declarations. Enabled by default; toggle with `kotlinJump.inlayHints.inferredTypes`.
- Overhauled parameter-name hints. The underlying logic was rewritten for better accuracy, with hints appearing in more valid cases and fewer false positives.

### Notes
- Removed residual `.wasm` artifacts from the VSIX package, keeping the installed extension clean following the parser removal in 1.0.2.

## 1.0.2

Removes the WASM tree-sitter dependency, shrinking the extension and eliminating a startup cost with no change to features or navigation behavior.

### Improvements
- Removed the bundled WASM tree-sitter parser and its ~3 MB dependency. The extension is smaller to install and activates faster. All navigation features continue to use the regex parser, which is 109× faster than the WASM alternative.

### Notes
- No commands, settings, or navigation behaviors have changed in this release.

## 1.0.1

Patch release with expanded test coverage and source updates across the parser, indexer, MCP server, and AI integration layers; no new commands or settings.

### Notes
- Source changes were made to the Kotlin and Java parsers, symbol indexer, MCP server, chat participant, and signature utilities. No new commands or settings were introduced.
- The test suite was substantially expanded: new adversarial and edge-case test files were added covering the Kotlin parser, Java parser, MCP server, chat participant, and KDoc extraction, increasing confidence in correctness across edge conditions.
- No functional changes to commands, settings, or extension behaviour are documented for this release beyond what is reflected in the source modifications above.

## 1.0.0

Kotlin Jump 1.0.0 adds a VS Code chat participant, an MCP server for external AI tool integration, and a native JUnit test runner.

### Improvements
- Added a chat participant for VS Code's built-in chat panel. Use `/search`, `/usages`, `/implementations`, and `/doc` to query your Kotlin codebase in natural language, powered by the extension's own symbol index, without leaving the editor.
- Added an MCP server: AI assistants that support the Model Context Protocol (e.g. Claude Desktop) can now query Kotlin Jump's symbol index directly for code navigation and documentation lookup from outside VS Code.
- Added a native test runner: JUnit 4 and 5 tests now appear in VS Code's Test Explorer with full run and debug support via Gradle. No separate test plugin required. Annotations are detected automatically during indexing.

### Fixes
- Fixed navigation across submodules in multi-module Gradle projects that use Groovy-style `include` syntax. Affected projects no longer fail to resolve cross-module symbols.

### Notes
- This release requires VS Code 1.115.0 or later (previously 1.102.0). Update VS Code before upgrading the extension.

## 0.10.0

Adds symbol-aware code folding and smart selection expansion for Kotlin files.

### Improvements
- Added symbol-aware code folding for Kotlin files. Classes, functions, the import block, and KDoc comments now fold as discrete units, replacing VS Code's indentation-based folding which can misalign on Kotlin syntax.
- Added smart selection ranges: expanding or shrinking the selection (Shift+Alt+Right / Shift+Alt+Left) now follows Kotlin symbol boundaries instead of relying on generic bracket matching.
- Folding can be disabled per-workspace with the new `kotlinJump.foldingEnabled` setting.

## 0.9.0

Adds inlay hints and signature help, and fixes false positives in Find Usages and symbol indexing.

### Improvements
- Added inlay hints: parameter names and inferred types now appear inline as you write Kotlin and Java code, reducing the need to look up function signatures separately.
- Added signature help: invoking a function now shows an active-parameter popup with the full signature, making it easier to fill in arguments without leaving the editor.

### Fixes
- Fixed Find Usages returning false positives. Symbol names appearing inside comments or as substrings of unrelated identifiers no longer show up in the usages list.
- Fixed symbol indexing bugs in the Kotlin parser that could cause Go to Definition or Find Usages to miss symbols or resolve to the wrong declaration.

## 0.8.0

Adds auto-import suggestions and document highlight support for Kotlin and Java symbols.

### Improvements
- Added auto-import support: the extension now suggests and inserts the correct import statement when you use an unimported Kotlin or Java symbol, with no language server required. Can be toggled with `kotlinJump.autoImport.enabled`.
- Added document highlight support: placing the cursor on a symbol now highlights all its occurrences in the current file, making it easier to track local usages at a glance.

## 0.7.8

Adds Go to Definition and KDoc for library symbols by indexing sources JARs from Gradle and Maven caches.

### Improvements
- Go to Definition and KDoc now work for library symbols. Compose, Coroutines, AndroidX, and any dependency with a -sources.jar in your Gradle or Maven cache. Without a language server.
- Source files inside JARs can now be opened directly in the editor, letting you read library source code when navigating to a library symbol.
- Added kotlinJump.useGradleTooling to resolve source JARs via ./gradlew instead of scanning the full Gradle cache. Indexes only the project's actual dependencies, producing a smaller and more targeted index at the cost of a slower first run.

### Notes
- Library source indexing is on by default and capped at 50 JARs each for Gradle and Maven caches; adjust the limits with kotlinJump.sourcesJarsMaxCount and kotlinJump.mavenSourcesMaxCount, or override cache paths via kotlinJump.gradleCacheDir and kotlinJump.mavenLocalRepoDir.

## 0.7.7

Adds Move File and Organize Imports commands for Kotlin and Java files.

### Improvements
- Added a Move File command for Kotlin files, accessible from the editor right-click menu. Lets you move or rename a Kotlin file directly from the editor without switching to the file explorer.
- Added an Organize Imports command (Shift+Alt+O) for Kotlin and Java files. Removes unused imports using a heuristic that checks whether the imported name or alias appears in the file body; wildcard imports are always kept. Available from the command palette and the editor right-click menu.
- Added a kotlinJump.organizeImports.removeUnused setting (enabled by default) to opt out of unused-import removal while still running the Organize Imports command.

## 0.7.6

Adds a Move File command for Kotlin files, available from the editor context menu.

### Improvements
- Added a Move File command ("Move File…") for Kotlin files, accessible from the editor right-click menu. Lets you move or rename a Kotlin file directly from the editor without leaving the keyboard.

## 0.7.5

Expands Java method indexing and fixes two navigation edge cases in Call Hierarchy and Go to Definition.

### Improvements
- Java methods with package-private visibility (no explicit access modifier) are now indexed when their return type is void, a primitive, or an uppercase-named class, filling a coverage gap in Go to Definition and Find Usages for mixed Kotlin/Java projects.

### Fixes
- Fixed Call Hierarchy silently dropping outgoing calls from inline functions with block bodies (e.g., `inline fun f() { call() }`); all calls inside those bodies now appear correctly in the outgoing Call Hierarchy panel.
- Fixed Go to Definition returning the wrong result when a wildcard import and an explicit import both provide the same simple name; the explicit import now correctly wins the tiebreak instead of resolving to an unintended symbol.

## 0.7.4

Extends Java navigation to methods, fields, and enum entries, and fixes Go to Definition false positives for library symbols.

### Improvements
- Java methods, fields, and enum entries are now indexed, making Go to Definition and Find Usages work for individual Java members (not just class declarations) in mixed Kotlin/Java projects.

### Fixes
- Fixed Go to Definition returning false results when the cursor is on a symbol that resolves to an unindexed library class; the extension now correctly declines to navigate rather than jumping to an unrelated location.
- Fixed Kotlin enum indexing so enums with multiple entries are fully indexed, and corrected a parser edge case that could cause class-level declarations preceding an enum to be missed.

## 0.7.3

Fixes Find Usages false positives for private symbols, sharpens Go to Definition when same-named symbols coexist in the same package, and speeds up workspace symbol search with a trigram prefilter.

### Improvements
- Workspace symbol search (⌘T / Ctrl+T) now uses a trigram prefilter for queries of three or more characters, shrinking the fuzzy-match candidate pool before scoring and making symbol lookup noticeably faster in large projects.
- Startup phases, per-file scan timings, and search query durations are now written to the "Kotlin Jump" Output channel, making it easier to diagnose slow indexing or unexpected behavior without filing a bug report.

### Fixes
- Fixed Find Usages returning results from unrelated files when the target symbol is declared `private`; searches are now restricted to the declaring file, eliminating false positives that appeared when multiple classes in the same package each defined a same-named private member (e.g., `private val clickStream` repeated across ViewModels).
- Fixed Go to Definition presenting multiple ambiguous results when the cursor is inside a file that declares one of several same-package, same-named symbols; the declaration in the current file is now correctly preferred over same-package siblings.

## 0.7.2

Fixes incorrect CodeLens counts for same-named symbols, stale zero-counts after cancelled scans, Find Usages false positives from wildcard import collisions, and a WASM parser null-tree crash.

### Fixes
- Fixed CodeLens usage counts showing incorrect values when multiple classes define a symbol with the same simple name; counts now key on fully-qualified names so symbols in different classes no longer share a cache entry.
- Fixed CodeLens usage counts permanently displaying 0 after a scan is cancelled mid-flight; the stale result is now evicted so the next scan returns an accurate count.
- Fixed Find Usages returning false matches in files that use wildcard imports from multiple packages when those packages each export a different symbol with the same simple name; such references are now correctly treated as ambiguous and excluded.
- Fixed a potential crash in the WASM parser when tree-sitter returns a null parse tree; the error is now surfaced with a clear message instead of propagating as an unhandled exception.

## 0.7.1

Fixes outgoing Call Hierarchy for expression-body functions with default parameter values.

### Fixes
- Fixed outgoing Call Hierarchy for expression-body functions that include default parameter values (e.g., `fun f(x: Int = 0) = call()`). The `=` in a default value was previously mistaken for the expression-body marker, causing all outgoing calls from those functions to be silently dropped from the Call Hierarchy panel.

## 0.7.0

Adds a standalone LSP server for Neovim, Helix, and Zed; a smarter rename provider with import and file rename support; KMP source set awareness; and companion mode for coexisting with JetBrains Kotlin LSP.

### Improvements
- Added a standalone LSP server so Neovim, Helix, Zed, and other LSP-compatible editors can use Kotlin Jump's navigation (Go to Definition, Find Usages, and Go to Implementation) without VS Code.
- Added companion mode: when the JetBrains Kotlin LSP is detected in the workspace, Kotlin Jump automatically disables its overlapping providers so the two extensions coexist without producing duplicate results.
- Upgraded the rename provider to update import statements across files and rename the file itself when renaming a top-level declaration, making symbol renames more complete and less error-prone.
- Added Kotlin Multiplatform source set detection so module display names in Find Usages results correctly reflect KMP source sets (e.g., commonMain, androidMain) rather than showing generic module paths.

### Fixes
- Capped Find Usages results at 500 per inner search loop, preventing runaway queries from stalling the editor in very large workspaces.

## 0.6.0

Adds a tree-sitter WASM parser for more accurate Kotlin navigation, Go to Composable Preview for Jetpack Compose, and expanded settings for tuning indexing behavior. Plus a fix for member symbol disambiguation in Go to Definition and Find Usages.

### Improvements
- Integrated a tree-sitter WASM Kotlin parser that resolves symbols more accurately across complex Kotlin patterns, reducing incorrect or missing results in Go to Definition and Find Usages.
- Added Go to Composable Preview navigation so Jetpack Compose developers can jump directly to @Preview-annotated functions from the command palette.
- Expanded configurable settings to give more control over indexing behavior: file size limits, snapshot caching, reference exclusions, test source set paths, watcher debounce timing, and status bar visibility.

### Fixes
- Fixed member symbol disambiguation so Go to Definition and Find Usages correctly identify the intended symbol when multiple classes define identically-named members or functions.

## 0.5.0

Adds semantic token highlighting and a TextMate syntax grammar for Kotlin, letting compatible themes color Kotlin-specific constructs like Composable functions, extension functions, and sealed classes.

### Improvements
- Added semantic token highlighting so compatible VS Code themes can apply distinct colors to Kotlin-specific constructs. Including Composable functions, extension functions, sealed classes, and inline, infix, operator, and override members. Giving Kotlin code more accurate, expressive coloring than generic token types allow.
- Added a TextMate grammar for Kotlin, providing consistent baseline syntax highlighting across all themes even without semantic token support.
- Added Kotlin language configuration, enabling standard editor behaviors such as bracket matching, comment toggling, and auto-closing pairs in Kotlin files.

## 0.4.0

Adds native Call Hierarchy and Type Hierarchy navigation, and fixes Find Usages false positives from comments, strings, and generated files.

### Improvements
- Added Call Hierarchy support. Navigate incoming calls (who calls a function) and outgoing calls (what a function calls) using VS Code's native Call Hierarchy panel, with no language server required.
- Added Type Hierarchy support. Explore class supertypes and subtypes with enriched detail in VS Code's native Type Hierarchy panel; also fixes parsing of single-letter supertype names so short class names resolve correctly.

### Fixes
- Find Usages no longer returns false matches from comments, string literals, or kapt-generated metadata files, reducing noise and improving result accuracy across large codebases.

## 0.3.0

Adds inline CodeLens counts showing usages and implementations directly above class and function declarations.

### Improvements
- Added inline CodeLens annotations that display usages and implementations counts above class and function declarations, making call-site density and interface coverage visible at a glance without running a search.
- Introduced a `kotlinJump.codeLens` setting (default: on) to disable inline counts for users who prefer a cleaner editor gutter.

## 0.2.5

Maintenance release updating build tooling with no changes to extension behavior.

### Notes
- No changes to extension commands, settings, or navigation behavior in this release.

### Packaging and Docs
- Updated esbuild from 0.20 to 0.27, keeping the extension built against current bundler improvements.
- Updated README install commands to reference the 0.2.5 VSIX.

## 0.2.4

Internal quality release adding Compose and ViewModel parser test coverage, a minor KotlinParser fix, and CI upgrades. No changes to extension behavior.

### Improvements
- Added unit tests for Jetpack Compose and ViewModel parsing patterns, improving confidence that these Kotlin code styles are parsed correctly.
- Upgraded CI pipeline to GitHub Actions v6 and improved release automation, making future updates more consistent to publish.

### Notes
- No changes to extension commands, settings, or navigation behavior in this release.

### Packaging and Docs
- Updated README install commands to reference the current 0.2.4 VSIX.

## 0.2.3

This patch release improves Kotlin Jump's release reliability so future updates publish more consistently.

### Improvements
- Improved GitHub release automation so packaged updates and release notes publish more reliably

### Notes
- No functional changes to extension behavior

## 0.2.2

This patch release improves release preparation reliability so automated publishes stay aligned with CI.

### Improvements
- Regenerated the release lockfile with a CI-compatible npm version before tagging so local release prep matches GitHub Actions more consistently

### Notes
- No functional changes to extension behavior

## 0.2.1

Patch release with import resolution fixes and expanded edge-case test coverage across navigation providers.

### Fixes
- Reworked import resolution logic in ImportResolver. Largest change in this release
- Updated DefinitionProvider, FindUsagesEngine, and HoverProvider with bug fixes
- Extended edge-case test coverage with 71 new test lines

### Packaging and docs
- Bumped version to 0.2.1

## 0.2.0

Release polish for the Kotlin Jump rename and packaging flow.

### Packaging and docs
- Added the Find Usages panel icon asset to the packaged extension
- Updated README install commands to the current `0.2.0` VSIX name
- Trimmed non-runtime files from the published VSIX
- Refreshed launch and marketing docs to use the Kotlin Jump branding and current links

## 0.1.0

Initial release.

### Navigation
- **Go to Definition** (Cmd+Click / F12). FQN import resolution, typealias follow-through, test path isolation
- **Go to Implementation** (Cmd+F12). Interface → implementing classes, interface method → overrides
- **Find Usages** (Alt+F7). Custom panel with test/preview toggle filters, direct navigation on single result
- **Find All References** (Shift+F12). Configurable exclusion patterns via `excludeFromReferences`
- **Go to Test** (Alt+Shift+T). Toggle between class and test file by naming convention
- **Smart declaration navigation**. Cmd+Click on declaration: interface → implementations, method → overrides, no override → usages

### Editor features
- **Hover**. Full signature, KDoc, package, module, sealed class subtypes, enum entries
- **Document Outline** (Cmd+Shift+O). Symbol hierarchy with visibility markers
- **Workspace Symbol Search** (Cmd+T). Fuzzy matching with kind filters (`@class:`, `@fun:`, `@compose:`)
- **Copy FQN**. Right-click context menu command

### Performance
- Regex-based parsing on 4 worker threads. No language server
- Persistent snapshot. Restores index on restart, re-parses only changed files
- All lookups < 1ms from 4 O(1) maps (byName, byFqn, byFile, bySuper)

### Supported languages
- Kotlin (`.kt`, `.kts`)
- Java (`.java`). Classes, interfaces, enums, records
