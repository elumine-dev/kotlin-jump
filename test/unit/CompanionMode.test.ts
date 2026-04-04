import { describe, it, expect } from 'vitest';
import { resolveCompanionMode } from '../../src/util/companionMode';

describe('resolveCompanionMode', () => {

  // ── "always" mode ────────────────────────────────────────────────────────

  it('"always" → true even when no LSP is active', () => {
    expect(resolveCompanionMode('always', false)).toBe(true);
  });

  it('"always" → true even when LSP is active (redundant but consistent)', () => {
    expect(resolveCompanionMode('always', true)).toBe(true);
  });

  // ── "never" mode ─────────────────────────────────────────────────────────

  it('"never" → false even when LSP is active', () => {
    expect(resolveCompanionMode('never', true)).toBe(false);
  });

  it('"never" → false when no LSP active', () => {
    expect(resolveCompanionMode('never', false)).toBe(false);
  });

  // ── "auto" mode ───────────────────────────────────────────────────────────

  it('"auto" + LSP active → true (companion mode enabled)', () => {
    expect(resolveCompanionMode('auto', true)).toBe(true);
  });

  it('"auto" + LSP not active → false (all providers registered)', () => {
    expect(resolveCompanionMode('auto', false)).toBe(false);
  });

  // ── Unknown / future values fall back to auto behaviour ──────────────────

  it('unknown mode + LSP active → true (auto fallback)', () => {
    expect(resolveCompanionMode('unknown-future-value', true)).toBe(true);
  });

  it('unknown mode + LSP inactive → false (auto fallback)', () => {
    expect(resolveCompanionMode('unknown-future-value', false)).toBe(false);
  });

  it('empty string + LSP active → true (auto fallback)', () => {
    expect(resolveCompanionMode('', true)).toBe(true);
  });

  it('empty string + LSP inactive → false (auto fallback)', () => {
    expect(resolveCompanionMode('', false)).toBe(false);
  });
});
