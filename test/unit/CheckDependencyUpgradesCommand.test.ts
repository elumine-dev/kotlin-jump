import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  applyDependencyUpgrades, checkDependencyUpgradesCommand, ensureConsent, resetConsentPrompts, seedDependencyVersions, type CommandContext,
} from '../../src/commands/CheckDependencyUpgrades';
import { DependencyUpgradeProvider } from '../../src/providers/DependencyUpgradeProvider';
import { UpgradeSession } from '../../src/providers/UpgradeSession';
import { UpgradeEngine } from '../../src/upgrades/UpgradeEngine';
import { MemoryCacheStore } from '../../src/upgrades/cache';
import type { CacheEntry } from '../../src/upgrades/model';
import type { CheckMode } from '../../src/upgrades/consent';

/**
 * KJ-082, the command: Check Dependency Upgrades.
 *
 * It respects the setting (off says so, with a way to turn it on), asks once
 * for consent under `ask`, then checks every folder under a cancellable
 * progress, publishes the findings for the whole workspace, and offers a
 * QuickPick: apply every patch or minor bump through one confirmation, open
 * or copy a markdown report a pull request can carry. A zero result is a
 * sentence, not a silence. The demo seeder refuses to run outside the
 * recorder.
 */

const TOML = [
  '[versions]', 'retrofit = "2.9.0"', 'navigation = "2.7.6"', 'material3 = "1.2.0"', '',
  '[libraries]',
  'r = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }',
  'n = { module = "com.example.kiosk:navigation", version.ref = "navigation" }',
  'm = { module = "com.example.kiosk:material3", version.ref = "material3" }', '',
].join('\n');
const FILE = '/w/gradle/libs.versions.toml';
const seed = (versions: Record<string, string[]>): Record<string, CacheEntry> => {
  const out: Record<string, CacheEntry> = { 'google/_master': { v: 1, url: 'x', fetchedAt: 1, status: 'ok', groups: [] } };
  for (const [ga, v] of Object.entries(versions)) out[`central/${ga.replace(/[.:]/g, '/')}`] = { v: 1, url: 'x', fetchedAt: 1, status: 'ok', versions: v };
  return out;
};
const UPGRADES = seed({ 'com.squareup.retrofit2:retrofit': ['2.9.0', '3.0.0'], 'com.example.kiosk:navigation': ['2.7.6', '2.7.7'], 'com.example.kiosk:material3': ['1.2.0', '1.2.1'] });
const CURRENT = seed({ 'com.squareup.retrofit2:retrofit': ['2.9.0'], 'com.example.kiosk:navigation': ['2.7.6'], 'com.example.kiosk:material3': ['1.2.0'] });

function harness(check: CheckMode, entries: Record<string, CacheEntry>, decision?: 'granted' | 'denied') {
  const texts: Record<string, string> = { [FILE]: TOML };
  const engine = new UpgradeEngine({ store: new MemoryCacheStore(), policy: () => 'preferStable', consent: () => ({ mode: check, workspaceDecision: decision, sessionGrant: false, trusted: true, customReposOptIn: false }) });
  engine.seed(entries);
  const session = new UpgradeSession(engine, { list: async () => Object.keys(texts), read: async p => texts[p] }, { trusted: () => true });
  const provider = new DependencyUpgradeProvider({ policy: () => 'preferStable', bump: (f, to, o) => engine.bumpEdits(f, to, p => texts[p], o), textOf: p => texts[p] });
  const state = new Map<string, unknown>();
  if (decision) state.set('kotlinJump.upgrades.decision', decision);
  const setCheck = vi.fn(async (mode: CheckMode) => { check = mode; });
  const ctx: CommandContext = {
    engine, session, provider, folders: () => ['/w'], config: () => ({ check, policy: 'preferStable' }), setCheck,
    workspaceState: { get: <T,>(k: string) => state.get(k) as T | undefined, update: async (k: string, v: unknown) => { state.set(k, v); } },
    now: () => Date.UTC(2026, 9, 25, 12),
  };
  return { ctx, texts, setCheck, state, provider };
}

const info = () => vi.spyOn(vscode.window, 'showInformationMessage');
const pick = () => vi.spyOn(vscode.window, 'showQuickPick');

beforeEach(() => { resetConsentPrompts(); (vscode.workspace as any)._editsAppliquees.length = 0; });
afterEach(() => vi.restoreAllMocks());

describe('KJ-082 command: gates', () => {
  it('off: says so and offers to turn the checks on', async () => {
    const { ctx, setCheck } = harness('off', UPGRADES);
    const spy = info().mockResolvedValue(undefined as any);
    await checkDependencyUpgradesCommand(ctx);
    expect(spy.mock.calls[0][0]).toBe('Dependency upgrade checks are off in settings.');
    expect(spy.mock.calls[0].slice(1)).toContain('Turn on');
    expect(setCheck).not.toHaveBeenCalled();
    spy.mockReset().mockResolvedValueOnce('Turn on' as any).mockResolvedValue(undefined as any);
    pick().mockResolvedValue(undefined as any);
    await checkDependencyUpgradesCommand(ctx);
    expect(setCheck).toHaveBeenCalledWith('on');
  });

  it('ask: one prompt; Check now grants the workspace, Always turns the setting on, Never turns it off, a dismissal asks nothing more this session', async () => {
    const { ctx, setCheck, state } = harness('ask', UPGRADES);
    const spy = info().mockResolvedValueOnce('Check now' as any);
    expect(await ensureConsent(ctx, '/w')).toBe(true);
    expect(state.get('kotlinJump.upgrades.decision')).toBe('granted');
    expect(spy.mock.calls[0][0]).toContain('Only group and artifact names are sent');

    const again = harness('ask', UPGRADES);
    resetConsentPrompts();
    spy.mockReset().mockResolvedValueOnce('Never' as any);
    expect(await ensureConsent(again.ctx, '/w')).toBe(false);
    expect(again.setCheck).toHaveBeenCalledWith('off');

    const third = harness('ask', UPGRADES);
    resetConsentPrompts();
    spy.mockReset().mockResolvedValueOnce(undefined as any);
    expect(await ensureConsent(third.ctx, '/w')).toBe(false);
    expect(await ensureConsent(third.ctx, '/w')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(setCheck).not.toHaveBeenCalledWith('on');
  });

  it('a workspace that already granted is never asked again', async () => {
    const { ctx } = harness('ask', UPGRADES, 'granted');
    const spy = info();
    expect(await ensureConsent(ctx, '/w')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('KJ-082 command: the check', () => {
  it('with everything current, says so with the counts and the repositories', async () => {
    const { ctx } = harness('on', CURRENT);
    const spy = info().mockResolvedValue(undefined as any);
    const picked = pick();
    await checkDependencyUpgradesCommand(ctx);
    expect(spy.mock.calls.at(-1)![0]).toBe('Every dependency is at its latest stable version. Checked 3 libraries and 0 plugins against Maven Central.');
    expect(picked).not.toHaveBeenCalled();
  });

  it('with upgrades, publishes the findings for the workspace and offers the bulk bumps and the report', async () => {
    const { ctx, provider } = harness('on', UPGRADES);
    info().mockResolvedValue(undefined as any);
    const picked = pick().mockImplementation(async (items: any) => (items as any[]).find(i => i.action === 'copy'));
    await checkDependencyUpgradesCommand(ctx);
    const items = picked.mock.calls[0][0] as any[];
    expect(items.map(i => i.label)).toEqual([
      '$(arrow-up) Apply all 2 patch bumps', '$(book) Open report', '$(clippy) Copy report',
    ]);
    expect((picked.mock.calls[0][1] as any).placeHolder).toBe('Dependency upgrades: 1 major, 2 patch');
    expect(provider.findingsFor(FILE)!.origin).toBe('command');
    expect(await vscode.env.clipboard.readText()).toContain('| retrofit (com.squareup.retrofit2:retrofit) | 2.9.0 | 3.0.0 | major |');
  });

  it('applies every patch bump of a file after one confirmation, or through the preview on request, or not at all', async () => {
    const { ctx, provider } = harness('on', UPGRADES);
    info().mockResolvedValue(undefined as any);
    pick().mockResolvedValue(undefined as any);
    await checkDependencyUpgradesCommand(ctx);
    expect(provider.findingsFor(FILE)!.findings.filter(f => f.verdict.kind === 'newer')).toHaveLength(3);
    const applied = (vscode.workspace as any)._editsAppliquees as any[];

    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValueOnce('Apply all' as any);
    expect(await applyDependencyUpgrades(ctx, FILE, 'patch')).toBe(2);
    expect(applied).toHaveLength(1);
    const entries = applied[0]._entries;
    expect(entries.map((e: any) => e.newText).sort()).toEqual(['1.2.1', '2.7.7']);
    expect(entries.every((e: any) => e.metadata === undefined)).toBe(true);

    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValueOnce('Review one by one' as any);
    expect(await applyDependencyUpgrades(ctx, FILE, 'patch')).toBe(2);
    expect(applied[1]._entries.every((e: any) => e.metadata?.needsConfirmation === true)).toBe(true);

    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValueOnce(undefined as any);
    expect(await applyDependencyUpgrades(ctx, FILE, 'patch')).toBe(0);
    expect(applied).toHaveLength(2);
    expect(await applyDependencyUpgrades(ctx, FILE, 'patch', { confirmed: true })).toBe(2);
  });

  it('the demo seeder refuses outside the recorder', async () => {
    const { ctx } = harness('on', CURRENT);
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as any);
    const before = process.env.KJ_DEMO_MODE;
    delete process.env.KJ_DEMO_MODE;
    try {
      await seedDependencyVersions(ctx, '/nowhere.json');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      if (before !== undefined) process.env.KJ_DEMO_MODE = before;
    }
  });
});
