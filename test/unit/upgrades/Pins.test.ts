import { describe, it, expect } from 'vitest';
import { pinOnLine, fileLevelMarker, IGNORE_MARKER } from '../../../src/upgrades/pins';

/**
 * KJ-082, what silences an entry.
 *
 * A `# @pin` comment, on the entry's line or alone on the line above, holds
 * an entry back and is the same comment the version-catalog-update plugin
 * reads, so a catalog pinned for one tool is pinned for the other. `# @keep`
 * is not a pin: that plugin defines it as "do not remove", which is another
 * question. The Kotlin Jump marker `kotlin-jump:ignore dependency-upgrade`
 * silences the entry it is written on, and the whole file when it stands on a
 * comment line of its own. A `@pin` inside a string value or the word
 * `@pinned` is not a pin.
 */

const lines = (text: string) => text.split('\n');

describe('pinOnLine in a TOML catalog', () => {
  it('reads # @pin after the value', () => {
    const l = lines('[versions]\nretrofit = "2.9.0" # @pin\ngson = "2.10.1"');
    expect(pinOnLine(l, 1, 'toml')).toBe('pin-comment');
    expect(pinOnLine(l, 2, 'toml')).toBeUndefined();
  });

  it('reads # @pin alone on the line directly above, and nowhere further', () => {
    const l = lines('# @pin\nretrofit = "2.9.0"\n\ngson = "2.10.1"');
    expect(pinOnLine(l, 1, 'toml')).toBe('pin-comment');
    expect(pinOnLine(l, 3, 'toml')).toBeUndefined();
  });

  it('does not read # @keep as a pin', () => {
    const l = lines('retrofit = "2.9.0" # @keep\n# @keep\ngson = "2.10.1"');
    expect(pinOnLine(l, 0, 'toml')).toBeUndefined();
    expect(pinOnLine(l, 2, 'toml')).toBeUndefined();
  });

  it('reads the Kotlin Jump marker on the entry line', () => {
    const l = lines(`retrofit = "2.9.0" # ${IGNORE_MARKER}`);
    expect(pinOnLine(l, 0, 'toml')).toBe('ignore-marker');
  });

  it('ignores @pinned and a @pin inside a string value', () => {
    const l = lines('retrofit = "2.9.0" # @pinned for now\ntag = "@pin"\nname = "x" # see @pin\n');
    expect(pinOnLine(l, 0, 'toml')).toBeUndefined();
    expect(pinOnLine(l, 1, 'toml')).toBeUndefined();
    expect(pinOnLine(l, 2, 'toml')).toBe('pin-comment');
  });

  it('is undefined outside the file', () => {
    expect(pinOnLine(lines('a = "1"'), 5, 'toml')).toBeUndefined();
    expect(pinOnLine(lines('a = "1"'), -1, 'toml')).toBeUndefined();
  });
});

describe('pinOnLine in a build file', () => {
  it('reads // @pin after the value and on the line above', () => {
    const l = lines('plugins {\n    // @pin\n    kotlin("jvm") version "1.9.24"\n    id("com.example.kiosk") version "1.0.0" // @pin\n}');
    expect(pinOnLine(l, 2, 'code')).toBe('pin-comment');
    expect(pinOnLine(l, 3, 'code')).toBe('pin-comment');
    expect(pinOnLine(l, 0, 'code')).toBeUndefined();
  });

  it('does not read a # comment as a build file comment', () => {
    const l = lines('implementation("com.example.kiosk:door:1.0.0") # @pin');
    expect(pinOnLine(l, 0, 'code')).toBeUndefined();
  });

  it('reads the marker written as a code comment', () => {
    const l = lines(`implementation("com.example.kiosk:door:1.0.0") // ${IGNORE_MARKER}`);
    expect(pinOnLine(l, 0, 'code')).toBe('ignore-marker');
  });
});

describe('fileLevelMarker', () => {
  it('is true when the marker stands alone on a comment line', () => {
    expect(fileLevelMarker(lines(`# ${IGNORE_MARKER}\n[versions]\na = "1"`), 'toml')).toBe(true);
    expect(fileLevelMarker(lines(`plugins {\n    // ${IGNORE_MARKER}\n}`), 'code')).toBe(true);
  });

  it('is false when the marker sits on an entry line, which silences that entry only', () => {
    expect(fileLevelMarker(lines(`a = "1" # ${IGNORE_MARKER}`), 'toml')).toBe(false);
    expect(fileLevelMarker(lines(`id("x") version "1" // ${IGNORE_MARKER}`), 'code')).toBe(false);
  });

  it('is false without the marker, and for the unused alias marker of KJ-041', () => {
    expect(fileLevelMarker(lines('# kotlin-jump:ignore unused-gradle-dependency\na = "1"'), 'toml')).toBe(false);
    expect(fileLevelMarker(lines('# @pin\na = "1"'), 'toml')).toBe(false);
  });
});
