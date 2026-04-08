import { describe, it, expect } from 'vitest';
import { pickEntries, resolveCommand } from '../../src/ai/KotlinJumpChatParticipant';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIndex(sources: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, src] of Object.entries(sources)) index.add(parse(uri, src));
  index.finalize();
  return index;
}

const PKG = 'package com.example\n';

// ── resolveCommand ────────────────────────────────────────────────────────────

describe('resolveCommand', () => {
  it('returns search for undefined command', () => {
    expect(resolveCommand(undefined)).toBe('search');
  });

  it('returns search for empty string', () => {
    expect(resolveCommand('')).toBe('search');
  });

  it('returns search for unknown command', () => {
    expect(resolveCommand('whatever')).toBe('search');
  });

  it('returns implementations for "implementations"', () => {
    expect(resolveCommand('implementations')).toBe('implementations');
  });

  it('returns usages for "usages"', () => {
    expect(resolveCommand('usages')).toBe('usages');
  });

  it('returns doc for "doc"', () => {
    expect(resolveCommand('doc')).toBe('doc');
  });

  it('returns search for "search"', () => {
    expect(resolveCommand('search')).toBe('search');
  });
});

// ── pickEntries ───────────────────────────────────────────────────────────────

describe('pickEntries', () => {
  it('returns empty array for empty query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Alpha` });
    expect(pickEntries(index, '')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Alpha` });
    expect(pickEntries(index, '   ')).toEqual([]);
  });

  it('finds symbol by exact name via lookup', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class MyViewModel` });
    const results = pickEntries(index, 'MyViewModel');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyViewModel');
  });

  it('finds symbol via search fallback when lookup returns nothing', () => {
    // 'UserProfile' is a prefix of 'UserProfileRepository' — lookup('UserProfile') returns [],
    // so pickEntries falls back to search() which finds it via prefix match.
    const index = makeIndex({ 'file:///A.kt': `${PKG}class UserProfileRepository` });
    const results = pickEntries(index, 'UserProfile');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe('UserProfileRepository');
  });

  it('deduplicates results (same FQN from lookup + search)', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Loader` });
    const results = pickEntries(index, 'Loader');
    const fqns = results.map(r => r.fqn);
    const unique = new Set(fqns);
    expect(fqns.length).toBe(unique.size);
  });

  it('caps results at 10', () => {
    const sources: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      sources[`file:///p${i}/Widget.kt`] = `package p${i}\nclass Widget`;
    }
    const index = makeIndex(sources);
    expect(pickEntries(index, 'Widget').length).toBeLessThanOrEqual(10);
  });

  it('prioritises exact lookup over fuzzy results', () => {
    const src = `${PKG}class Loader\nclass LoaderHelper`;
    const index = makeIndex({ 'file:///A.kt': src });
    const results = pickEntries(index, 'Loader');
    // Exact match should appear first
    expect(results[0].name).toBe('Loader');
  });

  it('returns empty for query that matches nothing', () => {
    const index = makeIndex({ 'file:///A.kt': `${PKG}class Completely` });
    expect(pickEntries(index, 'XyzNoMatch99')).toEqual([]);
  });
});
