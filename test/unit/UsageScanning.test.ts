import { describe, it, expect, beforeEach } from 'vitest';
import { fileCouldReference } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// Simulate what scanForUsages does per line: match \bword\b then check if in comment/string
function findUsagesInText(word: string, text: string): { line: number; lineText: string }[] {
  const re = new RegExp(`\\b${word}\\b`, 'g');
  const lines = text.split('\n');
  const results: { line: number; lineText: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    ) continue;

    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      // Check if match is inside a trailing comment or string
      if (!isInsideCommentOrString(lines[i], m.index)) {
        results.push({ line: i, lineText: lines[i] });
      }
    }
  }
  return results;
}

// Returns true if the character at `pos` is inside a string literal or trailing // comment
function isInsideCommentOrString(line: string, pos: number): boolean {
  let inStr: string | false = false;
  for (let i = 0; i < line.length; i++) {
    if (inStr) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === inStr) { inStr = false; continue; }
      if (i === pos) return true; // pos is inside string
      continue;
    }
    if (line[i] === '"' || line[i] === '\'') {
      inStr = line[i];
      if (i === pos) return true;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      return pos >= i; // everything from // onward is a comment
    }
    if (i === pos) return false;
  }
  return !!inStr;
}

describe('Usage scanning — trailing comments should be skipped', () => {
  it('Height in trailing comment is NOT a usage', () => {
    const code = `int newWidth = (int) (height * 0.35); // Force Width percentage of Height`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(0);
  });

  it('Height in code IS a usage', () => {
    const code = `val offset = EditionTopAppBarDefaults.Height + 8.dp`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(1);
  });

  it('word before trailing comment is found, word in comment is not', () => {
    const code = `val x = Height + 1 // Height is the default`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(1);
    expect(results[0].lineText).toContain('val x = Height');
  });
});

describe('Usage scanning — string literals should be skipped', () => {
  it('Height inside string literal is NOT a usage', () => {
    const code = `val msg = "Height calculated for media was incorrect"`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(0);
  });

  it('Height inside string template is NOT a usage', () => {
    const code = `val msg = "The Height is \${value}"`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(0);
  });

  it('Height outside string IS a usage', () => {
    const code = `val h = Height; val msg = "some string"`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(1);
  });

  it('Height both in code and in string — only code match counts', () => {
    const code = `val h = Height // "Height in comment"`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(1);
  });
});

describe('Usage scanning — combined edge cases', () => {
  it('multiple words on same line: only real usages count', () => {
    const code = `modifier = modifier.height(MainTabBarDefaults.Height)`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(1);
  });

  it('line with only a comment', () => {
    const code = `// This sets the Height`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(0);
  });

  it('import line is skipped', () => {
    const code = `import com.example.Height`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(0);
  });

  it('block comment line is skipped', () => {
    const code = `/* Height should be 64 */`;
    const results = findUsagesInText('Height', code);
    expect(results).toHaveLength(0);
  });

  it('real Kotlin object property usage', () => {
    const code = `object Defaults {
    val Height = 64.dp
}
fun render() {
    val h = Defaults.Height
    val msg = "Height is nice" // Height comment
}`;
    const results = findUsagesInText('Height', code);
    // Line 1: val Height = 64.dp → match
    // Line 4: val h = Defaults.Height → match
    // Line 5: "Height is nice" → skip (string), // Height → skip (comment)
    expect(results).toHaveLength(2);
  });
});
