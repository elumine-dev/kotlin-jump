import { describe, it, expect } from 'vitest';
import { fileRenameAfterCut } from '../../../src/cleanup/fileRenameAfterCut';

/**
 * Three open source apps, same shape: `DueSection.kt` held `DueSection` and
 * `LegacyDueSection`, the cut took the first, and detekt reported the file
 * twice (MatchingDeclarationName, Filename). The file takes the name of the
 * class left in it, and only when the cut made the mismatch.
 */
const P = '/app/src/main/java/a/DueSection.kt';
const BEFORE = `package a

class DueSection(val x: Int)

@Deprecated("legacy")
data class LegacyDueSection(
    val trns: List<Int>,
)
`;
const AFTER = `package a

@Deprecated("legacy")
data class LegacyDueSection(
    val trns: List<Int>,
)
`;
const none = () => false;

describe('KJ050 a file renamed after the class a cut left in it', () => {
  it('takes the name of the class left alone', () => {
    expect(fileRenameAfterCut(P, BEFORE, AFTER, [], none)).toBe('/app/src/main/java/a/LegacyDueSection.kt');
  });

  it('keeps a name the project chose: no class bore it before the cut', () => {
    const before = BEFORE.replace('class DueSection(val x: Int)', 'fun dueSection() = 1');
    expect(fileRenameAfterCut(P, before, AFTER, [], none)).toBeUndefined();
  });

  it('keeps a file whose namesake is still there', () => {
    expect(fileRenameAfterCut(P, BEFORE, BEFORE, [], none)).toBeUndefined();
  });

  it('keeps a file left with two classes', () => {
    const after = `${AFTER}\nclass Other\n`;
    expect(fileRenameAfterCut(P, BEFORE, after, [], none)).toBeUndefined();
  });

  it('ignores a private class: detekt counts only the visible one', () => {
    const after = `${AFTER}\nprivate class Helper\n`;
    expect(fileRenameAfterCut(P, BEFORE, after, [], none)).toBe('/app/src/main/java/a/LegacyDueSection.kt');
  });

  it('keeps a file whose class comes after a top-level function (detekt mustBeFirst)', () => {
    const after = AFTER.replace('@Deprecated', 'fun helper() = 1\n\n@Deprecated');
    expect(fileRenameAfterCut(P, BEFORE, after, [], none)).toBeUndefined();
  });

  it('keeps a file that still has a typealias of the file name', () => {
    const after = `${AFTER}\ntypealias DueSection = LegacyDueSection\n`;
    expect(fileRenameAfterCut(P, BEFORE, after, [], none)).toBeUndefined();
  });

  it('keeps a multiplatform file: `.android.kt` is read by the build', () => {
    const p = '/app/src/androidMain/kotlin/a/DueSection.android.kt';
    expect(fileRenameAfterCut(p, BEFORE, AFTER, [], none)).toBeUndefined();
  });

  it('keeps a file when the target exists, whatever its case', () => {
    expect(fileRenameAfterCut(P, BEFORE, AFTER, [], t => t.toLowerCase().endsWith('/legacyduesection.kt'))).toBeUndefined();
  });

  it('keeps a file whose JVM facade Java names', () => {
    const after = `${AFTER}\nfun top() = 1\n`;
    const java = { path: '/app/src/main/java/a/Use.java', text: 'class Use { int x = DueSectionKt.top(); }' };
    expect(fileRenameAfterCut(P, BEFORE, after, [java], none)).toBeUndefined();
  });

  it('renames when `@file:JvmName` fixes the facade name', () => {
    const after = `@file:JvmName("Due")\n${AFTER}\nfun top() = 1\n`;
    const java = { path: '/app/src/main/java/a/Use.java', text: 'class Use { int x = DueSectionKt.top(); }' };
    expect(fileRenameAfterCut(P, BEFORE, after, [java], none)).toBe('/app/src/main/java/a/LegacyDueSection.kt');
  });

  it('keeps a file whose name a build script spells', () => {
    const gradle = { path: '/app/build.gradle.kts', text: 'exclude("**/DueSection.kt")' };
    expect(fileRenameAfterCut(P, BEFORE, AFTER, [gradle], none)).toBeUndefined();
  });

  it('is not fooled by a longer name ending the same way', () => {
    const gradle = { path: '/app/build.gradle.kts', text: 'exclude("**/LegacyDueSection.kt")' };
    expect(fileRenameAfterCut(P, BEFORE, AFTER, [gradle], none)).toBe('/app/src/main/java/a/LegacyDueSection.kt');
  });

  it('leaves Java and scripts alone', () => {
    expect(fileRenameAfterCut('/a/DueSection.java', BEFORE, AFTER, [], none)).toBeUndefined();
    expect(fileRenameAfterCut('/a/DueSection.kts', BEFORE, AFTER, [], none)).toBeUndefined();
  });
});
