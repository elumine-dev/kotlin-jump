import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';
import { parse } from '../../../src/indexer/KotlinParser';

/**
 * `private const val \`50_MEGS_IN_BYTES\``: a name that starts with a digit
 * has to be written between backticks. On the reference project, once
 * `kdead remove --all` took the class that read it, the constant stayed
 * alone in two files and detekt reported it (UnusedPrivateProperty). The
 * parser did not index a backtick `val`, and the detector skipped every
 * backtick name, a test title with spaces being the case it was written for.
 */
const FILE = 'package a\n\n@Suppress("ObjectPropertyName")\nprivate const val `50_MEGS_IN_BYTES` = 50L * 1024L\n';

describe('KJ026 a backtick name made of word characters', () => {
  it('is indexed without its backticks, the column on the name', () => {
    const s = parse('file:///a.kt', FILE).symbols.find(x => x.kind === 'val');
    expect(s?.name).toBe('50_MEGS_IN_BYTES');
    expect(FILE.split('\n')[s!.line].slice(s!.character, s!.character + s!.name.length)).toBe('50_MEGS_IN_BYTES');
  });

  it('is reported when nothing reads it, and its removal takes the annotation', () => {
    const [d] = findUnusedDeclarations(FILE, 'kotlin');
    expect(d?.name).toBe('50_MEGS_IN_BYTES');
    expect(FILE.slice(0, d.removeStart) + FILE.slice(d.removeEnd)).toBe('package a\n\n');
  });

  it('is kept when the file reads it between backticks', () => {
    const text = `${FILE}\nclass Used {\n    val size = \`50_MEGS_IN_BYTES\`\n}\n`;
    expect(findUnusedDeclarations(text, 'kotlin').map(d => d.name)).not.toContain('50_MEGS_IN_BYTES');
  });

  it('still leaves a test title alone', () => {
    const text = 'package a\n\nclass T {\n    private fun `returns user when found`() = 1\n}\n';
    expect(findUnusedDeclarations(text, 'kotlin')).toEqual([]);
  });
});

/**
 * `private fun snapshot() = dao.all()` / `.sortedBy { }` / a `//` note /
 * `.map { }`. The removal stopped above the note and left `.map { }` alone:
 * two compiler errors on an open source app.
 */
describe('KJ026 a chain with a comment between two links', () => {
  it('goes whole, the link under the comment included', () => {
    const text = 'package a\n\nclass T(private val dao: Dao) {\n    fun keep() = 1\n\n    private fun snapshot() = dao.all()\n        .sortedBy { it.url }\n        // Identities deliberately include the provider.\n        .map { it.copy(id = 0) }\n\n    private companion object {\n        const val URL = "x"\n    }\n}\n';
    const d = findUnusedDeclarations(text, 'kotlin').find(x => x.name === 'snapshot');
    expect(d).toBeDefined();
    const after = text.slice(0, d!.removeStart) + text.slice(d!.removeEnd);
    expect(after).not.toContain('.map');
    expect(after).not.toContain('Identities');
    expect(after).toContain('private companion object');
  });

  it('a comment above the next declaration still ends the walk', () => {
    const text = 'package a\n\nclass T(private val dao: Dao) {\n    private fun snapshot() = dao.all()\n        .sortedBy { it.url }\n\n    // Kept for the tests.\n    fun keep() = 1\n}\n';
    const d = findUnusedDeclarations(text, 'kotlin').find(x => x.name === 'snapshot');
    const after = text.slice(0, d!.removeStart) + text.slice(d!.removeEnd);
    expect(after).toContain('// Kept for the tests.\n    fun keep() = 1');
  });
});
