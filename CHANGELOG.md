# Changelog

## 1.42.222

Two removals that were deleting live code, and the bulk commands the dead code family was missing.

### Fixes
- A resource key or a resource file reached through an imported R class was invisible to the scan. `import ca.foo.R.color` followed by `color.name`, the same with an alias, and `import ca.foo.R as AppR` followed by `AppR.color.name` all count as references now. Found by applying every removal the extension offers on a 6300 file project: two live colours went, and `:rubicon:component-feed` stopped compiling on two unresolved references.
- A member whose name is written between backticks came back unreferenced even when it was called. The mention harvest looks for identifiers, and `w.` + backtick + `a ghost` + backtick + `()` is not one, so absence could never be proven for such a name. The symbol detector held by accident, because the extent could not be delimited either; the member detector did not hold at all. Both stay silent on those names now, called or not.

### Improvements
- New command, Remove Code Used Only by Tests, With Its Tests. It takes the declaration and the test functions that exercise it in one Refactor Preview. A test that also covers something the removal keeps is left alone, and the count of what was withheld is reported rather than hidden.
- New command, Make Every Self Only Member Private. There are 142 of those on a real project, and one lightbulb each was the whole workflow.
- A removal now takes the imports it leaves with no user, and deletes the file when nothing but a package line remains. Applying every removal the extension offered on that same project used to leave 100 newly dead imports across 36 files.
- Find Everything Unused reports what is kept alive only by its tests on its own line, because the fix there is a different move: the declaration and its tests, or neither.

### Notes
- The extent finder learns names written between backticks. It could not delimit one before, which is what the new test removal needs: a Kotlin test function is almost always named that way.

## 1.42.221

Find Usages is between a fifth and half as expensive again, and the answer it gives is unchanged to the character.

### Fixes
- Deciding whether a line leaves a raw string or a block comment open is done once per character of every line of every file the scan reads. Since 1.42.33 that decision was made with three `startsWith` calls per position. It is one character code read now.
- Measured in interleaved passes against the previous release, four passes a side, every distribution disjoint: `references.class` drops 48 %, `references.public-fun` and the object and class scans 33 %, and nothing in the family gains less than 21 %.

### Notes
- The regression was found by comparing the current bench against the reference committed in April, then rejecting that comparison: the demo fixture has grown from 56 files to 93, so the two runs did not measure the same work. Rerunning April's own bench on today's fixture, interleaved, gave the real figure, and bisecting the tags put the step between 1.42.32 and 1.42.33.
- The reason that release made the decision expensive was sound and is untouched: a `""` quoted inside a line comment used to open an imaginary raw string, and the rest of the file stopped being read. The old routine is kept in the test file as the oracle, and the new one has to agree with it on 60 000 deliberately malformed lines, in each of the three possible entry states.

## 1.42.220

The same race, on the Problems panel this time.

### Fixes
- The Room migration drift detector reads its setting, then reads every Kotlin file of the workspace, then publishes. Switching the detection off during that read put the warnings the user had just turned off straight back. The provider also had no disposal flag at all, so a scan landing after the extension is gone calls clear and then set on a diagnostic collection that no longer exists, which the editor refuses outright.

### Notes
- Found with the recipe that closed the badge family, pointed at diagnostics rather than decorations: walk the source, keep the functions that await and then publish, report the ones where nothing in between reads the state again. Over the whole source it returns exactly one function, this one.
- Its witness needed the fixture shape the detector actually links, the entity, its migration and the `@Database` in ONE file. Split across three nothing links, and the test would have proved that zero equals zero.

## 1.42.219

The third and last provider that paints after waiting.

### Fixes
- Switching the drawable gutter thumbnails off while they are being rendered brought them straight back. The render yields once per icon, the time to read and convert the source file, and the switch can be flipped between two of them. Turning it off starts a render that clears, and that clearing render finishes FIRST, so the one still in flight put every icon back. The setting is read again just before painting now.

### Notes
- This one already handled the other half of the same race, and handled it well: a decoration type disposed mid render is cross checked against the live map before painting, because painting through a disposed type throws. Only the setting was read once and trusted to the end.
- That closes the family. Of the providers that paint decorations after an await, the three that needed the guard have it, and the remaining two hand back a value rather than painting, so an answer that lands late costs nothing.

## 1.42.218

The fix from seven releases ago had two siblings nobody had looked at.

### Fixes
- Switching the resource usage badges off while their project sweep is running switched them back on a few seconds later. The provider reads the setting, then reads every source of the project, which takes seconds, then paints. The pair of guards given to the dependency badges in 1.42.211 sat on the cache write only, and the paint is the half the user sees.
- The manifest necessity badges had the same shape and no disposal flag at all, so a sweep landing after the provider is gone wrote through a decoration type that no longer exists.

### Notes
- One test had been written around the old behaviour: it switched the setting off mid sweep to reach the render where no count can be asserted. That path now paints nothing at all, which is the whole point, so the test reaches the same render through the listing cap, which is the real reason a count cannot be guaranteed. A witness beside it proves the count IS asserted when the listing is complete, since an empty render would otherwise satisfy both.
- The two other providers that sweep the project, the string XML hover and the dead weight actions, return a value rather than painting, so an answer that lands late harms nothing there.

## 1.42.217

Two commands did nothing at all in the browser, in the very situation where the desktop stops to explain.

### Fixes
- `Find usages` clicked from the walkthrough page, with no editor focused, answers `open a Kotlin or Java file and put the cursor on a symbol first` on the desktop. That sentence exists for that click and the comment beside it says so. The browser build returned without a word, so the walkthrough link looked broken.
- `Go to test` behaved the same way: the desktop asks for a file to be open, the browser stayed silent.

### Notes
- The two builds share 65 commands. A test reads both entry points and requires that a command they share never speaks on one side while staying silent on the other, setting aside the ones the browser replaces wholesale with its own unavailable message. It found these two and nothing else. The single remaining difference is Move File, which says one thing more in the browser, since a workspace there can be read only.
- This is the second half of what shipped last release: the pickers were reworded on one side and not the other, these two were written on one side and not the other. Same shape, one level deeper.

## 1.42.216

Two builds of the same extension, one for the desktop and one for the browser, and the same sentence reworded twice in two different ways.

### Fixes
- The picker shown when several files match said `Multiple matches, pick the implementation file` on the desktop and `Multiple matches. Pick implementation file` in the browser. Three pickers had drifted apart like this, all three from the copy pass that took the dashes out: it rewrote each sentence where it found it, and nothing ever compared the two entry points. The browser now says what the desktop says, to the word.
- The string folding scan logged `strings.xml` while it looks for `values*.xml`, in the browser build only.

### Notes
- A test reads both entry points and requires every picker the browser shows to exist word for word on the desktop side. An exception has to be named one at a time, and one that no longer protects anything fails the suite.
- Four corrections to the workbench ride along, none of them to the extension itself. The perf diff no longer prints a percentage below what the bench can measure: between the two committed references it announced a bright green minus one hundred percent for six tenths of a microsecond, on a scenario whose time is the measuring loop. The differential fuzzer for the incremental decorations now carries the witness its own header had been promising since the first day, without which its clean runs proved nothing: with it on, 38 files out of 40 diverge. The hardcoded string lint is read back against a real project, 47 findings all pointing at the quote they name. And eleven tests that only asserted inside a loop now check the loop has something to iterate: none of them was empty today, but a regression that emptied one would have left them green.

## 1.42.215

The primitive every dead code detector shares could change the line count of the copy it hands back, which is the one thing it must never do.

### Fixes
- Comments and string contents are blanked out on a copy of the file, lengths kept, so an offset computed on the copy points at the same character of the real text. Three detectors go further and build their whole line table from that copy, and the action added last release reads one of its lines by index. The escape branch consumed two characters without looking at them, so a backslash at the end of a line inside a string ate the newline: the length stayed right and every line below moved up by one. A removal expressed in lines then lands on the wrong line.
- The same branch, at the very end of a file, pushed two characters for the one it consumed, so the copy came back longer than the original.
- A backslash before the end of a line no longer keeps the string open either, so the code on the next line stays visible to the scan instead of being blanked away with it.

### Notes
- Zero file of the project this is measured against produces either shape, since neither compiles. A file being typed does.
- The invariant is now a test rather than a comment: length and line count, on a thousand deliberately malformed texts drawn from a fixed seed. It found the second defect on its own, and each half of the fix is proven by putting the old branch back.
- Interleaved against the previous version on the repository bench, four passes a side: no metric has disjoint distributions. The widest apparent gap, 9.6 % on the dead island sweep, has the two sides fully interleaved.

## 1.42.214

`Add names to call arguments` was offered inside prose, and accepting it rewrote the sentence.

### Fixes
- The scan that looks for a call on the cursor line kept comments out with a helper that reads ONE line. The body of a KDoc and the body of a raw string therefore passed for code, and a line such as `* taller (late reflow, slow assets)` looks exactly like a call with two arguments. Measured on a real project: 642 call sites read out of comments and strings, 511 of them the action would rewrite, and 118 whose name really is declared somewhere in the project, which is what the resolver requires before offering anything at all.
- Candidates now come from a copy of the line with comments and string contents blanked out, lengths preserved so an offset still points at the same character of the real text. A call that follows a block comment on the same line stays eligible, and so does a call inside a string template, since that is real code.

### Notes
- The blanking runs once per document version and is kept: 3.3 ms on the largest source of that project, then 0.004 ms for every later request on the same version.
- Two neighbouring rewrites were read back and left alone. The argument splitter drops an empty segment, so a trailing comma and an empty argument list produce nothing rather than `p0 = `; and rewriting every call the action would offer across the project, 61 167 of them, changes nothing but the names it inserts.

## 1.42.213

The same quick fix as last release, one line above the one that was corrected. `Add a subscriber for this event` looked for the closing brace of the last class by taking the last brace of the TEXT, which is not the same thing.

### Fixes
- A brace inside a comment or a string is not the end of a class. Measured on a real project: 6 files out of 5 093 end with a raw string holding a JSON fixture, so the subscriber was written INTO the fixture. It compiles, since it is now text, the method does not exist, and the fixture data is quietly corrupted. In the worst of the six the insertion point moves from offset 11 637, deep inside the JSON, to 578, the real closing brace of the class.
- The handler name is learned from the file so the fix matches the bus in use. It was read the same way, so a subscriber sitting in a commented out block named the new one. Both readings now skip comments and strings.
- The import decision added last release reads the same cleaned text, so a line that merely looks like an import inside a raw string no longer counts as one.

### Notes
- Read back over the whole project: 4 690 files get an insertion point, none of them lands outside code any more, and exactly those 6 move.
- The differential fuzzer for the two incremental decoration providers claimed in its own header to carry a witness that breaks the provider on purpose. It carried none, so its clean runs proved nothing. It has one now, which skips the delivery of one event in seven to the incremental path, the shape of a missing invalidation: 38 files out of 40 diverge with it on, and 28 794 random edits over 240 real files diverge nowhere with it off.

## 1.42.212

`Add a subscriber for this event` wrote a subscriber naming a type the compiler cannot see. The fix has to decide whether the event type also needs an import line, and the test it used said yes too easily. Every yes suppresses the import.

### Fixes
- A subpackage is not visible without an import either. The test asked whether the fully qualified name STARTS with the package of the open file, so a screen in `ca.lapresse.android.lapresseplus` was told it could already see `ca.lapresse.android.lapresseplus.module.fcm.FcmBreakingNewsEvent`. Measured over the events the detector reports crossed with all 5 146 sources of a real project: wrong 467 times. That layout is the normal one, the event lives down in its module and the screen that should listen sits above it.
- The same test had no separator, so a file in `nuglif.rubicon.card` passed for anything under `nuglif.rubicon.cardlist`, two packages with nothing to do with each other.
- The other half looked for `import` followed by the name ANYWHERE in the text. A longer import that begins the same way counted as the real one, `import a.b.EventBus` for `a.b.Event`, and so did those words sitting in a comment. It has to be an import line now, with or without a semicolon, and an alias counts as one.

### Notes
- The five per file dead code detectors were read back against the real project for the first time, since their quick fix deletes from the user's own source: 93 cuts in 53 files, brace balance unchanged in every file, no orphan comma appearing, every cut either whole lines or contained in one line, and no declaration disappearing that no finding names. Two deliberately broken versions of the same probe, one widening each cut by a single character and one running it to the end of the next line, report 31 and 57 violations, so the clean reading is worth something. The eight other destructive detectors of the family had already been read this way; these five were the last.

## 1.42.211

Switching the dependency badges off could switch them back on. The provider reads every source file of the project to count imports, several seconds on a real one, and it decided whether to draw before that read rather than after: a sweep started while the setting was on finished by painting the badges the user had just turned off.

### Fixes
- The release two versions ago gave that sweep a pair of guards, so its result no longer comes back into the cache once the setting is off or the provider is gone. The paint was left out of the pair, which is the half the user actually sees. A sweep landing after the provider is disposed also wrote through a decoration type that no longer exists.
- The check that keeps em dashes and en dashes out of what the extension says only ever read a string that opened and closed on the same line. A panel is written as one template running over a hundred lines, so nothing inside a webview was ever examined, and the check said so itself in a comment: `every banned dash lives in a single line literal`. That was true the day it was written and nothing kept it true. It reads the source through the TypeScript parser now, and a stylesheet comment inside a template stays code rather than becoming copy.

### Notes
- Nothing was hiding in that blind spot: one dash lives there today, in a comment explaining a checkered background, and it is not copy. The hole was real, the leak was not.
- Both defects are proven by a test that fails without the fix, and the dash check is proven twice: on a template written by hand, and on the real panel with a sentence injected into it.

## 1.42.210

Six settings say `globs allowed` in their own description, and not one of them read `?`. Left untranslated the character stays a regular expression quantifier, which makes the letter before it optional: a pattern ending in `Test?.kt` kept `Test.kt` out of the report and let `Test1.kt` in. Both sides wrong, in opposite directions.

### Fixes
- A `?` with nothing before it does not compile at all. Writing `?.kt` in any of those six lists threw out of the detector, and in the command that runs all ten detectors at once the throw took the nine others down with it.
- Three providers each carried their own copy of the translation, so this had to be fixed three times or not at all. There is one translator now, and a test fails if a fourth copy appears.
- The neighbouring setting that excludes files from indexing goes through picomatch and has always read `?` correctly. Two settings that both promise globs while disagreeing on what a glob is: that gap is what produced this.

### Notes
- The pattern was translated and recompiled on every call, once per candidate and per pattern. Measured in interleaved passes over 40 000 calls with the two shipped defaults: 34.5 ms against 5.1 ms, the two distributions disjoint. The compiled form is kept now.
- Braces and character classes stay literal, on purpose. Reading them would widen what an exclusion list takes out, and that is the direction that hides a real finding rather than showing a false one.
- `tools:keep` in an Android resource file is AAPT's dialect, not this one, and its parser refuses a `?` outright rather than mistranslating it. Zero files use `tools:keep` on the project this is measured against, so it stays as it is.

## 1.42.209

The guard added two releases ago only looked at the word glued to the count, so a noun written in two words went through whole. Fetching a single dependency read `downloading 1 library sources`, twelve lines below a sentence the same pass had just corrected.

### Fixes
- The progress notification that downloads library sources counted them itself. One dependency to fetch is the common case, not the edge one.
- The index tooltip read `incl. 1 library files from 1 JARs`. One library with sources attached is enough to see it.

### Notes
- The guard reads up to two words between the count and the noun now, which is exactly what those two sites hid behind.
- Its tolerance was granted by FILE. `src/extension.ts` and its browser twin, more than two thousand lines each, were exempt in full, so any count written anywhere in them was invisible. Tolerance is granted line by line now, and an entry that matches nothing any more fails the suite: four of the ten files named in it had already stopped carrying a fault.
- Both holes are proven rather than described. The matching engine is a plain function the test calls directly, so a fault injected into an exempt file has to come back as a fault, and a stale tolerance has to come back as a stale tolerance.

## 1.42.208

A summary that names its own internals. The command that reports every unused thing at once printed the detector key rather than its label, so on a real project of 5093 Kotlin and Java files its dead code line read `43 locals, 21 imports, 19 declarations, 4 writeOnly, 2 parameters`.

### Fixes
- `locals` and `writeOnly` are identifiers from the source. The words for them, variables and `write-only variables`, already existed in the command that reports the same scan, three lines above the code that ignored them. One table now, used by both, and it carries the singular as well as the plural.
- The labels inside those summaries were each written once, in the plural. Nine of them sit in the aggregate command, so a lone finding read `1 dead islands`, `1 enum entries`, `1 catalog aliases`. Two would grow a second fault under a rule that guesses, entrys and aliass, which is why every singular is written down instead of derived.
- The per file clean up message agreed its noun in the previous release and left the verb behind: `1 finding need a per-case fix`. That sentence carries no verb at all now.
- The count of freed version entries in the same summary had the same shape, `1 version entries freed`.
- With every check empty and at least one check skipped, the aggregate sentence ended on a colon and a full stop with nothing between them: `0 findings across 4 files: . Skipped: resource keys.` The empty case now says nothing was found, then names what was skipped.

### Notes
- Measured on the real project: the wrong labels are visible today, the disagreement at one is not, since the smallest count there is two unused parameters. Both faults come from the same release and the same half applied idea, so both leave together.
- Three verification harnesses ride along, unused by the build and by the extension. They check the Room migration drift detector, the sealed `when` lens and the string resource hover against a real project, and each carries the deliberately broken input that proves it can still fail.

## 1.42.207

Counts written next to a hardcoded plural. One dead island read `1 declarations across 1 file(s) reference only each other`, which is not just ungrammatical: a lone declaration cannot reference each other, so the sentence was false.

### Fixes
- The dead island diagnostic and its quick fix, `Delete dead island (1 declarations)`. Measured on a real project: of 21 islands, 2 hold one declaration and 13 sit in one file. The sentence changes shape at one now instead of growing a parenthesised plural.
- The screen flow legend carried four counts on one line and none of them agreed: a map of one screen read `1 screens · 1 navigations · 1 deeplinks · 1 orphan(s)`. A regression test even pinned `1 navigations`, because it was checking the number rather than the sentence.
- Twenty more places where a count met a plural written in place: the status bar during a rescan, the drawable preview title, the test runner summary, the library sources status bar and its menu, the closing count of eight workspace scan reports. They share one helper now, and a guard fails the build if a new one appears.
- The command that reports the same islands kept the fault the diagnostic had lost. It agreed the noun, `1 declaration`, and left the rest of the sentence plural: `1 declaration that only reference each other`. A subject and its verb have to agree too, and one declaration cannot reference each other at all, so the parenthesis changes shape rather than dropping an `s`.
- The guard itself was too narrow at first. It only looked for a count computed on the spot, `${xs.length} files`, and missed eleven sites where the count already sat in a variable, `${files} files`. Widening it also meant naming, one by one, the ten places that must stay as they are: two behind a length check, one the ambiguous case of a picker, one that already tells zero, one and many apart, and the rest ratios where `1/12 libs missing` reads perfectly well.
- A scroll test slept for real and counted the steps it produced. It measures the algorithm, not the machine, so on a busy one it overran its budget. Worse, a test that overruns is not interrupted: its loop keeps running, and its late `cursorMove` landed in the NEXT test, which then saw a movement it had never asked for. The neighbouring file had already converted two timing tests for exactly this reason, with the reason written down; this block never followed. Its pauses are neutralised now, the six tests run in two milliseconds instead of seconds, and that each pause is truly awaited stays covered next door by releasing them one at a time.
- A test that reads the whole of a real project sat 173 milliseconds under the five second limit vitest gives by default. Its two asynchronous neighbours had an explicit two minute ceiling; the two synchronous ones did not. Under load, three runs in a row gave 15.1 s then 75.8 s. All four share one constant now, and in the run that followed the fix the same test took 12.1 s and passed.

### Notes
- The three quick fixes that had never been checked against a real project now are, which closes the family. Unused resource keys cut XML, where a wrong bound leaves a dangling tag rather than an unbalanced brace: 86 cuts across 68 keys, each a complete fragment leaving the file with the same tag balance. Unheard events cut a statement, 21 of them. A catalog alias and its orphaned version entry cut a line out of a TOML table, 2 of them. Nothing wrong in any of the three, and with the five detectors checked over the last two releases that is 520 deletions applied and read back.
- Two assertions were written before they could prove anything. A probe accepted a statement cut shifted by one character, since that only nibbles indentation; reading the line boundaries catches all 21. And `contains "1 file"` passes on `across 1 files`, so the plural test asks for the exact phrase instead.

## 1.42.206

No behaviour changes. Last release narrowed the window that looks for a function body, which is the kind of change that quietly loses findings, so this one is about proving it did not.

### Notes
- The report was compared finding by finding on a real project rather than by count: 14 leave, none arrives, and all 14 are methods declared in an interface. Those are exactly the ones whose extent used to swallow the class written below. A count alone would not have settled it, since a legitimate loss and a correct removal cancel out in a total.
- A signature can end on one line and finish on the next, with `throws` in Java or `where` in Kotlin, and the brace then sits on that second line. Two methods of the real project have that shape. Adding either word to the list of things that open a new declaration would break both, and a test now says so.
- The other two branches that measure a declaration were re examined and need nothing. A property only ever looks for a brace on its own line, and a class header already walks its supertype list with a rule written for this exact hazard, falling back to the header line when no brace belongs to it.
- One shape is left unguarded because the real project has none: a signature spread over three lines with the brace alone on a fourth. It loses the finding rather than swallowing anything, which is the safe direction.

## 1.42.205

A method declared in an interface has no body. The code that measures how far a declaration reaches went looking for one anyway, found the brace of the class written below it, and closed on that. The extent then ran from the method to the end of that class.

### Fixes
- Two consequences, both measured on a real project. The quick fix offered to remove such a member deleted around fifty live lines, the implementing class included. And every call to the method, living inside that implementation, fell INSIDE the member's own extent, so it counted as a mention of itself and was ignored: 14 members reported as unreferenced while they are implemented and called. The report goes from 316 to 302, the 14 that leave being exactly the 14 whose extent swallowed the file.
- The search window now stops at the line after the signature, and earlier still if that line opens a new declaration or closes the block. A body sits on the signature's own line, or alone on the next one, never past a declaration boundary. A member with no body is left out of the report entirely, which is the safe direction: losing a finding costs nothing, keeping one that deletes live code costs everything.
- The file that computes those extents opens by naming this exact hazard, that over reaching swallows the next declaration and hides a real usage. The branch for functions had no guard against it.

### Notes
- Found by applying every removal the four detectors offer on a real project and checking the file still balances: 250 member removals, 47 island removals, 18 enum entries, 85 declarations. All clean now, and the harness is in `verify-member-island-removals.ts`.
- Two false alarms from the probe itself were fixed before trusting it: a line reading `@JvmStatic fun x()` carries the annotation AND the declaration, and a Java `'}'` character literal is not a brace.
- Interleaved against the previous release, six passes: no metric survives the interleaving. The dead island sweep reads about 10 percent faster, which fits an early exit replacing a brace walk, but three passes are not enough to call it.

## 1.42.204

No behaviour changes. The quick fix that drops an unread field from a data class cuts inside a line, between two commas, and one of the three bounds that decide where was held by nothing.

### Fixes
- Break the bound that eats a middle parameter's trailing comma and the whole suite still passes, while the fix starts emitting `val a: Long,,` on eleven removals of a real project. Kotlin that does not compile, offered as a one click fix. The other two bounds were already held by a test each; this one was the hole.
- The new tests apply the cut and read the Kotlin that comes out, rather than comparing offsets to numbers written by hand. A number that drifts with the code proves nothing; a parameter list that still parses does.
- Two harnesses now run the same check against a real project instead of a fixture: `verify-symbol-removals.ts` and `verify-dto-removals.ts`. On 85 declaration removals and 11 field removals they report nothing, and both were shown to fail first on a deliberately shifted bound.

### Notes
- Getting a probe to the point where it can be believed took three attempts. Testing for an orphan comma rather than counting them disarmed the whole file, because a trailing comma before the closing parenthesis is already there. Four invariants missed a start bound moved one line up, since the swallowed line unbalances nothing; what catches it is reading the first line of code inside the cut and checking it is the declaration itself.
- One branch is left as it is: for the first parameter the special case computes the same bound as the line above it on every shape tried, so nothing can tell them apart. Dead as far as any test can see, and removing a line from code that deletes other people's code needs a better reason than that.

## 1.42.203

No behaviour changes. The guard added last release named a folder that does not exist, and left the release tooling unguarded.

### Fixes
- `NoRawControlBytes` listed `media/whatsnew` among the folders it scans. There is no such folder, so that entry protected nothing. In its place it now reads `.github/scripts`, which holds the four scripts that run on every publish. A hidden byte there would have been exactly as invisible as one in a provider, and it is the tooling that decides whether a release goes out at all. A check confirms the guard fails when a byte is put in one of those scripts.
- The guard sees 817 files now instead of 812. Its floor is there to catch a renamed folder making the scan return nothing, not to track the size of the repository, and it is set well below the real count.

### Notes
- The glob fix from last release was measured against the real project rather than trusted: of 5 093 sources it excludes exactly one more file, the one under `buildSrc` it was written for, and loses none. A pattern that widens is worth checking in that direction too.
- Three audits found nothing to fix, which is worth recording so the next pass does not repeat them. All 126 declared settings are read by something, two of them through a menu condition rather than through code. All 85 declared commands resolve in both the desktop and the web build, twelve of them through a table that builds the identifier, which a first pass had wrongly reported as missing. The five guards in the path exclusion helper were each broken in turn and a test caught every one.

## 1.42.202

The setting that keeps Gradle build logic out of the unreferenced symbol report never worked. Its own description says why it has to: a convention plugin is named by its file, so every declaration inside it looks unreferenced and gets offered for deletion, and deleting it breaks the build.

### Fixes
- A leading `**` was translated as "one directory or more" instead of "zero or more", the way the editor's own globs and gitignore read it. The shipped default is `**/buildSrc/**`, and Gradle puts `buildSrc` at the root of the project, so the pattern had nothing to match. Measured on a real project: one file under `buildSrc`, zero excluded.
- The same held for any pattern a user writes: `**/generated/**` skipped a `generated` folder at the root, `**/*.kt` skipped a file at the root. `a/**/d.kt` now matches `a/d.kt`, which is what every other glob reader does.
- The test that covered the setting used a fixture path of `/w/buildSrc/...`. That leading `/w/` supplied the directory the pattern wrongly demanded, so it passed on a setting that excluded nothing. It uses a path relative to the root now, the shape production actually produces.

### Notes
- No verdict changes on the real project: the report stays at 99 findings, 85 of them removable. The file under `buildSrc` produced none today, which is luck rather than correctness, and one unused helper added there would have been offered for deletion.
- Three sources carried a raw NUL byte where an escape was meant. Git decides a file is binary by looking for one in the first 8 000 bytes, and `FindUnheardEvents.ts` had one at 5 768, so both of its deliveries showed up as `1 file changed, 0 insertions(+), 0 deletions(-)`. Nobody could review them. Two more carried the byte at 8 021 and 8 986, a few lines from the same fate. All three now write `\u0000`, which is the same character at runtime, and a new guard fails the build if a raw control byte comes back.
- Interleaved against the previous release on the repository bench, six passes: no metric survives the interleaving. Three passes had flagged two of them as separated by 1 and 3 percent, and the extra passes dissolved both.

## 1.42.201

The long dash was banned from the README, the Marketplace page and the release notes, and a script has been checking those four files for a while. Nothing was checking the extension itself, so it kept writing them in the window.

### Fixes
- 65 pieces of text the reader actually sees: the What's New tab title, every Run Android App picker, the pairing and device dialogs, the hover on a data class body property, the drawable and string resource hovers, the suppression descriptions, the hardcoded string warning, the dead island diagnostic, the unused resource sizes, the call and type hierarchy details, the chat answers, the logcat status bar. All reworded, none of them shortened into something vaguer.
- Two status bar fields showed a bare long dash to mean "nothing here". They say `none` now, which is what a screen reader can read out.
- The script that guards the four documents now guards the sources too, and a check confirms it fails when a dash is put back in a window title.

### Notes
- The output channel is left alone on purpose. Those lines are how the extension talks to its author while something is being debugged, not copy anyone reads, and the guard exempts a literal whose statement is a log call.
- The recorded walkthrough fixtures keep theirs as well. Those strings are captured editor tab titles, which is the format the editor itself writes, and rewriting them would make the recording a lie.

## 1.42.200

Five features read every source file of the project. Four of them release what they read when you switch the feature off or close the window. The dependency badge kept it.

### Fixes
- Measured on a real project: 56 589 import lines over 5 093 sources, around 5 MB of text plus the header of every string, held by a provider nobody can reach any more. The sweep reads one file at a time and takes seconds, so closing the window or switching the badge off while it runs is the ordinary case, not the edge case.
- Three holes, all three the ones its four neighbours had already closed between 1.42.180 and 1.42.187. A sweep that lands after the provider is gone now drops its result. A sweep that lands after the badge was switched off drops it too. Disposing releases what is already held.
- A fourth: switching the badge off with a sweep already finished kept everything until the next sweep, and a badge that is off never runs one, so the memory stayed for the life of the window.

### Notes
- The four neighbours were checked again and are intact. The manifest badge needs no guard of its own, its sweep lives in a local that goes away when the call returns.
- The state provenance work from 1.42.189 and 1.42.190 was put through the same treatment, breaking each guard in turn to see whether a test notices. Seven of the eight are held. The eighth, a tolerance for a trailing line comment in the exposure match, is unreachable: the analysis already runs on a comment free view of the file.

## 1.42.199

No behaviour changes this release. Seven tests that were meant to protect the last eight releases turned out to prove nothing, and now do.

### Notes
- Each of them was found the same way: break the code the test claims to cover, then check whether the test notices. Seven did not. The inline folding test for a triple quote quoted inside a comment picked a closed example, so the parity was the same whether the count ran on the comment or on the stripped text. The two tests for moving a per line state through a deletion used values that were identical on both sides of the line that disappears, so an off by one and a wrong bound both passed.
- The rest cover guards with no occurrence at all on the project this extension is tested against: a comment block that closes and reopens on one line, a block opener quoted inside a line comment, and the two characters of a block terminator being blanked rather than one. Nothing here changes what the extension does today, it changes what a future edit is allowed to break silently.
- The inline folding rewrite from 1.42.191 was also re examined against the real project with two independent probes. Comment stripping preserves the length and the line count of all 5 093 sources, and none of the 30 403 folds it produces lands inside a comment or a raw string. The same probe run against a deliberately broken version reports 1 440 folds inside comments, which is what makes the zero worth reading.

## 1.42.198

Two cursors, one Enter. Every colour swatch and every forced unwrap highlight below the lower cursor moved one line too far down, one extra line per cursor above it.

### Fixes
- A change event can carry several edits. They all arrive in coordinates of the document from before the keystroke, while the document handed along already carries every one of them. The incremental path mixed the two spaces: it rescanned each edit against the final document, which places the decorations correctly, then applied the shift of the cursor above to those same decorations, counting it twice.
- The reach is wider than a multi cursor. Organise imports, format on save and replace all send the same shape of event.
- When an event carries several edits and any of them changes the line count, the file is rescanned whole, the same call already made when a comment or raw string boundary moves. Typing with several cursors on the same lines keeps the incremental path, since the two coordinate spaces then agree.
- The existing test for several edits in one event used two edits that changed no line count, so the two spaces coincided and it proved nothing about this.

### Notes
- Found by a new differential harness, `scripts/fuzz-incremental-decorations.ts`, which replays random edits on real sources and compares the incremental result with a full rescan after every single one. Over 12 800 edits across both providers it now reports no disagreement. It runs on a real project rather than fixtures, because the shapes that break an incremental scan are the ones a hand written fixture never contains.
- Measured in interleaved passes: an ordinary keystroke is unchanged, the distributions overlap. A multi cursor edit that adds lines goes from 43 to 250 microseconds on a file of 2 000 lines, which buys the right answer.

## 1.42.197

Select a comment block near the bottom of a file and delete it. The forced unwrap highlight and the colour swatches below stayed painted, inside text that had just become documentation.

### Fixes
- The rebuild trigger reads two things per touched line: the new text, and the memory of what that line held before the keystroke. The memory is what makes a deleted `*/` or `"""` visible at all, since the change event never carries the text that was removed. Both reads shared one bound, capped at the length of the shortened document, and that bound belongs to the text alone.
- Delete three lines or more, close enough to the end of the file that the document falls below the end of the deleted range, and the boundary sat past the cap. Nothing triggered, the per line oracles kept the shape of the old file, and the last surviving line was decorated as code while it now lives inside an open block.
- The memory is now read over the whole deleted range, the text only where the new document reaches. Both providers had the same bound and both are fixed.

### Notes
- Measured in interleaved passes against the previous release: the keystroke path is unchanged, the distributions overlap on every run.
- A test document that throws out of range, the way the editor's own does, now covers the other half: the doubles used in tests answer past the last line, so the cap on the text read could not be proven by anything before.

## 1.42.196

Press Enter above a colour swatch or above a highlighted forced unwrap, and every decoration below the caret was repainted one line too high, on code that has nothing to do with it.

### Fixes
- Both providers rescan only the lines a keystroke touched, and renumber their cache when a line appears or disappears. The cache key moved. The range inside each decoration, which is what the editor actually paints, did not. Measured on a real project: 882 swatches across 138 files and 283 unwrap highlights across 108 files, and in every one of those files the last decoration sits below the first line, so one keystroke reaches it.
- The test that covered this read the cache key and nothing else, so it passed while the paint was wrong. It now reads the ranges handed to the editor.
- The per line oracles that decide what a line means, inside a raw string or inside a comment block, did not move with the lines either. One Enter above a closed comment block was enough to desynchronise them: deleting the closing marker then triggered no rebuild, and the highlight survived inside text that had just become documentation. A paste of several lines shifts them far enough that a forced unwrap or a colour literal living inside a raw string gets decorated.
- Deleting a triple quote is now visible to the colour swatches too. Each line remembers whether it held one, the memory the forced unwrap highlight received in 1.42.193 and its neighbour never got.

### Notes
- Painting the right line costs something. On a 1500 line file carrying 800 decorations, a keystroke that shifts lines goes from 12 to 14 microseconds, and a repaint from 24 to 37. The rebuild of the ranges was moved to the repaint, which is throttled to 16 ms, so a burst of typing pays it once instead of once per character.

## 1.42.195

The manifest badge called `VIBRATE` unused, greyed the line and offered to remove it. A notification channel that asks for vibration needs that permission, and it never mentions the vibrator.

### Fixes
- The table behind the badge knew only `Vibrator` and `VibratorManager`, the direct API. It now also counts `enableVibration`, `setVibrate`, `DEFAULT_VIBRATE` and `vibrationPattern`, which is how a notification channel asks.
- Measured on a real project: of 56 permissions across 51 manifests, `VIBRATE` was the only one marked unused, and the project calls `enableVibration(true)` on its channels in five places. Removing the permission makes notifications stop vibrating with nothing else to show for it. The count of permissions with a real verdict goes from 15 to 16 and nothing is greyed any more.
- A second test pins the other direction: a project that never asks for vibration still gets the finding.

## 1.42.194

`RECEIVE_BOOT_COMPLETED` was reported as a permission nothing exercises. Nothing in an app's code ever can: it is exercised by a receiver declared in a manifest, and that receiver usually comes from a library. WorkManager declares one to reschedule periodic work after a reboot, and requires this permission for it.

### Fixes
- Measured on a real project: the check produced two findings and this was one of them, on a permission whose own comment reads `Need to do cleanup during the night and background download`. Acting on it stops that work from ever resuming after a restart, silently.
- It joins the permissions that are complete with their declaration alone, next to `WAKE_LOCK` and `FOREGROUND_SERVICE`, which are exempt for the same reason.
- A test used `RECEIVE_BOOT_COMPLETED` as its example of a permission nothing exercises, which pinned the wrong answer. It now uses `CAMERA`, which really does need a runtime request in code, and a second test covers the exemption.

### Notes
- One finding remains on that project, an intent extra written and never read anywhere. That one is real.

## 1.42.193

Last release taught the forced unwrap highlight to see comment blocks. It did not teach the keystroke path to notice when one opens or closes, so the highlight only followed the comment after some unrelated event rebuilt the whole file.

### Fixes
- Typing the start of a comment above a highlighted unwrap left the highlight standing on code that had just become documentation. Closing the comment did not bring it back either.
- The provider already forced a full rebuild when a raw string boundary moved, for exactly this reason. The trigger now covers comment boundaries as well.
- Deleting a boundary is the harder half: the change event carries what was typed, never what was removed, so nothing in the new text says a boundary is gone. Each line now remembers whether it held one, and a line that loses it triggers the rebuild.

## 1.42.192

Same blind spot as last release, in the neighbour. The highlight on a forced unwrap already carried a multi line oracle for raw strings, because a per line check cannot see a quote opened above. Comment blocks never got one, so an exclamation in the prose of a KDoc was marked as code.

### Fixes
- Measured on a real project: 2 cases, `NB: this implementation is temporary!!` and a `|!!|` warning marker, both plain documentation.
- Code that follows the end of a block on the same line is still scanned, and its columns are unchanged. A block opener quoted inside a string opens nothing.
- A test used to pin the old behaviour, with a comment saying it documented a known limitation. It asserts the corrected behaviour now.

### Notes
- The same shape exists with no occurrence at all on that project: resource folding, colour folding and the resource diagnostics read one line at a time too, and no reference to a resource sits inside a comment block there.

## 1.42.191

Inline folding replaces a constant name with its value in the editor. The guard that keeps it out of comments reads one line at a time, so it sees a comment that opens on that line and knows nothing of one opened above. Inside a KDoc block, the prose was treated as code and its words were rewritten under the reader.

### Fixes
- Measured on a real project: 120 constants qualify for folding and 3 sit inside a comment block, all three in KDoc. One reads `USER_INTERFACE_IS_UNSPECIFIED is returned when the api is too low`, with the name swapped for a number.
- The scan now runs on a comment free view of the file, which keeps offsets and strings intact, so the decorations land on the same columns and a value referenced from a string template still folds. Multi line raw strings keep their own protection.
- A triple quoted example quoted inside a comment no longer breaks the raw string tracking for the rest of the file.

### Notes
- The extra pass costs 2.2 ms on the largest file of that project, 85 KB, and runs once per document version rather than per keystroke.

## 1.42.190

Kotlin writes the same pairing two ways. `val x = _x.asStateFlow()` was recognised; `val state get() = _state.asStateFlow()` was not, so the backing field looked unexposed.

### Fixes
- The reader count then looked for collectors of the private backing, which nothing collects, and read `0 readers in this file` on a state the screen collects every time it draws. The tooltip said `no public exposure detected` for good measure.
- Measured on a real project: of 166 states with a backing field, 141 exposures were found and 143 are now. The two recovered are ordinary view models, and of the 23 that still show none, all 23 genuinely have none.

### Notes
- The entry for 1.42.188 said this lens had no tests. It had two files of them; what had none was the modifier list. The line is corrected above.

## 1.42.189

The write count next to a state only looks at the file it is in. For a `private val _x` that is the whole truth, since nothing outside can write it. For a property anyone can reach, it is not, and the lens still read `✎ 0 writes` flatly.

### Fixes
- Measured on a real project: of 21 states that are not private and show no write in their own file, 3 are written elsewhere. `contentIsInflatedState` is written in four other files and the lens announced zero.
- A state that is not private now reads `0 writes in this file`, the same reservation the reader count has carried all along for the same reason. A private one keeps the plain wording.

## 1.42.188

The lens that shows who writes and who reads a ViewModel state accepted only `private`, `internal` and `protected` in front of the property. A state declared with `override`, the shape of a ViewModel implementing a contract, had no lens at all.

### Fixes
- Measured on a real project of 3558 Kotlin files: 306 state declarations were seen, and 13 more appear with the full modifier list. Those are ordinary `MutableStateFlow` properties written through `.value =` and `.update`, so the counts are right as soon as they are visible.
- The modifier list had no coverage. Nine tests carry it now, including two that pin the limits: a declaration quoted inside a string is still not a state, and a constructor call that is not a declaration is not one either.

### Notes
- Still out of scope, and measured: 24 properties on that project use `var model by mutableStateOf(...)`. Their writes are plain assignments rather than `.value =`, so recognising them without changing how writes are found would show `0 writes` on states that are written all the time.

## 1.42.187

The guard that keeps every setting fallback in step with `package.json` only read one of the two ways the code writes them. Fifteen readings use the other, including the exclusion list that decides which files the whole extension looks at.

### Fixes
- The guard now reads `get(key) ?? fallback` as well as `get(key, fallback)`, resolves named constants holding a number or a string, and accepts a computed fallback such as one derived from the processor count. Coverage goes from 186 readings to 197, with none silently skipped.
- A fallback it cannot read is now reported rather than passed over. Passing over is how a guard quietly stops guarding.
- The guard is checked against its own inputs now, so removing either form, or the report of an unreadable fallback, fails the suite instead of just lowering a count.

## 1.42.186

Last release added a guard that every setting read with a literal fallback must match the default declared in `package.json`. It skipped lists. Lists turned out to be where the real divergence was.

### Fixes
- The list of test source sets had three spellings across eleven call sites: the five declared names, an empty list, and a constant called `DEFAULT_TEST_SEGMENTS` that was itself empty. The exclusion list had four, one of them two entries short.
- None of that reaches a released build, where the declared default always wins, but it is what the test suite ran on. With the real list in place, 29 tests of the override arrows stopped passing: their fixtures had no file path, so the filter that hides test sources had never done anything in any of them. Fixtures fixed, and those cases now exercise it.
- One constant per setting now, and the guard covers lists and named constants as well as plain values.

## 1.42.185

A setting read as `get(key, fallback)` never returns that fallback once the key is declared in `package.json`. The test stub does return it, so a fallback that disagrees with the declared default is a value only the tests ever see.

### Fixes
- The Room migration check read the indexed file ceiling with a fallback of 3000 where the declared default is 10000. The code now reads it the same way as everywhere else, and a new guard checks all 135 of these calls against `package.json` so the two can no longer drift apart.

### Notes
- Nothing changes for anyone running a released build: the declared default was already the value in force.

## 1.42.184

Releasing a cache achieves nothing if the scan already running hands its megabytes straight back. That is what happened to all three of the features that hold the project listing, a second or two after the extension shut down.

### Fixes
- The scan takes seconds, one round trip per file, so closing the window while it runs is the ordinary case rather than a corner case. Each of the three now refuses to write its result once it has been shut down: 40.8 MB for the quick fixes, 40.8 MB for the resource badge, about 17 MB for the reverse string map.
- The same guard already covered the settings being switched off. Shutdown was covered nowhere, so the memory outlived the extension itself.

## 1.42.183

Three features keep the text of every project file in memory so they can answer quickly. Raising their ceiling over the last two releases took that from about 64 MB to about 98 MB on the project measured, and two of the three never gave any of it back.

### Fixes
- The resource usage badge held 40.8 MB across 6278 files for the whole session. It now releases that when the extension shuts down, when the badges are switched off, and when a listing lands after they were switched off.
- The reverse string map held about 17 MB the same way, with no release path at all. Built inline inside its registration, nothing could reach it to release it. It is now named and disposed with the rest in both entry points.
- A count computed across that same moment is no longer shown. Without a listing to vouch for it, a zero would grey out a live resource, so the badge reads `? usages` and greys nothing.

## 1.42.182

The usage count beside every resource key read 4000 of a project's 6278 files, and had no guard at all for the ones it never opened. A key used only in those files read `0 usages` and was greyed out as dead.

### Fixes
- Measured on a real project, 229 resource files and 2007 keys badged: 130 keys really are at zero, and between 419 and 756 more were shown that way. The set changed with the order the files came back in, so the same project greyed out different keys on different runs.
- The count now reads the whole project, and past the ceiling it shows `? usages` and greys nothing, the way the dependency badge already did.
- The reverse string map, which lists the screens a string appears on, read the same 4000 files. It now sees them all.

## 1.42.181

Turning the `Remove unused …` quick fixes off releases the project scan they hold. The scan running at that moment finished a few seconds later and put all of it straight back.

### Fixes
- The scan takes seconds on a real project, one round trip per file, so switching the setting off while it runs is an ordinary thing to do rather than a corner case. It now checks the setting before writing, and so does the import list built from it. The 40.8 MB really goes.
- A quick fix computed across that same moment is no longer offered. Without a listing behind it there is nothing to vouch for an absence, and these actions delete code.

## 1.42.180

Last release taught the `Remove unused …` quick fixes to skip their startup scan when the setting is off. It read the setting once and never looked again, so the switch only worked in one direction and at one moment.

### Fixes
- Turning the actions back on now primes the scan straight away. Before, the setting was only read at startup, so the next lightbulb had to run a full project scan itself, which is the wait the warm up exists to avoid.
- Turning them off now hands the memory back. The scan holds the text of every source, 40.8 MB across 6278 files on the project measured, and that was kept for the rest of the session.
- The provider listens to its own setting, so it is now disposed with the rest. Built inline inside its registration, nothing could ever release it. A guard in the suite fails if either entry point goes back to the inline form.

## 1.42.179

The `Remove unused …` quick fixes prime a full project scan at startup so the first lightbulb does not keep VS Code waiting. That scan ran whether or not you had asked for those actions.

### Fixes
- The warm up now reads the `kotlinJump.deadWeightQuickFixes` setting first. With the actions switched off, nothing is read and nothing is held.
- What it costs when it does run, measured on a real project with interleaved passes: 92 ms of reading and 40.8 MB of file text kept for the session, across 6278 files. Raising the ceiling last release took that from 60 ms and 26.5 MB, so someone who had turned the feature off was paying more for nothing.
- Switching the setting back on still works: the first lightbulb then pays the scan once, which is exactly what the warm up spares.

## 1.42.178

Three features answer a question about an absence by walking the whole project, and each one stopped after 4000 files. Each also carries a guard that refuses to answer once the walk was cut short, so on a real project of 5088 sources those guards fired on every single run.

### Fixes
- The manifest badges showed the same `may come from a library` label on all 56 permissions of the 51 manifests measured. With the full listing, 15 become `used in N files` and one becomes `no usage found`.
- The `Remove unused …` quick fixes never appeared at all. The listing they read covers resource XML too, 6278 files there, so it overran even sooner.
- Last release taught the dependency badge to read the whole project, which left it saying `0 imports` and greying a line that no quick fix would remove. All three now share one ceiling, raised to 20000, and the guards stay for whatever lies past it.

### Notes
- Reading the extra files costs about a third more time on that project, once per 20 second window, and only while a manifest or a Gradle file is the active editor.

## 1.42.177

The usage badge next to a Gradle dependency read the project imports with a ceiling of 4000 files. A project of 5088 sources walked straight past it, and the badge still printed a number.

### Fixes
- Measured on a real project: of the 29 dependencies that got a figure, 22 were undercounted and up to 3 fell to `0 imports`, which also greys the line out as dead. One of them was `junit-jupiter-api`, with 33 real imports.
- The ceiling moves to 20000, and reaching it now means the badge shows `? imports` instead of a figure it cannot know. A line is never greyed out on an incomplete sweep.
- The sweep costs 118 ms instead of 81 ms on that project, once per 20 second window and only while a Gradle file is the active editor.

## 1.42.176

The lifecycle pairing warning fired four times out of five for nothing on a real project. It is a warning in the Problems panel, on by default, so every false one costs attention.

### Fixes
- A callback added to `onBackPressedDispatcher` needs no removal: the dispatcher belongs to the Activity and dies with it. That is the same reasoning already applied to `lifecycle.addObserver`, and it now covers `requireActivity().onBackPressedDispatcher` too.
- The `bind` and `unbind` pair stands for the `bindService` family. A `bind()` carrying no argument binds no resource at all, and the warning then named the receiver instead: `viewModel.bind()` warned about `viewModel`. A `bind` with an argument is still tracked.
- Measured on a real project of 5088 sources: 132 files reach this check, and the warnings drop from 5 to 1. The one that remains names its resource correctly.

## 1.42.175

The method separator lines went silent on a whole class when a class without a body sat above it in the same file. A `data class Foo(...)` is exactly that, and there are 1290 of them in the project this was measured on.

### Fixes
- A class header is followed across lines so that a Hilt constructor spanning four lines still opens its body correctly. That pending state was never cleared for a class that has no body, so the next class in the file opened its body on its own brace, the pending state fired again on the brace of its first member, and the body was believed to start one level too deep. The matching closing brace then ended it for good.
- Measured on a real project of 3187 Kotlin files: 15 files change, 37 separator lines come back. In 5 of them the feature drew nothing at all, one going from 0 lines to 11.
- Two lines that were drawn above the first member of a companion object are gone. Android Studio draws none there, and they were a symptom of the same confusion.

## 1.42.174

Hovering an `R.color` or `R.string` defined in several modules named a winner and struck the others through. When two definitions carry the same priority, that winner was only whichever file the index had scanned first.

### Fixes
- The priority score knows two things: app against library, and main against another source set. Two libraries both in `main` land on the same number, and so do two exclusive build variants of one module. The hover now lists those definitions side by side and says that the Gradle dependency order settles it, instead of crowning one and striking the others out.
- Measured on a real project: of 122 shadowing hovers, 20 named an arbitrary winner. The remaining 102 have a real winner and keep it, and no hover was lost along the way.
- A duplicate sitting in the very same folder keeps its Android merge error label. It shares the top score, so it would otherwise have dropped out of the list entirely.

## 1.42.173

On a selection spanning several lines, surrounding with let or apply wrote an opening brace with nothing in front of it. Both are extension functions of the standard library and only exist when called on something.

### Fixes
- On one line the action already wrote the selection followed by the call, which is right. Across lines it put the selection inside the braces and left the call with no receiver, which never compiled.
- Both are now offered on a single line selection only, in the quick fix list and in the keyboard list alike, so the option that could not work is simply absent.
- Run keeps working across lines, because the library declares a top level form of it, and so do the control structures around a block.
- Selecting a whole line usually lands the end of the selection on the first column of the next one. The list now pulls that end back exactly as the command does, so the most ordinary selection gesture there is still offers everything.

## 1.42.172

Kotlin chains across lines, and the postfix templates read one line at a time. On a continuation line the receiver they see is the fragment the line starts with, not the expression above it.

### Fixes
- On a line beginning with a safe call or a closing brace, the templates that wrap the receiver produced an empty condition, a loop over nothing or a value assigned from nothing. They are no longer offered there.
- Measured on a real project: of 1044 postfix positions, 123 sit on such a line. Each was offering eight wrapping templates that could not compile, which is 984 suggestions in all. Offers drop from 8739 to 7755, and that difference is exactly those 984.
- The let template is untouched, because it only appends behind the receiver: on a continuation line it produces exactly what the author is reaching for, and it stays available.
- A receiver that holds braces or parentheses in the right order is still a receiver, so wrapping a filtered list or a call with arguments works as before. What is refused is a fragment that cannot stand alone, including one whose delimiters only balance because a closing one came first.

## 1.42.171

The guard added yesterday, which stops the argument naming action from rewriting a declaration, read the word class inside a class literal as the keyword and refused the call that follows it on the same line.

### Fixes
- A line registering a type adapter, which names a class then constructs an object, had its constructor call refused because the word class appeared earlier on the line.
- Measured on a real project: of 16681 positions the guard refused, 15558 are declarations the parser confirms, 957 are secondary constructors it does not emit under that name, 144 are declarations it places at another column, and 21 were only this. Those 21 are back, five of which really did have an action to offer.
- A keyword reached through two colons declares nothing, so it no longer counts. Everything else the guard does is unchanged: declarations of functions and classes are still refused, and a supertype constructor call is still a call.

### Notes
- The check that found it compares the guard against what the parser of the extension itself says is declared at that exact line and column. Two readings of the same question, and the disagreements are where the answer lies.

## 1.42.170

Add names to call arguments looked for a name followed by parentheses on the cursor's line. A function declaration has exactly that shape, and its name of course resolves, since it is the declaration.

### Fixes
- With the cursor in the parameter list of a function, the action offered to rewrite that declaration, turning a parameter into an argument named after itself, which does not compile. One case even borrowed the parameter name of a function with the same name elsewhere.
- Measured on a real project with the resolver the extension really uses: of 2991 offers across 13137 candidate positions, 975 targeted a function declaration, 110 a class one and 27 another declaration form, so 37 percent of everything offered. None do now, and the count of offers falls to 1891, which is exactly the declarations removed.
- A supertype constructor call, written as a class extending another with arguments, is a real call site and is still offered. The keyword has to reach the name without crossing a parenthesis or a colon, which is what separates the two.
- Type parameters are set aside before that test, because a bound carries a colon of its own and would otherwise break the link between the keyword and the name, in nested bounds as well as simple ones.

### Notes
- Also swept and found sound on the way: the splitting of an argument list, over 46523 arguments of 34523 calls, each one with balanced delimiters and the split stable when run again. Its single reported mismatch is a trailing comma, which Kotlin allows and which correctly adds no argument.

## 1.42.169

When the literal being extracted is the argument of a setter that accepts a resource id, the extraction writes the bare id. Three names on that list have no such overload, so the result would not compile.

### Fixes
- Extracting from setError, setContentDescription or setHelperText produced a bare resource id, which is a number, where those methods only accept text.
- Checked against the real artifacts rather than from memory: android.jar of API 36 gives TextView.setError only as CharSequence, and View.setContentDescription likewise, while Material 1.13 gives TextInputLayout.setHelperText the same way. The ones kept, setText, setHint, setTitle, setSubtitle, setMessage and the dialog buttons, do have the overload.
- These three now receive a call that returns text, as any other position already did.
- The reference project has no literal in that position today, so nothing changes there. The shape itself, setting an error message on a field, is among the most common in Android, and the failure it caused was a project that no longer builds.
- One name on the list belongs to no library that could be checked, so it was left exactly as it was rather than changed on a guess.

## 1.42.168

Extract to string resource names the key after the text of the literal. When that text is a keyword of the language, the key was one too, and the project stopped compiling.

### Fixes
- The build tool writes the key as a field of the generated R class, so a Java keyword there is a syntax error, and a key named is cannot even be written in Kotlin without backticks.
- Measured on a real project: of 11786 literals, 85 produced a reserved key, across ten distinct words. The word true alone accounted for 34 of them, then null, false, native, default, class, else, super, is and package. None do now.
- The rescue is the prefix the code already used for a name that starts with a digit, so there is one habit rather than two, and the result still has to be unique against the keys already declared.
- The list covers the keywords of both languages, since the key is read from Java in the generated class and written from Kotlin at the call site.

### Notes
- Found by asking a simple question of every literal in the project: is the key this would generate a name the build can actually carry. The same sweep confirms the escaping fixed yesterday, with 10623 of 10624 template free literals coming back identical through the extraction.

## 1.42.167

Extract to string resource escaped every apostrophe, including the ones the Kotlin literal had already escaped, so the extracted text carried a backslash the app would have shown.

### Fixes
- A literal written with escaped apostrophes, such as a date pattern, came out of the extraction with two backslashes per apostrophe. The rule for the double quote right below already guarded against this; the one for the apostrophe did not.
- Found by a round trip with a known answer: take every string literal of a real project, run it through the extraction, then read the result back using the Android escaping rules and compare with the source. Of 11786 literals, 10624 carry no template and 10621 of those came back identical. The two that did not were exactly this shape, and 9 files of that project carry it.
- The third one that does not come back is a lone carriage return, which the Android escaping rules do not define. It is left as it is rather than guessed at.
- Every literal that does carry a template still numbers its placeholders from one with no gap, 1162 out of 1162.

## 1.42.166

The rule added yesterday to stop offering commented out lines as usages looked for a double slash without noticing it could be inside a string. A URL on the same line as a resource reference made that reference disappear.

### Fixes
- A line such as a message holding an address followed by a call to getString lost its reference entirely: the double slash of the address was taken for the start of a comment.
- The reference project holds no line of that shape, which is why yesterday's measurement found nothing lost. The shape itself is entirely ordinary, and losing a real usage is worse than keeping a commented out one.
- An escaped quote does not end a string either, so an odd number of them before the address no longer flips the reading.
- Cost is unchanged: alternating runs over the 6219 files of that project give 33 against 33 milliseconds, with the two sets of timings on top of each other. The scan still stops at the column being judged rather than reading the whole file.
- The project still shows 4391 usages and none of them inside a comment, so nothing was gained or lost there.

## 1.42.165

Jumping from a resource key to its usages could land on a line that is commented out. The usage count shown next to the key already ignored those, so the two disagreed.

### Fixes
- A line reading TODO use R.string.something, or an XML comment mentioning a dimension, was offered as a place the key is used. It no longer is.
- Measured on a real project: of 4396 indexed usages, 5 pointed at a commented out line, two of them commented out test assertions. None do now, and not one real usage was lost in the process.
- The repository already knew: a test pinned this as a documented false positive and asked to be updated if anyone fixed it. It now states the opposite.
- Cost mattered here. Neutralising every comment of every Kotlin file the thorough way multiplied the cost of building the index by thirteen, 411 ms against 32, for those five targets. The rule is therefore a constant time check at each match rather than a sweep of the file, and it costs one millisecond over the whole project.
- A comment at the end of a line still hides nothing that comes before it, in code as in XML.

### Notes
- Deliberately left alone: a design time preview attribute still shows up when navigating, while the count ignores it. On that project 83 references are of this kind. Both readings defend themselves, and picking one is a product decision rather than a defect to repair.

## 1.42.164

Yesterday three of the four places that jump from a key to its usages stopped guessing the length of the highlight. The fourth, dimensions, was missed.

### Fixes
- A dimension is referenced from a layout far more often than from code, so it was the worst affected: of 1184 usages reached this way, 971 were highlighted one character too far. None are now.
- Each of the four lives in its own file with its own case, so no test could say the fourth had been forgotten. A check now reads every source file and fails if any of them sizes a highlight by rebuilding the code form of a reference, which is the mistake all four shared.
- That check was calibrated before being trusted: run against yesterday's code it named exactly one file, the one that had been missed, and it fails again if the pattern comes back anywhere at all.

### Notes
- The census that found it was a deliberate change of method. Three releases in a row, a defect of a different family came from the same gesture: widening what the index holds without checking what its readers assumed. Listing every reader at once found the last one in a minute.

## 1.42.163

Jumping from a key in values to where it is used highlighted one character too many on every usage that comes from a layout, because the length of the highlight was guessed from the code form of the reference.

### Fixes
- A reference written the code way and the same one written the XML way do not have the same length. The three places that jump from values to a usage rebuilt the code form to size their highlight, so it swallowed the closing quote of every XML reference.
- Measured on a real project: of 1873 usages reached this way, 762 were highlighted one character too far, which is every single one that comes from a layout or a manifest. None are now.
- The length of the text actually recognised is recorded when the file is read, so nothing has to be rebuilt later. That also means a new way of writing a reference cannot silently break the highlight again.
- This only became visible when layout references started counting two releases ago. Until then every usage came from code and the guess happened to be right.

## 1.42.162

The pattern that recognises a resource reference written the XML way was being run over every line of every Kotlin and Java file, where it can never match, and the app manifest was left out of the scan.

### Fixes
- Code writes R.string.key, never the XML form, so searching for the XML form in every source line found nothing and cost time. Building the usage index went from 44 ms to 31 ms on a real project.
- Alternating runs of the previous release and this one over the 6219 files of that project: 44, 44 and 46 ms against 31, 31 and 31, with the two sets of timings nowhere near each other. That is 30 percent off, for nothing lost, since a resource reference in XML syntax is only a reference inside XML.
- The app manifest sits outside the res folder and was therefore never read, although it is where the launcher icon, the application name and several configuration keys are referenced. On that project it holds 24 references, 9 of which no other file carries.
- With it read, declarations that lead somewhere went from 1268 to 1275 and their targets from 1788 to 1873, each one still landing on a line that really names the key.
- Its watcher is released with the others, which the check added yesterday required before the code would pass.

## 1.42.161

The file watcher that keeps layout references up to date, added in the previous release, was created inside the block that builds the list of things to release but was left out of that list.

### Fixes
- It kept a native watch on every res folder after the extension was turned off, and its callbacks kept feeding an index nobody reads any more.
- Nothing warned about it: the compiler is happy, and no behaviour test can see it either, because the watcher works perfectly. It simply never stops.
- A check in the suite now reads both entry points, finds every watcher they create and fails if one of them is never released. It knows the four shapes used here: a name in a release list, a push, a direct release, and the return of an inline function that is itself pushed.
- That check was calibrated against the real files before being trusted: of the 28 watchers the two entry points create, it flags exactly the two added yesterday and nothing else. It also fails if it stops finding any watcher at all, so it cannot pass by finding nothing.

## 1.42.160

The index of where a resource key is used read only Kotlin, Kotlin script and Java. In Android most strings are referenced from a layout, a menu or a navigation graph, and those references were nowhere.

### Improvements
- Ctrl+click on a key in strings.xml found nothing when the string was used only from a layout. It now lands on every place the key appears, whether written R.string.key in code or @string/key in XML.
- Measured on a real project of 1237 keys declared in the default locale: 723 are referenced from code and 428, which is 35 percent, only from XML. Of 1358 declarations, those with at least one target went from 802 to 1268, and the targets from 1105 to 1788, with every one of them landing on a line that really names the key.
- The same now holds for colors, drawables, mipmaps, dimensions, plurals and arrays, which are referenced from XML far more often than from code.
- The identifiers of a layout are left alone: a plus id reference does not name a string, and neither does a reference to the Android framework, since the type has to follow the at sign directly and be one we know.
- The files added to the scan weigh 2.17 MB against 16.9 MB for the sources of that project, and they are read in bounded batches like the rest.

### Notes
- Also swept this round and found sound: Go to Definition on a string, color or dimension key from code, 1614 targets all landing on the line that declares the key; and the other direction before this change, 1105 targets with none wrong. Both checks were first proven to reject an altered key 400 times out of 400.

## 1.42.159

A base module often declares a key with no value so the code compiles, and the app supplies the text. Hovering from the base module showed the empty placeholder rather than the text.

### Fixes
- Hovering R.string.settings_app_theme_mode_light_option from the base module showed nothing. It now shows Clair, which is what the app displays at runtime.
- Android merges resources so a non empty value always beats an empty one, whichever module it comes from. The ranking put the calling file's own module first, so the placeholder won and the hover was blank.
- Nothing else moves: when every declaration of a key is filled, or every one is empty, they all get the same bonus and the order stays exactly as it was. The module of the calling file still decides between two real values.
- Measured on a real project: 5 keys are declared empty in one module and filled in another. Over the 926 keys that have a single value in the project, the hover matched the XML before and after, checked against a reader written from the Android escaping rules rather than from the extension.

### Notes
- That sweep covers 976 references to a string key across the project, 948 of which show a hover, and it was first proven to reject the value of a different key 300 times out of 300.

## 1.42.158

Two more places still took one word out of a backticked Kotlin name: Find All References searched the workspace for that word, and the editor lit up every occurrence of it.

### Fixes
- With the cursor in a test called nominal case GIVEN x THEN y, Find All References answered with every use of GIVEN in the project, and the editor highlighted that word all over the file.
- Measured on a real project over 37 of these names: Find All References returned 546 answers, 485 of them in other files, with 407 for a single name. It now returns 38 in total, none outside the file, which is the declaration plus the odd call.
- Highlighting returned 226 spans over those same names and not one of them covered the name. It now returns 38, all of them exactly on the name, with the declaration marked as a write.
- A backticked name concerns its own file and nothing else: 1086 of the 1090 distinct ones on that project exist in a single file, and the four that do not are tests of different classes that happen to share a name.
- Rename, Go to Definition and Call Hierarchy received this in 1.42.153 and 1.42.157. All five now share one function for where such a name appears, so they cannot answer differently.

### Notes
- No measurable cost on the click path: alternating runs of the previous release and this one over 34925 clicks differ by three tenths of a percent, with the two sets of timings overlapping.

## 1.42.157

A Kotlin name written between backticks is one identifier, but the cursor inside it only ever catches one word, and following that word led somewhere unrelated.

### Fixes
- Clicking in the middle of a test called given a TextDO then it maps opened TextDO in another module, and Show Call Hierarchy on it opened on a function called values. Both now read the name as written.
- Measured on a real project with 1095 such names, cursor in the middle of the name: 312 wrong targets for Go to Definition and 305 wrong roots for Call Hierarchy. Both are now right for all 1095.
- The cursor can also land on one of the spaces in the name, where there is no word at all to catch. That case used to return nothing; it now resolves like any other position in the name.
- When two classes hold a test of the same name, nothing links them and the line under the cursor decides. Four of the 1090 distinct names on that project appear in several files, one of them in five.
- Rename received this in 1.42.153. The rule now lives in a single shared place so the three cannot drift apart, and a backticked name that is a plain identifier still behaves as it always did.

### Notes
- Also swept this round and found sound: the subtype direction of Type Hierarchy, 523 answers over 1329 types with every one of them naming its parent in its own declaration; and the ranges Call Hierarchy reports, 1358 of them all landing exactly on the name, with the check first proven to catch a deliberate one character shift 400 times out of 400.

## 1.42.156

Show Type Hierarchy returned every class in the project with that simple name as a root, so it often opened on an unrelated hierarchy.

### Fixes
- Variant names of a sealed class repeat a lot. Asking for the hierarchy of Success in a login result offered eleven roots, the one you clicked sitting fifth, and the view opened on an image loading state instead.
- The cursor decides: a declaration under it wins outright, and a use resolves the way Go to Definition and rename already do, through the explicit import then the package. When nothing tells them apart the candidates are still all offered, since choosing at random would be worse.
- The line matters and not just the file: 48 pairs of file and name on a real project carry two declarations or more, one Companion appearing four times in a single file.
- Measured on that project over 745 types: 109 returned several roots and in 68 of them the declaration under the cursor was not the first. All 745 now return exactly one. The parents themselves were already right, 416 of them with none absent from the class declaration.

### Notes
- Also swept this round and found sound: the quick fixes that delete code, over the 46 they offer on that project, checked for a replacement that misses its target name, a deletion that welds two identifiers together, unbalanced delimiters and a stray comma, with the check first proven to catch a deliberate one character shift in 45 of the 46.

## 1.42.155

When several declarations share one line, each one reached to the end of that line and swallowed its neighbours, so the breadcrumb and the Outline named the one on the left.

### Fixes
- With the cursor on RADIAL in an enum written LINEAR, RADIAL; the breadcrumb read LINEAR. Same for the properties of a data class declared on a single line: the cursor on the third one named the first.
- A symbol reaches from its name to the end of the line that closes its body, so declarations sharing a line all ended at the same column. VS Code picks the first symbol whose extent holds the cursor, which is why the left neighbour won. Each one now stops just before the next begins.
- Just before, not on: a range holds both of its bounds, so stopping exactly on the first letter of the neighbour still resolved to the previous symbol, which is precisely where the cursor lands when you click a name.
- Measured on a real project of 5088 sources and 67519 outline symbols: 359 pairs of neighbours overlapped, and none do now. A symbol that has children of its own is left alone, since trimming it could push them outside it, which VS Code refuses.

### Notes
- Also swept this round and found sound, so nothing shipped for them: Organize Imports over 4693 import blocks, checked for an import invented, an import lost and for running twice giving the same result, with each of those three checks first proven to fire on a deliberately broken version; and the reader that blanks comments and strings, which keeps every length exactly over 5088 files and 16.9 MB.

## 1.42.154

Yesterday's rename fix ran its new backtick handling before the guard that refuses comments and strings, so F2 on a code span inside a KDoc offered to rename that text.

### Fixes
- Backticks are also the Markdown syntax of a KDoc. Pressing F2 on a code span there proposed a rename that would have edited only the comment, leaving the real symbol untouched everywhere else.
- Checking the line was not enough: a KDoc continuation line carries neither a double slash nor a slash star, so a line level guard sees nothing there. The decision now comes from the same reader the usage scanners already use, which blanks comments and strings while keeping every length, so a backtick survives it only when it really is code.
- Measured on a real project: of 1126 backticked spans that are not plain identifiers, all 1126 were accepted for rename yesterday and 1113 are now. The 15 that sat inside doc comments are refused, and the 1102 real test names are untouched.
- The remaining ones are backticked constants such as a name beginning with a digit. Every one of them on that project is a private value declared and used inside its own file, so renaming within the file is the right answer for them too.

### Notes
- The rule that the text a rename edit replaces must be exactly the old name still reports nothing over 150 symbols and 1870 edits.

## 1.42.153

Pressing F2 inside a Kotlin name written between backticks renamed the single word under the cursor across the whole workspace, and left the name itself broken.

### Fixes
- Kotlin lets a test be called by a sentence between backticks. The cursor only ever sits on one word of it, and rename took that word for an ordinary symbol: every declaration of the same name in the project was rewritten, and the test name was left half replaced. Rename now offers the complete backticked name, and edits only the places that name appears literally, in the file that holds it.
- Measured on a real project: 1102 backticked names contain a space, spread over 184 files, and they hold 5670 words that are also indexed symbols. The word event alone has 146 declarations, state 146, data 70. A sweep of the rename edits produced 128 edits in unrelated Java files from the single word given, and now produces none.
- Editing only the current file is the correct rule here, not a compromise: 1086 of those 1090 distinct names exist in exactly one file, and the four that do not are tests of different classes that happen to share a name, which must never be renamed together.
- A backticked name that is a plain identifier, such as one quoting a keyword, is untouched by this and still renames across the workspace with its usages.

### Notes
- The sweep that found this checks a rule that needs no reference: the text a rename edit replaces must be exactly the old name, at identifier boundaries. Over 150 symbols and 1870 edits it now reports nothing.

## 1.42.152

Ctrl+. ranked its import suggestions by symbol kind alone, so among candidates of the same kind the order was whatever the index happened to hold.

### Improvements
- Between two candidates of the same kind, the one in your own Gradle module now comes first, then the one whose package shares the most with yours. The first suggestion is the one people take, and it used to be arbitrary.
- Measured by a round trip with a known answer on a real project: remove an import from a file, ask for the quick fix at a use of that name, and the right answer is the import just removed. Over 5177 imports, the right one came first 4711 times before and 4955 after, and the number of times it fell outside the eight offered slots went from 16 to 4.
- Kind stays the first criterion, so a class still outranks a function. Proximity only orders what was not ordered at all. Putting proximity first won 15 more cases out of 5177 but overturned a deliberate choice, so it was not taken.

### Internal
- The test double for a document carried no file system path, so the five providers that ask for one to hide test sources were handed nothing. A filter that let everything through failed only two files out of 391; auto import, the type hierarchy, the override gutter and the implementations list had no coverage of it at all. The double now carries a real path, and auto import has its own check.
- Also swept and found sound, so nothing shipped for them: hover on 33820 results, and Ctrl+click across the 1901 Java files of the reference project.

## 1.42.151

Go to Definition and the Find Usages panel were the last two places still using the narrow test detection rule, so they treated real test files as production code.

### Fixes
- Ctrl+click from a production file no longer opens a file that sits in a test source set Gradle recognises by convention but that settings do not name, such as savedAndroidTest or sharedTest.
- The Find Usages panel listed files from those same source sets under production usages, and sorted them with production. They now appear under tests, where they belong.
- An earlier release taught the shared filter that a source set under src whose name contains test is a test source set, which fixed auto import, the code lens counts and the type hierarchy. Go to Definition kept its own copy of the older rule and never received that fix.
- Measured on a real project of 5088 sources: 65161 clicks from 419 production files returned 101 targets inside a test source set. That count is now zero, and only one click out of 29126 lost its result, the one whose single declaration really did live in a test.
- In the Find Usages panel, 170 of the project's 901 test files were announced as production. All 901 are now announced as tests.

### Notes
- Projects that already name every test source set in kotlinJump.testSourceSets see no change.
- The rule now has a single implementation, and a check in the suite fails if any file under src goes back to deciding on its own.

## 1.42.150

A check added yesterday put back a leak that had been fixed seven releases earlier.

### Internal
- Two checks replace a shared function for the length of their run and put it back afterwards. The one added yesterday captured the original after installing its own replacement, so it put the replacement back and the real function stayed lost. Nothing said so: the test runner isolates each file, which hides it until someone turns that off.
- The two copies of that dance are now one, so they cannot drift apart again, and two small checks prove the function comes back both when the body succeeds and when it throws. Reintroducing yesterday's ordering fails them.
- Also verified while there: the sweep added yesterday resolves 3721 clicks on the reference project, so its floor of a hundred is a floor and not a description of today.

### Notes
- No behaviour change in this release.

## 1.42.149

Protects a guard that had quietly become a speed guard, and puts the check that found the last two navigation bugs into the suite.

### Internal
- The rule that tells a type annotation from a named argument was added two releases ago to stop Ctrl+click going to the wrong place. The release after it made that wrong place unreachable by another route, so every correctness check now passes without the rule.
- It is not dead though: it keeps a click on a parameter type out of the slower path. On a real project, 928 clicks of that shape open no file and take 75.8 ms with it, against 1388 file reads and 130.3 ms without. A check now holds it there, with a companion proving a real named argument still takes the slower path, so neither can pass by doing nothing.
- The sweep that found both navigation bugs is now part of the suite: every identifier of a sample of a real project is clicked and the line reached must contain the word. It reports 14224 correct landings and none wrong, against 616 suspicious before the two fixes.
- Clicks on a declaration, import aliases and companion objects are counted apart, being right for reasons that rule cannot see.

### Notes
- No behaviour change in this release.

## 1.42.148

Ctrl+click on the name of a named argument no longer opens a function that has no such parameter.

### Fixes
- When the called function is declared in another file, the extension returned the declaration line of every same named function it knew of, without ever checking that the function actually has that parameter. The code said as much, calling itself a strict improvement over returning nothing. Measured on a real project of 3187 Kotlin files, it was not: 266 of the 651 clicks concerned, so 41 percent, opened a function without that parameter. Clicking margin took you to a photo model taking a url and a width, in another module.
- The candidate is now opened and the parameter located in its signature, so the click lands on the parameter itself rather than on the function line: 715 clicks that used to stop at the signature now reach the exact word. When no candidate has the parameter, nothing happens, which beats being sent somewhere unrelated.
- Only this one step became asynchronous, and only when a click really is on the left of a named argument, so every other resolution path keeps its previous timing.

### Notes
- No new commands or settings in this release.

## 1.42.147

Ctrl+click on the type of a parameter that has a default value went to the enclosing function instead of the type.

### Fixes
- A parameter written as a name, a colon, a type and a default value looks, to one of the resolution steps, exactly like a named argument: a word followed by a single equals sign. The extension then walked back to the opening bracket, took the enclosing function for the one being called, and sent you there. Measured on a real project of 3187 Kotlin files: 699 of the 785 such clicks that resolved, so 89 percent, landed on the wrong place. It affects every function with a default value, which in Compose code is most of them, and types as common as Modifier or Boolean.
- A named argument is never preceded by a colon and a type annotation always is, which is what now tells them apart. Clicking the left side of a real named argument still goes to the parameter of the function being called, including when a colon appears elsewhere on the same line, and the same measurement over 17588 such clicks is unchanged.

### Notes
- No new commands or settings in this release.

## 1.42.146

Test sources that Gradle recognises but the settings list does not are no longer treated as production code.

### Fixes
- The extension holds two ways of deciding whether a file belongs to a test source set: the list in the settings, and Gradle's own convention that a source set under src whose name contains test is one. The dead code detectors have always used both. The filter behind the implementation count on a lens, auto import and the type hierarchy used only the list. On a real project of 3187 Kotlin files, 29 test files, 26 under savedAndroidTest and 3 under sharedTest, were therefore taken for production code.
- Auto import was the worst of the three: it could offer to import a class declared in a test source set, which does not compile. Both ways are now used everywhere, so what one feature hides the others hide too.
- Seen from a test file nothing changes: everything stays visible, since a test may legitimately reach both sides.

### Notes
- A project whose source sets are all named in the settings sees no change.
- No new commands or settings in this release.

## 1.42.145

Stops the test suite printing a spurious error, and the author's local path, into every public build log.

### Internal
- The corpus checks look for the reference project by running an external command when the file loads, on every machine. On one without that project, which is every build machine, the command failed and its message went straight to the log: a line reading no such file or directory, which looks like a breakage and carries a local path. Its error output is now discarded, and the suite prints none.
- The guard that keeps it that way builds the text it searches for at run time. Written out plainly, those strings would appear in the guard's own file and it would satisfy itself, which is the defect corrected three releases ago, met again while writing its cure.

### Notes
- No behaviour change in this release.

## 1.42.144

Closes the last way the corpus checks could fail a release for a reason of their own.

### Internal
- Those checks decide whether to run by looking for the reference project. They looked for one file, the version catalog, while the data they read is the Kotlin sources beside it. A checkout holding the first without the second, a worktree or a branch without the modules, made them run against nothing, fail their floor, and stop the release script. They now decide on the sources themselves, and a count below two hundred files counts as absent.
- Checked on the three situations that matter: the real project runs the checks, a tree holding only the catalog skips them, and a path that does not exist skips them without raising.

### Notes
- No behaviour change in this release.

## 1.42.143

Removes a way the checks added last release could have blocked an unrelated publish.

### Internal
- Those checks each assert a floor, so that a provider gone silent is caught. The floors were set just under what the reference project measures today, within a factor of about one and a half for one of them. That project is a live repository where branches change and files come and go, and the release script runs the whole suite, so a day of ordinary work there could have failed a release of this extension for no reason. The floors now state only that the result is not empty, which is what they are for, and the same three deliberate breakages are still caught.
- The check that reads inlay hints replaces a shared function for the duration of its run and now puts it back. Nothing depends on that today because the test runner isolates each file, but that isolation is one configuration line away from being switched off.

### Notes
- No behaviour change in this release.

## 1.42.142

Locks in the checks that found the last few defects, so the next regression on those surfaces cannot pass unnoticed.

### Internal
- Three checks that had only ever been run by hand are now part of the suite: every coloured token decoded from its compact form and held to its line, every inlay hint held to its line and forbidden from splitting a word, and the two readers of comments held to the same answer. They run against a real project of 3187 Kotlin files rather than fixtures, covering more than 50000 tokens, 10000 hints and 300 documentation references.
- Each one also states what it must find, not only what must not be wrong. A provider gone silent breaks no rule, which is how a set of checks published two releases ago turned out to be unable to fail. Three deliberate breakages were tried, one per check, and each is caught.
- The checks are skipped wherever that project is absent, which is every machine but the author's, so continuous integration is unaffected.

### Notes
- No behaviour change in this release.

## 1.42.141

Corrects yesterday's change, which could hide a hint that was still worth showing.

### Fixes
- Yesterday the extension stopped labelling an argument whose name already matches the parameter. The text it reads for an argument stops at the end of the line, so a name sitting alone on its line looked like the whole argument even when the expression carried on below, as in a name on one line followed by a chained call on the next. The label was then dropped although the value passed was no longer that variable. A label is now dropped only when the argument really ends there, which the closing bracket or the comma on the next line tells us.
- A missing label is invisible, unlike a wrong one, which is why this is worth a release of its own even though the reference project, 3187 Kotlin files, does not format arguments that way and loses none.

### Notes
- The counts on that project are unchanged by this release: 11483 parameter labels, 1246 type labels, no redundant label left.
- No new commands or settings in this release.

## 1.42.140

Parameter name hints no longer repeat a name the code already says. On a real project that removed 28 percent of them.

### Fixes
- Passing a variable whose name already matches the parameter produced a hint that added nothing: provide(actionListener) showed actionListener followed by actionListener. IntelliJ and the TypeScript hints in VS Code both drop this case by default. Measured on a real project of 3187 Kotlin files, 4460 of the 15943 parameter hints were this, so more than one in four, and they drowned the hints that do carry information, the ones naming a bare true, a zero or an it.
- The match is exact, so a name differing only in capitalisation keeps its hint, and so does an argument that merely starts with the name, such as a property read or a call.
- Type hints are untouched: the same count before and after, 1246.

### Notes
- Hints on arguments that are already named in the source were already suppressed, and positions were checked across 17189 hints in 1574 files with none out of bounds.
- No new commands or settings in this release.

## 1.42.139

A character literal holding a quote switched off the documentation check added last release for the rest of the file.

### Fixes
- The reader that finds documentation links did not know about character literals, so a literal holding a double quote was taken for the start of a string. Everything after it in the file became invisible, the check that keeps an import named by a documentation link stopped applying there, and such imports were called dead again. Character literals are now understood, escapes and unicode escapes included.
- Measured on a real project of 3187 Kotlin files: 36 hold a character literal and one holds a quote in one, with no finding affected today. The point is that the miss was silent and covered a whole file.

### Notes
- No new commands or settings in this release.

## 1.42.138

An import named only by a documentation link is no longer reported as dead. On a real project that was two findings out of five.

### Fixes
- In Kotlin a documentation link such as a bracketed type name resolves through the file's imports, so removing the import breaks the generated documentation and the quick doc popup. IntelliJ, ktlint and detekt all count such a reference as a use. The sweep read the file with comments stripped, so these references were invisible: on a real project of 3187 Kotlin files, 15 of the 37 imports it called dead were named only by documentation, which is 41 percent. None of them was used in code, so nothing would have failed to compile, but following the advice would have broken 15 documentation links.
- The see, throws, exception and sample tags count too, since they name a type directly. A name merely mentioned in prose does not, and neither does one inside a string, since nothing resolves there.

### Notes
- The same check was run on the declarations detector and it has no such finding on that project, so it is unchanged.
- No new commands or settings in this release.

## 1.42.137

The check added last release for the catalog colouring could not have caught a broken scanner.

### Internal
- Those checks only asked that nothing be wrong: no token past the end of its line, no overlap, no impossible fold. A scanner that produced nothing at all breaks none of those, so twelve of the thirteen checks still passed when it was made silent. The thirteenth, the one that reads a real catalog, is the one skipped wherever that project is absent, which is every machine but the author's.
- Each case now states what it must produce, the tokens and their kinds and the number of folds, so the same silent scanner fails thirteen of fourteen instead of one. Four further deliberate breakages were tried: losing the difference between a key and an inline field, dropping comments, folding an empty table, and losing the difference between a version number and a plain string. Each is now caught by the cases that care about it.

### Notes
- No user visible change in this release.

## 1.42.136

A project folder containing a dollar sign broke the catalog path resolution added last release.

### Fixes
- The directory of a settings file is substituted into a from files path wherever it names the rootDir property. A dollar sign in that directory was read as a back reference by the substitution itself, and a second check meant to spot variables it cannot resolve was looking at the result rather than at the expression, so it rejected a path that was perfectly resolvable. Both now handle a dollar in a folder name.

### Notes
- The scanner that colours and folds a catalog file was audited this release and left unchanged. Its result is now held to properties it must satisfy on its own: no token reaching past the end of its line, no two tokens overlapping, no impossible fold, and the same token reported by colouring and by navigation at any position. Checked on twelve awkward inputs and on a real catalog of 292 lines and 1128 tokens.
- No new commands or settings in this release.

## 1.42.135

A shared catalog reached through the rootDir property is found again, which the previous release only handled for plain relative paths.

### Fixes
- An included build can point at the parent catalog with a from files clause whose path goes through the rootDir property. The brace in that expression ended the reading of the block early, so the clause became invisible and the second name of the catalog was lost, leaving that build without hover or Ctrl+click. In a settings file rootDir is the directory holding that file, and rootProject.projectDir means the same, so both are now resolved exactly, with or without braces around them.
- Any other variable in such a path is left alone rather than guessed. Guessing would mean matching on file name, which is what made one project rename its neighbours two releases ago.

### Notes
- A project that does not share a catalog this way sees no change, verified against a real one.
- No new commands or settings in this release.

## 1.42.134

Version catalogs declared in a Groovy settings.gradle are read too, not just the Kotlin ones.

### Fixes
- A settings.gradle written in Groovy quotes with apostrophes, create('deps'), and the rule that reads catalog names only accepted double quotes. A Groovy project that renames its catalog therefore kept the name of the file, and hover and Ctrl+click stayed silent on every catalog accessor in every build file. The previous releases said settings renames were understood, which was only true of the Kotlin dialect. Both are now read, including the shared catalog of an included build.
- Mismatched quotes are still rejected, since they are not valid Gradle and accepting them would turn noise into a declaration.

### Notes
- A project using the Kotlin dialect sees no change.
- No new commands or settings in this release.

## 1.42.133

A catalog shared by an included build is reachable under both of its names again.

### Fixes
- A composite build can point at the parent's catalog with create("deps") { from(files("../gradle/libs.versions.toml")) }. The same file is then reachable as libs from the parent and as deps from the included build, and only one name was kept: before the previous release deps won and the parent went silent, since then libs won and the included build went silent. Both names are now offered, which the hover and Ctrl+click loops already knew how to handle.
- The path in a from(files(...)) clause is resolved against the directory of the settings file that declares it, so a catalog is only claimed by a settings file that really points at it.

### Notes
- A project whose catalog is not shared this way sees exactly one name, as before, verified against a real one.
- No new commands or settings in this release.

## 1.42.132

In a workspace holding several projects, one project renaming its catalog silently renamed its neighbours' too.

### Fixes
- A catalog rename declared in settings.gradle.kts was matched by file name alone. Every default catalog is called libs.versions.toml, so create("deps") in one project also applied to every other project in the workspace: the neighbour believed its root was deps while its build files write libs, and hover and Ctrl+click went silent across it. A settings file now only governs the catalogs under its own directory, and the nearest one wins when a workspace has both a root settings file and a per project one.
- The same rule now applies to the unused dependency scan and to Find Usages from inside the catalog, which shared the file name matching.

### Notes
- A workspace holding a single project sees no change.
- No new commands or settings in this release.

## 1.42.131

A settings file read twice at once could leave the older content in place, undoing the fix shipped in the previous release.

### Fixes
- Saving settings.gradle.kts often emits several file events, so several rereads start at once. Whichever one finished last was the one that took effect, not whichever started last, so a stale read could overwrite a fresh one and the catalog root would stay wrong until the next event, which may never come. Each reread now carries a sequence number and an older one is dropped.
- A settings file that cannot be read no longer clears what is already known about the catalog roots.

### Notes
- No new commands or settings in this release.

## 1.42.130

Completes the catalog work of the last few releases: a catalog renamed in settings.gradle.kts is now understood by hover and Ctrl+click too.

### Fixes
- Gradle lets settings.gradle.kts rename a catalog, with create("deps") { from(files("gradle/libs.versions.toml")) }, so the file keeps its name while build files write deps.retrofit. Find Usages from inside the toml has always read that, but hover and Ctrl+click took the name from the file alone, so they looked for libs on a project that writes deps and answered nothing. The two halves now read the same rule, and the settings files are watched so an edit takes effect right away.
- The catalog sweep and the settings sweep are independent and can finish in either order, so the roots of catalogs already read are recomputed when settings arrive rather than being fixed once.

### Notes
- A project with no versionCatalogs block in its settings sees no change, verified against a real one.
- No new commands or settings in this release.

## 1.42.129

Hover and Ctrl+click on a catalog accessor got slower two releases ago. They are now faster than before either change.

### Fixes
- Trying every catalog root, added in the previous release, rebuilt the search pattern on every call, and these run on every mouse move over a build file. Measured by alternating passes against the two earlier builds so machine drift cancels out: 34.9 ms before, 59.7 ms as shipped, 23.9 ms now, with the three sets of readings not overlapping at all. The pattern is now built once per catalog name and shared, which also removes a rebuild that Ctrl+click was already paying before any of this.
- The list of catalogs and their names is now computed when a catalog file changes rather than on every lookup.

### Notes
- No visible change other than speed. No new commands or settings.

## 1.42.128

Corrects the previous release, which claimed more than it delivered, and repairs what widening the catalog sweep broke.

### Fixes
- Hover over a catalog accessor still only recognised the name libs. The previous release said hover followed the file name; that was true of Ctrl+click and not of hover, which carried its own hardcoded pattern. It now follows the file name too, so deps.retrofit shows its coordinates.
- A project with two catalogs side by side, for instance libs and testLibs, which Gradle supports and recommends for separating test dependencies, only ever answered for one of them. Widening the sweep in the previous release is what brought the second one into the index, and whichever file was read first won, so libs itself could be the one that stopped working. Hover and Ctrl+click now try every catalog a build file can reach.
- When the same alias name exists in two catalogs, the answer now comes from the one actually written on the line rather than from whichever catalog was read first.

### Notes
- A project with a single gradle/libs.versions.toml sees no change.
- No new commands or settings in this release.

## 1.42.127

Two halves of version catalog support disagreed whenever the catalog file was not named libs.

### Fixes
- A catalog named anything other than libs, for example gradle/deps.versions.toml, was never picked up at all: the sweep that feeds the catalog index looked for that one file name. Colouring, folding and navigation inside the file already worked for it, since those are registered on any versions.toml, so half the feature responded and the other half stayed silent.
- Even once found, the accessor root was always assumed to be libs. Gradle takes it from the file name, so deps.retrofit in a build file resolved to nothing. Hover and Ctrl+click from a build file now follow the file name, and the rule that already served the unused dependency scan is the one they use, rather than a second copy of it.

### Notes
- A project whose catalog is the usual gradle/libs.versions.toml sees no change.
- No new commands or settings in this release.

## 1.42.126

A stray space in kotlinJump.excludePatterns turned the pattern off without saying so.

### Fixes
- A pattern written with a space at either end, easy to leave behind when editing settings.json by hand, stopped matching anything for the file watcher while the initial scan still honoured it. The two disagreed again: those files were indexed once and then never refreshed. Patterns are now trimmed before use, so a stray space changes nothing.

### Notes
- No new commands or settings in this release.

## 1.42.125

One more way to lose the whole extension through a settings file, closed.

### Fixes
- Writing kotlinJump.excludePatterns as a plain string instead of a list stopped the extension from loading. The value is read during activation, and reading it as a list failed there, so every feature went away at once with nothing to see but the extension host log. A lone string is now read as the single pattern it obviously is, and a value of any other shape is ignored instead of being fatal. This completes the previous release, which had learned to skip an empty entry inside the list but still assumed the setting itself was one.

### Notes
- No new commands or settings in this release.

## 1.42.124

Three bugs in how kotlinJump.excludePatterns is read. One of them stopped the extension from starting at all.

### Fixes
- An empty entry in kotlinJump.excludePatterns stopped the whole extension from loading. The matcher is built during activation and an empty string made it fail there, so every feature went away, with the cause visible only in the extension host log. Empty and malformed entries are now skipped.
- A project stored inside a folder named build, generated or .gradle had all of its own files treated as excluded, so the extension went quiet across the entire workspace. Exclusion patterns are relative to the workspace folder, and they are now matched that way instead of against the full path on disk.
- The dead code sweep reached its file cap on build output, then reported that files had been skipped and suggested raising kotlinJump.maxIndexedFiles, which was never the cause. It now excludes before asking for the file list, the way the rest of the extension already did. On a real project of 10014 candidate files, 5088 of them actual sources, the sweep skipped 4 real files and showed that warning on every run. It now reads all 5088 and stays well under the cap.

### Notes
- No new commands or settings in this release.

## 1.42.123

Fixes two bugs that let generated build files bypass the extension's exclusion patterns, so they no longer get indexed or watched by mistake.

### Fixes
- Restores file exclusion when kotlinJump.excludePatterns holds a single entry. That entry was silently ignored by the initial scan, while the file watcher applied it correctly, so the excluded files were indexed once and then never refreshed. On a real project of 10064 source files, setting one exclusion pattern indexed all 10064 instead of 5138.
- Fixes the default build and .gradle exclusion missing files sitting directly at the project root, the usual layout of a Gradle project with a single module.
- Both bugs came from the same place: the initial scan has to fold the whole list into one pattern, and it folded it wrong. Scan and watcher now agree on every list of patterns, and a test holds them to it.

### Notes
- No new commands or settings in this release. The fix only changes which files get indexed and watched.

## 1.42.122

The scanner keeps a count of the work it has in flight, and the watcher waits on it to redo a folder deletion once indexing settles. Nothing checked that the count comes back down.

### Internal
- If that count were left hanging, the wait would never end and the second sweep after a folder deletion would stop happening, without a single test failing: every watcher test supplies its own stand in for that signal, so none of them can see the real one. It is now checked on the paths that are not the happy one, an unreadable file, a batch with one bad file among good ones, and a scan cancelled by the next one.
- Also checked: the wait really waits. Returning immediately would have made every one of those checks pass while removing the delay the whole mechanism is built on.
- Driving the watcher through seven hundred mixed events with real background threads leaves the index equal to the filesystem and the count back at zero, on every seed tried.

## 1.42.121

Yesterday's repair to the parsing threads was covered from every angle except the one that runs in production: a pool whose threads are alive.

### Internal
- Every test written yesterday exercised a dead pool. Had the repair broken the working path, parsing would have quietly fallen back to the main thread, correct but slower, and no test would have said a word. The pool now takes its worker path as an argument so a test can point it at the built file, and the working path is covered: a real parse through a thread, twelve jobs sharing three threads with each answer reaching its own caller, and a thread reused once the queue drains.
- That last one matters more than it looks. Twelve jobs on three threads pass even when threads are never returned to the pool, because each finishing thread picks the next job directly. It is the request after the queue empties that waits forever, and only that request reveals it.
- Nothing changes for anyone using the extension.

## 1.42.120

Kotlin files are parsed on background threads. If the file holding that background code is missing, the extension used to index nothing at all, silently and for as long as the window stayed open.

### Fixed
- A missing or unreadable parser worker no longer stalls indexing. Node does not report a missing worker file when the thread is created; it reports it a moment later. The code was written expecting the opposite, so its fallback to parsing in the main thread, which the comment promised, never engaged. The dead thread went back into the pool, work was handed to it, and Node accepts that silently while the answer never comes.
- Every Kotlin file therefore waited forever. No error, no diagnostic, an extension that simply did nothing. A partial install, a build that did not finish, or an antivirus quarantine is enough to reach it.
- Work already waiting when the last thread dies is now released rather than left hanging, and parsing falls back to the main thread, which is what it did before background threads existed.

## 1.42.119

A folder deleted while the project is being indexed gets a second sweep once the indexing settles. That sweep worked from the folder list captured earlier, so a file put back in the meantime was swept away with the rest.

### Fixed
- A file recreated after its folder was deleted, and before the indexing finished, is no longer removed. It stayed on disk while navigation lost track of it until the next edit. Checking out a branch that deletes a directory and restores one of its files is enough, and so is a build tool that clears a folder and repopulates it.
- Each deletion and each recreation now carries its rank, so the sweep can tell which came last instead of assuming the deletion did.

### Internal
- The storm test that was meant to cover exactly this could not: its stand in scanner reported that it was never busy, so the second sweep never ran in any test. It now reports its activity, and removing the fix fails the storm as well as the new case.

## 1.42.118

Yesterday's fix replaced a counter of events with a plain question, is this file deleted right now. The counter was left behind: still written on every deletion, read by nobody.

### Internal
- Removes a map that grew by one entry per deleted file for the whole session and fed no decision. The test that forbade walking it was therefore guarding a property with no consequence; it now guards the set that replaced it, which is the only one left that can grow with the session.
- The marks that let the watcher tell two overlapping scans apart are released on both exits rather than only on success. A scan finishing last while considered outdated used to leave its mark behind for good.
- Nothing changes for anyone using the extension.

## 1.42.117

Saving the same file twice in quick succession could make it vanish from the index. It was still on disk, still open, and navigation no longer knew about it until the next edit.

### Fixed
- Two scans of one file can overlap, because a scan reads the file and then hands it to a worker thread while a second save arrives. Each scan wrote its result, then every scan the watcher considered outdated erased the entry, including the one a current scan had just written. The watcher now asks whether the file is deleted right now, rather than whether anything at all has happened to it. A save needs no such safety net: the next scan rewrites the entry, and erasing it undoes that work.
- The same confusion cost files during a burst. Driving the watcher through three thousand interleaved creations, deletions and folder removals left files on disk that the index had lost, on every seed tried. The index and the disk now match exactly.

### Internal
- That storm is now a test: it drives the watcher through six hundred mixed events and requires the index to equal the filesystem, no ghost and nothing missing. Restoring the previous guard fails it.

## 1.42.116

The replay added yesterday, so a folder deleted during the first scan does not leave files behind, ran once per deleted folder. Each run re reads the whole index, so a wave of deletions read it a second time from end to end.

### Fixed
- A wave of folder deletions during a scan is now taken up in a single pass. Two hundred deletions on a fifty thousand file index cost 853 ms of frozen extension host and now cost 464 ms; on a five thousand file project, 84 ms became 47 ms. Membership is decided by walking a path up to its parents, a handful of lookups, instead of testing every deleted folder against every file.

### Corrected
- The note published with version 1.42.113 claimed that deleting folders had gone from 406 ms to 0.1 ms. That measurement was taken against an empty index and left out the pass that dominates. The honest figure is that the read of the whole index remains, at 0.2 ms per deletion on a five thousand file project and 2.1 ms on fifty thousand. What that release did fix was a second pass whose cost grew with everything the session had ever seen, which is the part that had no ceiling.

## 1.42.115

Six releases went into stopping a deleted file from coming back. Listing every state a file can be in turned up one the watcher cannot see at all: the files of the very first scan, which runs without going through it.

### Fixed
- Deleting a folder while the extension is still indexing the project no longer leaves its files behind. Switching branch just after opening a workspace was enough: a file whose bytes had been read was added to the index moments after its folder was gone, and nothing removed it afterwards. Cmd+T then listed a file that no longer existed.
- Only the files caught mid parse were affected. One not yet read fails its read and is dropped; one already added is found and removed. The hole was the handful in between.
- The removal is replayed once the scan finishes rather than filtered file by file, so nothing is checked on the indexing path and the cost stays where it was.

## 1.42.114

Yesterday's fix narrowed what a folder deletion looks at, from every file ever seen down to the scans actually running. It narrowed it one notch too far and dropped the files still waiting in the queue.

### Fixed
- Deleting a folder now also cancels the scans queued for its files. A file created moments earlier is not in the index yet and its scan has not started either, so neither of the two lists checked yesterday contained it: the queue fired afterwards and indexed a file whose folder was gone. Deleting a folder in the Explorer while the editor is still settling is enough to hit it.
- The queue holds only what one debounce window collected, so consulting it costs nothing. Folder deletion stays flat at 0.1 ms whatever the session has seen.

## 1.42.113

To catch a file being scanned at the moment its folder is deleted, the watcher was re reading every file it had ever seen an event for. That list only grows.

### Fixed
- Deleting folders is no longer slower the longer the session has run. Two hundred folder deletions, which is what a branch switch or a clean produces, took 406 ms of frozen extension host once fifty thousand files had been seen. It now takes 0.1 ms, and the cost no longer depends on how much has happened before.
- The watcher tracks the scans actually running rather than the whole history. Detecting a scan in flight never needed more than the handful running at that instant.

## 1.42.112

The test written yesterday to keep folder scanning linear counted array scans and required the count to be zero. Zero is also what a function that does nothing counts.

### Internal
- That test now proves the work happened before it certifies how it was done. Emptying the function it guards, or deleting the sort it watches, both left it green; it only ever failed on the quadratic version. It now checks that the sort ran and discarded the one file that went stale during the batch, so all three ways of breaking the code fail it.
- Nothing changes for anyone using the extension. This is a guard that was guarding half of what it claimed.

## 1.42.111

Yesterday's release pinned a linear pass with a stopwatch. Under a busy machine that stopwatch reads ten times higher, so the test was a release blocker waiting to happen, which is exactly the kind this week has been spent removing.

### Internal
- The test that keeps folder scanning linear now counts array scans instead of milliseconds. Measured on a loaded machine, the timing version failed at 60 ms against a 50 ms bound while the work itself was fine; the counting version passes there and still fails the quadratic version, reporting thirty thousand scans where zero are allowed. A count does not move with the load.
- The growth ratio was tried first and rejected on measurement: between two runs it swung from 1.7 to 11.9 on a loaded machine, less trustworthy than the absolute bound it was meant to replace.
- The last asynchronous stopwatch assertion in the suite is gone, now that a budget can wrap an await.

## 1.42.110

The guard added yesterday, so that a file deleted mid scan does not come back, sorted its survivors with a lookup inside a loop over the same list. That is quadratic, and nothing moves in the ordinary case, so the ordinary case was the worst case.

### Fixed
- Adding a folder, which is what a rename or an added workspace folder does, is linear again. At the default ceiling of 10000 files it went from 12.2 ms of blocked extension host to 2.6 ms, and a project that raises that ceiling to 24000 went from 66 ms to 8 ms.
- A test pins the shape rather than the number: 30000 files under a bound that one pass clears with room to spare and that the quadratic sort blew past six times over.

### Internal
- Timing budgets can now wrap an asynchronous workload. Until now a budget on an await had to stay a bare wall clock assertion, the kind that stopped two releases this week.

## 1.42.109

Deleting a file while the extension was still reading it left the file in the index. Cmd+T went on listing it and Cmd+click opened a file that no longer existed.

### Fixed
- A file deleted while its scan is in flight is no longer brought back. The scan reads the file, then hands the text to a worker thread to parse, so the window between the two is tens of milliseconds wide, not a hair. A delete landing in that window removed an entry the scan had not yet written, and the scan wrote it afterwards.
- The same held during a checkout, when hundreds of files are scanned in a row, and when a whole folder is deleted: a folder removal looked for its files in the index, and a file being scanned right then is not there yet, so it survived the removal of its own folder.
- Every event on a file now stamps it, and a scan whose stamp moved while it was running is discarded. An edit made during a scan still wins: the stale read is dropped and the newer one is kept, so no keystroke is lost.

## 1.42.108

The accessor root of a version catalog is not always libs. Gradle takes it from the catalog file name, so deps.versions.toml is reached as deps, and a create block in settings renames it again. The navigation assumed libs every time.

### Fixed
- Ctrl+click on an alias of a catalog whose root is not libs now finds its usages. It found none at all: two of the three shapes a project can have returned nothing where there was one usage. The root is now read the way the unused dependency scan already read it, from the catalog file name and from the create block in settings, rather than assumed.
- A catalog declared in Kotlin rather than in TOML now yields nothing instead of a wrong answer. Its aliases cannot be known from the file, and that is the same silence the unused dependency scan keeps.
- The settings files come out of the sweep that already reads the build files, so none of this costs an extra read.

### Internal
- The documentation of the timing budget helper had been left attached to an interface added above it, so hovering the helper itself showed nothing.

## 1.42.107

The previous release lined the catalog navigation up with the unused dependency scan and claimed the two could not drift apart again. That was true of three of the four tables: the versions table was left behind.

### Fixed
- Ctrl+click on a key of the versions table now reaches the build files that read it, through libs.versions.key or through findVersion, on top of the catalog entries that pin their version on it. A key used only from a build file opened onto nothing, while the scan considered it perfectly alive.
- Shift+F12 on a key, or on any reference to it, lists the declaration first and then every use, inside the catalog and outside it.
- Shift+F12 had no test of its own until now, on any table.

### Internal
- Thirteen more timing budgets are judged on the fastest of up to three runs. Version 1.42.99 converted the first thirteen for exactly this reason and missed these, and one of them stopped a release tonight on a machine whose load average had climbed to 24. The whole suite now passes under a load of 38.
- The budget helper gained a reset hook, run before each attempt and left out of the measurement, for the tests that feed a counter a later assertion checks. Without it three attempts would treble the count and break the very assertion the budget protects.
- Six timing budgets were deliberately left alone: replaying their work would measure a no operation, a warm cache, or would break an assertion that runs before the measurement. A budget that passes for the wrong reason is worse than one that occasionally needs a retry.

## 1.42.106

Two features answer the same question about a build file: Ctrl+click on a catalog alias shows where it is used, and the unused dependency scan decides whether it is used anywhere. Shipped a day apart, they disagreed four ways out of five.

### Fixed
- A commented out accessor is no longer a usage. An alias the scan reported as dead would open onto a line someone had commented out, which is the very line the scan is meant to flag.
- A lookup by name is now a usage. An alias reached only through findLibrary or findPlugin said no definition found, while the scan considered it perfectly alive.
- Both now go through the same comment blanking and the same name matching as the scan, so the two cannot drift apart again. The blanking keeps every character offset, so the positions the jump lands on stay exact: measured on 1295 usages of a real project, not one is off.

## 1.42.105

Ctrl+click worked from a build file into gradle/libs.versions.toml, and once you were there every name was a dead end. The catalog was a destination and never a departure.

### Added
- Ctrl+click on a version.ref target lands on the line of the versions table that declares it, one hop inside the same file.
- Ctrl+click on an alias lands on the build files that use it. On a project of 5088 files, navigation-safeArgs resolves to the three modules that declare the plugin. Several usages open the list VS Code shows for a multi target jump, and Shift+F12 gives the same list.
- Ctrl+click on a key of the versions table lands on the entries that pin their version on it, which is the question worth asking before changing a number.
- Accessors are matched segment by segment the way Gradle resolves them, so the dash, the underscore and the dot are one separator, and an accessor carrying an extra segment is a different entry. Measured on the same project: 171 of the 176 aliases resolve to at least one usage, and the five that do not are absent from every build file.

## 1.42.104

The build script called the benchmark and maintenance bundles dev only, excluded from the package. They were not excluded, and neither were the compiled end to end suites, the web test harness, or the TypeScript sources of the logcat panel.

### Fixed
- Stops shipping 14 files that exist only for development. The extension you install no longer carries its own test suites, its benchmark, or the sources of a panel whose bundle is what actually loads.
- A test replays the packaging rules and fails if any of them come back. It checks the other direction too, so an over broad rule that dropped the bundled standard library, a walkthrough video or a runtime bundle fails just as loudly.

### Added
- Tests for the layer that hands the version catalog colours and fold ranges to the editor. Those leave as a delta encoded array of integers, where a swapped argument or a shifted legend index still produces a well formed array that colours the wrong thing. The array is now decoded back and compared with the text it came from.

## 1.42.103

When ktlint wraps a long class header, the primary constructor lands on the line below. The parser only ever recognised a constructor sharing the header line, so the properties of a wrapped one were not misfiled, they were absent.

### Fixed
- Reads a primary constructor written under its class header, whether it is a bare constructor on its own line, one carrying modifiers, or the Dagger shape with the annotation on a line of its own. On a project of 5088 files: 42 such sites, 37 properties that no feature could see, now indexed. Measured on the same project after the fix: 37 recovered, 0 symbol lost, 0 added anywhere else.
- The stored index and the bundled standard library index are both rebuilt, so the properties appear on upgrade instead of waiting for each of the 13 affected files to be edited.
- The guard that pins what the parser writes to disk did not cover this shape, so it stayed silent on a change that reaches the disk. Its fixture now carries the wrapped form, and neutralising the fix makes it fail.

## 1.42.102

VS Code ships no TOML grammar, so gradle/libs.versions.toml opens in a single colour, and the fold arrows never appear because the fallback folding needs indentation that TOML does not have.

### Added
- Colours the version catalog. The table headers, the alias on the left of each entry, the version literals, the coordinates and the trailing comments each get their own colour. A string that follows version.ref is coloured as a reference rather than as one more string, so an entry and the version it points at read as a pair.
- Folds the version catalog. Each table collapses to its header, and a bundle written over several lines collapses on its own. Checked on a real catalog of 293 lines: three tables, no token crossing a line boundary or another token.
- Both apply to any file named like a catalog, so a TOML extension installed alongside keeps every other .toml file to itself.

### Fixed
- The mapping from semantic tokens to theme colours was declared for every language while all of it named Kotlin scopes. It is now declared for Kotlin, which is where it belongs, so tokens coming from any other file reach the colour the theme gives them.

## 1.42.101

The Kotlin standard library index shipped inside the extension is built once by hand and committed. Nothing ever invalidates it, so it stayed on the reading the parser had at version 1.22.0, 120 releases ago.

### Fixed
- Rebuilds the bundled standard library index. 238 of its 326 files disagreed with the current parser: 210 declarations were missing, among them Enum.name, Enum.ordinal, Enum.compareTo and the companion objects of Boolean, Char and the primitive types, so none of them could be reached by Go to Definition or listed in the Outline of a standard library source.
- Fixes 206 wrong parent types in that same index. The type argument was being read as a parent, so List had E for a parent alongside Collection, and Boolean was its own parent. Type Hierarchy on a standard library type showed both.
- A test now reparses every source the index carries and compares it to what the index stores, so this artifact can no longer drift behind the parser without the suite saying so.

## 1.42.100

The index kept on disk is only reread when a file's date or size moves. Three parser fixes changed how declarations are read without invalidating that index, so an upgrade kept the old reading of every file left untouched.

### Fixed
- Upgrading now rebuilds the index once instead of restoring a reading the current parser no longer agrees with. Measured on a project of 5088 files: 43 files came back with 45 wrong parent types, one class listed as its own parent, and 6 declarations missing from the Outline, from Go to Definition and from Find Usages.
- A recorded reference now pins what the parser writes to disk, so the next parser change cannot ship without the index version that discards the stale copies.

## 1.42.99

Thirteen tests asserted a wall clock budget, some as low as 50 milliseconds. The publish script runs the suite, so a busy machine stopped a release that had nothing wrong with it.

### Internal
- The timing budgets in the test suite are judged by the fastest of up to three runs. A first call carries the warm up of everything it touches: 28 milliseconds cold against 7 warm on a calm machine, 108 against 17 on a busy one. One publish had already stopped on 422 milliseconds against a 300 millisecond budget while the steady state cost of that workload is 5 milliseconds.
- The retry only happens when the first run misses, so a calm machine pays nothing: measured over interleaved pairs the suite takes the same time it did.

## 1.42.98

Fixes the get_file_symbols MCP tool returning empty results for file paths that connected AI agents commonly produce.

### Fixes
- Fixes the get_file_symbols MCP tool returning an empty array, instead of the file's real symbols, for relative paths, paths with . or .. segments, or doubled slashes, all of which an AI agent produces routinely when it joins paths itself.
- Fixes a double encoding bug where a file path containing a space (as %20) stopped matching its own indexed entry, hiding that file's symbols from connected AI agents.
- Adds regression tests covering these path forms, keeping get_file_symbols reliable for AI agents that query documentation and symbols through the MCP server.

### Notes
- No changes to editor commands or settings in this release.

## 1.42.98

Asking the MCP server for a file's symbols only worked with the exact absolute URI. A path relative to the project, one holding a dot segment, or one with a doubled slash returned an empty array, which reads like a file with nothing in it.

### Fixes
- `get_file_symbols` resolves the path it is given against the project root and normalises it, so a relative path, a dot segment, a parent segment and a doubled slash all reach the same file. An agent works in project relative paths, because that is how it reads and writes files.

## 1.42.97

Kotlin Jump 1.42.97 fixes a regression from 1.42.96 where the get_kdoc MCP tool wrongly marked companion objects and anonymous object implementations as stale, hiding their documentation from connected AI agents."

### Fixes
- Fixes the get_kdoc MCP tool marking a companion object's or an anonymous object implementation's documentation as stale even when nothing moved: their names never appear literally on the declaration line, and the freshness check added in 1.42.96 required an exact match, so their KDoc came back empty instead of reaching the connected AI agent.
- Adds regression tests covering both symbol shapes, keeping get_kdoc reliable for AI agents that read documentation through the MCP server.

### Notes
- No changes to editor commands or settings in this release.

## 1.42.97

The freshness check added in 1.42.96 asks for the symbol's name on its line. A companion object is recorded under `Companion` and an object expression under a made up name, so both were declared out of date where they actually sit.

### Fixes
- The freshness check knows the two names the parser invents and looks for the keyword instead. On a real Android project, asking every one of 47982 symbols for its documentation against an unchanged file now reports none as out of date, and shifting every file by one line still catches 96 percent of them.

## 1.42.96

Fixes an MCP tool returning stale documentation after edits and a workspace scan limit that wasn't enforced.

### Fixes
- Fixes the get_kdoc MCP tool returning another symbol's documentation after a file is edited: once lines shift, the tool now checks that the recorded line still declares the requested symbol and returns null (flagged as stale) instead of a confidently wrong answer to the connected AI agent.
- Fixes workspace scanning exceeding the configured maxIndexedFiles limit: a check ran before an asynchronous file read completed, letting many files past the cap before it took effect. The limit is now enforced consistently, keeping indexing time and memory predictable on large projects.

### Notes
- No changes to editor commands or settings in this release.

## 1.42.96

Asking the MCP server for a symbol's documentation read the file from disk but looked at the line the index remembered from startup. Deleting a function above made the next one slide onto that line, and its documentation came back as the answer.

### Fixes
- `get_kdoc` checks that the recorded line still declares the symbol before reading its comment, and reports a stale position instead of a neighbour's documentation. An agent that edits then asks was getting a confident wrong answer.
- The limit on how many files a scan walks is now respected to the file. It was tested before the file was stat ed, inside a burst that started every entry of a directory at once: asking for one file collected 360 of them, and on a real Android project a limit of 1000 let 1803 through.

## 1.42.95

Fixes a parsing bug where a parenthesis inside a string or character literal caused the Type Hierarchy view to drop a class's real supertypes.

### Fixes
- Fixes the Type Hierarchy view dropping a class's supertypes when a constructor parameter holds a string or character literal containing a parenthesis, for example `val sep: String = ")"`. The parser read that character as the constructor's closing parenthesis and stopped before reaching the actual supertype list.
- Adds regression tests covering string literals, character literals, and escaped characters inside constructor parameters, so the Type Hierarchy view keeps matching the class as written.

## 1.42.95

The depth counting added in 1.42.94 read every parenthesis, including the ones inside a string or a character literal. A default value holding a closing parenthesis ended the constructor in the middle of its own parameter list.

### Fixes
- Parentheses inside a string or a character literal are skipped when the header is measured, escapes included. Four shapes of valid Kotlin emptied the supertype list before, `val sep: String = ")"` among them.

## 1.42.94

Fixes two more cases where the Type Hierarchy view dropped a class's real supertypes.

### Fixes
- Fixes the Type Hierarchy view dropping a class's supertypes when a constructor parameter's function type is written across several lines: the parser mistook that type's closing parenthesis for the end of the constructor.
- Fixes the same view missing a class's supertypes when a comment follows the constructor's closing parenthesis, a valid Kotlin style the parser previously read as an unclosed header.
- Adds regression tests covering both shapes, alongside the supertype fixes from previous releases, keeping the Type Hierarchy view aligned with what the code actually declares.

## 1.42.94

The header was cut at the first line beginning with a parenthesis. A parameter whose type is a function written over several lines closes with one too, and a trailing comment blocked the reading, so the supertype list was dropped.

### Fixes
- A supertype list survives a parameter whose type is a multi line function, and a comment after the closing parenthesis. Both are valid Kotlin and both silently emptied the list.
- The line that closes the constructor is found by counting parentheses inside it. Writing the parent's own arguments on that same line, as in `) : Base(`, leaves the depth unchanged at the end of the line and says nothing about where the header stops.

## 1.42.93

Kotlin Jump 1.42.93 fixes a case where the Type Hierarchy view could miss a class's supertypes when the constructor and the supertype list were on separate lines.

### Fixes
- Reads the supertype list correctly when Kotlin puts it on the line after the constructor's closing parenthesis, a valid style the parser previously mistook for a header with no supertypes.
- Adds regression tests covering wrapped and same-line supertype lists, so a class's superclass and interfaces keep showing up correctly in the Type Hierarchy view.

## 1.42.93

The stop added in 1.42.92 ended the header at any line beginning with a parenthesis. Kotlin also lets the supertype list lead the line after it, and those supertypes were dropped without a sound.

### Fixes
- A constructor closing on a bare parenthesis no longer ends the header. Only the very next non blank line may carry the supertype list, which keeps the fix from reaching a colon that belongs to something further down: the 50 supertypes wrongly taken from a method return type on a real Android project are still refused.

## 1.42.92

Fixes two Type Hierarchy bugs: a sealed class listing itself as its own supertype, and a type listing itself as its own implementation (which could loop when expanded).

### Fixes
- Fixes a sealed class appearing as its own supertype in the Type Hierarchy view. The parser kept reading past a constructor with no supertype list and picked up a nested variant's supertype instead, which put the sealed class under its own name. This affected 32 types on a real Android project.
- Fixes the Type Hierarchy view listing a type as its own implementation, for example an interface that extends a generic type qualified by an enclosing class. Expanding that entry used to loop indefinitely; it now resolves correctly.
- Adds regression tests for both issues so they cannot come back unnoticed.

## 1.42.92

A class with a multi line constructor and no supertype list borrowed one from the first declaration below it, usually a method's return type. A sealed class ended up extending itself and the type hierarchy listed it as its own subtype.

### Fixes
- A supertype list is read only until the constructor closes. On a real Android project 50 supertypes were taken from a declaration further down, every one of them a method return type; the sealed classes among them ended up extending themselves, which put them under their own name in the hierarchy.
- The type hierarchy asks the same question as the lens and Go to Implementation. It still used a package heuristic and never excluded the type itself, so 21 types were listed as their own subtype and expanding one looped.

## 1.42.91

Kotlin Jump 1.42.91 fixes an unnecessary full file scan in Call Hierarchy lookups, removing a 9 percent slowdown on that path.

### Improvements
- Stops the enclosing-function search as soon as no shallower candidate remains, instead of continuing to the start of the file. This removed a 9 percent overhead on that lookup path.
- Adds regression tests covering both a call with no enclosing function and one with a real, deeply nested enclosing function, so this fix cannot silently regress.

## 1.42.91

The walk added in 1.42.90 to find the enclosing function scanned every symbol back to the top of the file, even when there was nothing above to find.

### Fixes
- Opening the Call Hierarchy on a heavily called symbol does less work. A top level function has nothing enclosing it, and once a top level candidate has been weighed there is nothing shallower left; without those two bounds the walk cost 9 percent of that path on a real Android project. The answers are unchanged, caller for caller, across 4014 of them.

## 1.42.90

An annotation on the receiver of an extension made the whole declaration invisible. Those functions were absent from the Outline, unreachable by name, and had no definition to go to.

### Fixes
- An extension whose receiver carries an annotation is indexed like any other. `fun @receiver:ColorInt Int.darken(n: Int)` is valid Kotlin and the reader stopped at the annotation; six functions in one file of a real Android project existed for no feature at all, and they count as extensions again.
- The Call Hierarchy names the enclosing function. The last function before a call can be an override nested in an object expression that already closed, and the panel then fell back on the last local variable: it announced `end` as the caller of `start`. Wrong callers went from 74 to 3 on that project.

## 1.42.89

A property and the object it holds are declared on one line, and the object was cut to that single line. Its overrides left it in the Outline, folding it folded nothing, and an empty duplicate sat next to the property.

### Fixes
- A symbol declared on the same line as another cannot close that one's body. The object expression stopped where the property that names it begins, which is the same line, so it was one line tall. 111 of them on a real Android project.
- The Outline lists the name you wrote rather than both. The property and the object describe one construct and had the same extent, so one of the two was always empty. An object passed straight to a call still shows as `object : Listener`.

## 1.42.88

Three more shapes of Kotlin header were read as a finished declaration, so the class ended on its first line and its members were listed at the top level of the Outline. What was 211 entries two releases ago is now 3.

### Fixes
- A brace inside a parameter list is never the body. The empty lambda of a default argument, as in `sealed class State(init: Builder.() -> Unit = {})`, was counted as the class body opening and closing at once, and all 42 members of one class hung outside it.
- A header that goes on with `constructor`, with a supertype list, or with a `where` clause is read to its end. `open class Foo` on one line and `constructor(...)` on the next is what ktlint produces once the header is long.
- An annotation between the class name and its constructor belongs to the header, not to whatever follows. The two readings of an annotation now depend on whether a class header is still open.
- Folding a file costs what it did before. Reading the next line on every line of every declaration had doubled it.

## 1.42.87

1.42.86 taught the reader that a comment introduces what follows it. Inside a primary constructor that is false, so an annotated data class ended on its first line and its properties climbed to the top level of the Outline.

### Fixes
- A comment or an annotation introduces the next declaration only outside a parameter list. Inside a primary constructor it introduces the next parameter, which still belongs to the class. On a real Android project 211 entries sat at the top level of the Outline instead of inside their class, and now 57 do, fewer than the 151 that predate 1.42.86.
- A parameter no longer swallows the annotation of the one after it either, so folding the first stops hiding the second one's SerializedName. 712 declarations reached into their neighbour, now 86.

## 1.42.86

A class written the way ktlint wraps an injected constructor was read as one line long. Folding it folded nothing, and every one of its members hung outside it in the Outline and the breadcrumbs.

### Fixes
- A declaration whose header wraps after an annotation covers its whole body. `class Foo @Inject` on one line and `constructor(...)` on the next is the shape Dagger imposes; on a real Android project 154 classes ended on their first line.
- The Outline nests by what actually contains what. An object expression inside an init block was filed under whichever property came last, and the breadcrumb read Holder then disposable then the object. 202 nodes sat outside their parent, now none.
- One chevron per line. A property declared in a primary constructor sits on its class's own line and produced a second fold that stopped partway through the class, so folding the class folded a fragment. 181 lines carried two.
- A parameter no longer swallows the documentation of the one after it, which made its fold cross the comment's own.

## 1.42.85

Hiding object expressions from search was done after the result cap, so on a real project a search for anon spent 199 of its 200 slots on them and showed one match where eleven exist.

### Fixes
- Object expressions are left out inside the search itself, ahead of the cap, the way local variables already were. A search for anon on a real Android project returned one result and now returns the eleven that match, MyAnonHelper among them.
- Filtering by kind gained the same treatment: object: listed 85 singletons and now lists 98.

## 1.42.84

The internal name given to an object expression was reaching the screen. One real Android project showed 275 of them in the Outline, and searching anon in Go to Symbol returned nothing else.

### Fixes
- The Outline and the breadcrumbs name an object expression after what it implements, as in object : ViewTreeObserver.OnPreDrawListener. 275 nodes across 172 files read $anon$25 before, and clicking one selected whatever text happened to follow the keyword.
- Go to Symbol in Workspace leaves them out. Typing anon returned 200 of them and nothing else, so a class actually called AnonymousUser was unreachable by name.
- The type hierarchy uses the same wording as the Outline instead of its own.
- The count of implementations still sees them: nothing was hidden from the index, only from the panels.

## 1.42.83

What 1.42.82 corrected was thrown away by the saved index. Every count went back to its old wrong value on the next window reload, until each file happened to be edited.

### Fixes
- The saved index carries the qualifier of a dotted supertype. Without it, reopening the window rebuilt the hierarchy the old way and a nested interface named View claimed 51 classes again. Indexes written before this are rebuilt instead of trusted.
- A class implementing two nested interfaces of the same name, one from each of two outer types, is now counted by both. Only the first was credited.
- A new test compares a fresh index against a saved and restored one field by field, so the next field added without being written to disk fails the build. This had already slipped through twice.

## 1.42.82

A supertype written Outer.Inner was filed under both names, so a type of the workspace sharing a name with a framework one claimed its children. On a real Android project, 165 types were over counted by 2020 implementations in total.

### Fixes
- A supertype written Outer.Inner names one parent, Inner. Both segments used to enter the hierarchy, so a nested interface called View claimed the 51 classes that extend android's View, and a nested ViewHolder claimed 92.
- An explicit import decides what a simple name means, which is what Kotlin does. Only types declared in the workspace were consulted, so importing a class from a library contradicted nothing and the local namesake took the credit.
- A type is no longer its own subtype. One Java class extending RecyclerView.ViewHolder was filed under its own name, became its own descendant, and dragged 92 classes into three unrelated counts.
- The qualifier still counts for spotting a framework ancestor, so nothing new is reported as unused: the dead code scan returns the same 152 symbols on that project.

## 1.42.81

Go to Implementation had stopped answering for any type declared outside the workspace, jumping into a version catalog broke on the web, and a constant could be treated as a type.

### Fixes
- Go to Implementation works on a type that lives in a dependency. Put the cursor on ViewModel, AppCompatActivity or WebViewClient and the classes extending it come back, subclasses of those included. 1.42.79 asked for a local declaration of the parent first, which emptied the list for 250 names and 1145 classes on a real Android project.
- Jumping to an accessor declaration keeps the scheme of the file it came from, so it works on vscode.dev where a workspace is not on disk.
- A value is never implemented by anything. A constant sharing its name with a type from a dependency could send Go to Definition into that type's subclasses.

## 1.42.80

Ctrl+click an accessor in a build file and land on the line that declares it. Plugins, versions and bundles now answer too, not only libraries.

### New
- Go to Definition works on a version catalog accessor from a build.gradle.kts or a build.gradle. The first segment picks the section the way Gradle does, so a plugin named ksp and a library named ksp.api never lead to each other.
- The longest alias wins: with androidx and androidx.core both declared, libs.androidx.core opens the second one.
- Hover reads the same four sections. A plugin shows its id and resolved version, a version its literal, a bundle its members. Only libraries answered before, so a line of plugin aliases was silent.
- Measured on a real Android project: 1295 accessors across 49 build files, every one of them resolved.

## 1.42.79

The count started reading the whole supertype chain in 1.42.77 while every list stayed on direct supertypes. On a real Android project, 133 types announced a number the click could not show, in both directions.

### Fixes
- Go to Implementation, the picker behind the lens and the arrow lens follow the whole chain. Two lenses could sit on the same line with different numbers, one saying 2 implementations and the other saying 1.
- An implementor of a class that only shares its simple name no longer counts for the wrong parent. One module read 1 implementation that belonged to a namesake in another package, and two nested interfaces sharing a package were merged into one list.
- The count leaves out test doubles when you are reading production code, which is what the list already did. 35 types on that project counted an implementor the picker then refused to show.

## 1.42.78

An implementation written as `object : Interface` was counted only when the line started with a declaration keyword. On a real Android project, 79 of 276 anonymous implementations were invisible, and the Dagger form was one of them.

### Fixes
- An anonymous implementation is read wherever it sits on the line. It used to be found in two places only, so `return object : Sink {`, `.setListener(object : AnimatorListenerAdapter() {` and the Dagger `= object : X {` were all skipped. 79 of 276 sites on a real project, 23 interfaces whose count was too low.
- AudioRepository went from 3 to 5, AdProvider from 1 to 3, AdCallbacks from 3 to 5.
- A trailing comment or a string literal that happens to spell `object :` no longer counts as an implementation.

## 1.42.77

The count only read direct supertypes. A class implementing an interface through an intermediate class was not counted, so one interface read 2 implementations where 33 classes implement it.

### Fixes
- The implementation count walks the whole supertype chain. Only classes naming the interface directly were counted, which on a real Android project left 60 interfaces out of 394 under reported, one of them showing 2 instead of 33.
- Each hop is checked the same way a direct one is, so an interface of the same name in another package never walks into the result, and a cycle in the supertypes stops instead of looping.
- Walking all 394 interfaces of that project takes 5 ms, and the walk is bounded in case a hierarchy ever goes wild.

## 1.42.76

An interface method with three implementations and one caller read 8 usages. Five of them were the override lines themselves, already counted on the left as implementations.

### Fixes
- The usage count above an interface method no longer counts its implementations. The filter only removed declarations sharing the same fully qualified name, and an override carries its own class in that name, so it slipped through.
- The Find Usages panel drops the same lines, so the list shows the calls you were looking for instead of the overrides you already see on the implementations side.
- Measured on a real Android project across 40 interface methods: 175 entries removed, every one of them a declaration line, and no call lost.

## 1.42.75

The rule added last release read the argument text as the provider hands it over, comma and closing paren included, so it recognised a literal only by luck. It caught one case out of eight.

### Fixes
- The argument text is trimmed of the trailing comma and closing paren before the check. The helper that produces it stops at the next argument, so a literal almost never arrived in a shape the rule could read.
- A comma inside the string is left alone, and a nested call stays an expression, so nothing new is dropped: eight labels removed, all verified wrong, none correct lost.
- One adversarial test built its fixture on invalid Kotlin, passing 42 to a String parameter. It checks cache isolation, so the type was made consistent and the check it performs is unchanged.

## 1.42.74

Argument labels are dropped when the literal you wrote cannot be the type the parameter declares. Timber.wtf with a message showed throwable, because the call had resolved to another declaration of the same name.

### Fixes
- An argument label is hidden when the literal written at that position cannot be the declared type. Resolving a call by name is what this extension does without a compiler, and this is the one mismatch the text alone can prove.
- The check only decides on literals and on plain types. A generic, an unknown type, Any, an expression or null leave the label untouched, so nothing is dropped on a guess.
- One label removed on a real Android project of 17170, and none lost. The rule guards the whole class, not that one line.

## 1.42.73

The previous release listed which kinds of symbol a call may resolve to, and the list was short. Sealed parents and enum constructors fell out of it and lost every argument label.

### Fixes
- Argument labels are back on sealed parents and enum constructors. Naming the callable kinds was too narrow twice over, so the rule is reversed: a call resolves to anything except a val, a var or a typealias, and never to a local binding.
- The fix that this repairs, from the previous release, is kept: a local variable of the same name in another file no longer supplies invented parameter names.
- Measured on the whole of a real Android project rather than a sample of it. The sample said nothing was lost; the full corpus showed 34 labels gone.

## 1.42.72

An argument label could be lifted out of a local variable declared in another file. Color.alpha(result) was labelled opacity, a word taken from an unrelated expression.

### Fixes
- Argument labels are no longer invented. Resolving a call by name accepted any symbol carrying that name, so a local val in another file of the same package answered for it and its line was parsed as a signature: Color.alpha(result) showed opacity, and Success(false) showed false.
- Annotation arguments keep their labels. Annotations were missing from the list of callable kinds, so filtering by kind without adding them would have dropped every one of them.
- Measured on a real Android project: 14 invented labels removed, and not one correct label lost.

## 1.42.71

A when that covers every branch showed a lens with no command at all, which VS Code does not reliably draw. It now opens the sealed type it covers.

### Fixes
- The lens on an exhaustive when carries a real command. Being the common case for this check, it was also the lens most at risk of not being drawn: an empty command is what made the drawable preview lens vanish once.
- No lens in the extension relies on an empty command any more, and a test holds that for both branches of this provider.

## 1.42.70

Splitting the state lens in two, one release ago, gave the readers side an empty command when a state has no reader in the file. A lens with an empty command is not reliably drawn, and that count is the one worth reading.

### Fixes
- A state read nowhere in its own file shows one lens with both counts instead of a second lens that might not be drawn at all. The drawable preview lens vanished the same way once, and the note left in that code is what caught this.
- Every lens this provider emits now carries a real command, checked by a test.

## 1.42.69

The state lens showed writes and readers in one clickable label, so both halves opened the same reference list. They are two labels now, and a single reader opens straight at its line.

### Fixes
- The state lens is two lenses. A code lens carries one command, so the single label meant one action for both halves: clicking readers opened writes and readers together, and the panel stole the view.
- A lone write or a lone reader opens at its line. The peek list stays for two or more.
- With no reader in the file the right side stays inert instead of offering a click that shows nothing.

## 1.42.68

Kotlin writes the fields of a data class on one line. The quick fix matched its finding on the line alone, so opening it on the second field offered to delete the first.

### Fixes
- The unread field fix acts on the field under the cursor. On a data class written as one line, the first field of the line won every time, so the title named it and the deletion removed its text.
- The same rule now serves the enum entry and class member fixes, which matched on the line alone as well. Nothing visible changes there: an enum written on one line offers no deletion at all, because the module declines to compute a safe extent for it.
- Measured on a real Android project: 34 data classes and 4 enums are written with several names on one line.

## 1.42.67

With two dead overloads in one file, the quick fix offered on the second one deleted the first. The action found its finding by name, and a name is shared by every overload.

### Fixes
- Deleting an unused declaration removes the one the cursor sits on. With two dead overloads of the same name in a file, the fix offered on the second removed the first instead, along with whatever annotation it carried.
- The title and the verdict shown in the lightbulb came from that same wrong finding, so the second overload could be offered the action meant for the first.
- This path opened in 1.42.63, which started reporting two dead homonyms declared in one file. The removal itself was already fixed in 1.42.65; this is the step just above it.

## 1.42.66

Nothing changes in the editor. Three behaviours you can see, and that no test was actually guarding, are now guarded: JUnit 5 results finding their test, the usage lens skipping private members, and test names with spaces.

### Under the hood
- A JUnit 5 result named myTest() is matched back to its test, a nested class written Outer with a dollar sign is read as Outer.Inner, and an escaped quote in a failure message is shown as a quote. All three could be unplugged from the module without a single test noticing.
- The usage count above a private member, and a Gradle test name written with spaces, are checked against the module now instead of against a copy of an older version of it.
- A guard compares every expression a test copies from the source with its original, so the next copy that drifts fails the build.

## 1.42.65

Removing an unused function looked the declaration up by name and kind, and overloads share both. Accepting the fix on the second one deleted the first, annotation included.

### Fixes
- Removing an unused top level declaration lands on the one that was reported. Two overloads share a name and a kind, so the lookup answered with the first one every time, and the neighbour was deleted instead, annotation and all.
- Two dead overloads accepted together now produce two separate deletions. Both resolved to the same span before, so one of them silently stayed.
- This path only became reachable in 1.42.63, which started reporting two dead homonyms declared in one file.

## 1.42.64

The unused member check counted a file once per declaration it held, so a class carrying two overloads of a dead name read as if something used it. The same fix as the previous release, one level down.

### Fixes
- The unused member check reports a group of dead homonyms when one file holds two of them. Before, that file was counted twice and the group looked alive, so nothing was reported at all.
- The why explanation follows the same rule, so it no longer says alive in the same file for a member the check reports.
- The safety belts are untouched: one mention anywhere, a layout attribute included, still keeps every bearer of the name alive. Same 271 findings on a 6278 file Android codebase, before and after.

## 1.42.63

Two dead functions of the same name in one file hid each other from the unused symbol check, while the same two in separate files were reported. Both are now reported.

### Fixes
- The unused symbol check now reports two dead overloads declared in the same file. Until now it reported them only when they lived in separate files, which is the same code with a different layout.
- The why explanation agrees with the verdict again: it said alive in the same file for symbols the check was about to report.
- Nothing else changes on a real project: the same 152 findings on a 5088 file Android codebase, before and after.

## 1.42.62

Call Hierarchy skipped the declaration line of an overload by looking for the word fun, which only Java never writes. A Java overload came back as its own caller.

### Fixes
- Call Hierarchy no longer shows a Java overload as a caller of itself. The guard recognised the Kotlin shape of a declaration and nothing else, so every overloaded Java method opened onto a phantom caller.
- Measured on a real Android project of 1901 Java files: 344 phantom callers across 120 overloaded methods.
- Kotlin overloads were already handled and stay handled; the check now comes from the symbol index, which knows both languages.

## 1.42.61

The count above a function counted the declaration of every sibling overload. A Dagger component with 176 overloads of the same method read 354 usages where 179 were real.

### Fixes
- The usage count above a function no longer counts the declarations of its own overloads. Measured on a real Android project: a component with 176 overloads of the same method showed 354 usages where 179 were real.
- A function that nobody calls could read one usage, which was its overload's declaration. It now reads none, so the count can again be trusted to find dead code.
- The Find Usages panel drops the same declarations, so the list matches the number the lens shows.

## 1.42.60

A name written in a quoted literal nested inside a template expression was counted as a reference. Find Usages, occurrence highlighting and rename now leave it alone.

### Fixes
- A name inside a quoted literal nested in a template expression is text, not a reference. The scan used to keep counting code past the opening quote, so Find Usages reported an extra hit, the usage count on the lens was off by one, and a rename would have rewritten the label.
- Found by comparing what occurrence highlighting and Find Usages answer about the same position, across every raw string of a real 3187 file Kotlin project.

## 1.42.59

Put the cursor on a name inside a raw string and every place it is used as code now lights up, including the brace form of a template.

### Fixes
- Occurrence highlighting inside a raw string now treats a name wrapped in a dollar and braces as code, the way Find Usages always has. Before this, only the short dollar form lit up, so one file answered two different things about the same position.
- The rule now lives in one place, shared by the highlighter and Find Usages, so the two views cannot drift apart again.

## 1.42.58

Kotlin Jump 1.42.58 closes a hole in the check the caches share, so the compiler guards it again.

### Fixes
- The shared cache check accepted any object where a document was expected, and stored it. The helper introduced last release was written loosely enough that passing something that is not a document compiled cleanly, and the cache entry then held it while still claiming to hold a document. Nothing in the extension does that today, but the compiler had stopped being able to say so. Its signature now ties the two together, and the loose call is rejected.

## 1.42.57

Kotlin Jump 1.42.57 fixes what the last three releases left behind: after reopening a file, the caches kept paying full price on every single request, for the rest of the session.

### Fixes
- Reopening a file no longer makes hover and Go to Definition hash the whole document on every name they resolve. Comparing the document object is the cheap way to know the text has not changed, and a reopened file gets a new object. The comparison failed forever after, because the entry still pointed at the destroyed one, so every request fell through to hashing the text. Measured over the 40 largest files of a real Android project: a burst of resolutions cost 29.6 ms instead of 0.28 ms, and it never recovered.
- The entry now adopts the new object once the text is confirmed unchanged, so the next request is free again. Folding, semantic tokens and import resolution share one helper for this, so the three cannot drift apart.

## 1.42.56

Kotlin Jump 1.42.56 fixes the last cache that trusted the version number, and it is the one whose mistakes are the most visible: it decides which symbol a name refers to.

### Fixes
- Reopening a file that changed outside the editor no longer resolves a name against the previous version's imports. The import resolver keyed its cache on the document version, which restarts at 1 for a reopened document. Reproduced with two files of the same length whose imports were swapped: asking for `Foo` returned `a.Foo` when the file said `zz.Foo`. Go to Definition, hover and auto import all read that answer.
- The import resolver keeps only the files you have open. It kept one entry per file ever resolved, with no ceiling: 13.8 MB retained after resolving across a real Android project of 3187 Kotlin files, the largest of any cache in the extension.
- Resolving from the same document twice does not read the text again, so nothing on the hover or Go to Definition path got slower.

## 1.42.55

Kotlin Jump 1.42.55 applies the previous two fixes to the one entry point that had been missed, and it is the one the editor uses most.

### Fixes
- Reopening a file that changed outside the editor no longer keeps the previous colouring. Semantic tokens have two entry points: a full request and a delta request. The full one learned to compare the text in 1.42.53, the delta one still answered "nothing changed" on the version number alone. Since the version restarts at 1 for a reopened document, and since the editor sends a delta request as soon as it has a result to update, this was the path most likely to be taken. Reproduced with two texts of exactly 64 characters: the second was told nothing had changed.

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
