import { describe, it, expect } from 'vitest';
import { networkAllowed, hostAllowed, shouldPrompt } from '../../../src/upgrades/consent';
import type { ConsentInput } from '../../../src/upgrades/consent';
import type { RepoRef } from '../../../src/upgrades/model';

/**
 * KJ-082, when the version check may talk to the network at all.
 *
 * Until now the extension never contacted a server without a click. A version
 * check sends group and artifact names, so it is behind `kotlinJump.upgrades.check`:
 * `ask` prompts once per workspace, `on` checks, `off` never does. A custom
 * repository read out of the workspace is one step further: it needs the
 * setting, a trusted workspace, an explicit opt in, https, and no credentials.
 */

const base: ConsentInput = { mode: 'ask', workspaceDecision: undefined, sessionGrant: false, trusted: true, customReposOptIn: false };
const central: RepoRef = { kind: 'mavenCentral', url: 'https://repo1.maven.org/maven2' };
const jitpack: RepoRef = { kind: 'custom', url: 'https://jitpack.io' };

describe('networkAllowed', () => {
  it('follows the truth table of mode, workspace decision and session grant', () => {
    const rows: [ConsentInput['mode'], ConsentInput['workspaceDecision'], boolean, boolean][] = [
      ['off', undefined, false, false], ['off', 'granted', true, false],
      ['on', undefined, false, true], ['on', 'denied', false, true],
      ['ask', undefined, false, false], ['ask', 'granted', false, true], ['ask', 'denied', false, false],
      ['ask', undefined, true, true], ['ask', 'denied', true, true],
    ];
    for (const [mode, workspaceDecision, sessionGrant, expected] of rows) {
      expect(networkAllowed({ ...base, mode, workspaceDecision, sessionGrant }), `${mode} ${workspaceDecision} ${sessionGrant}`).toBe(expected);
    }
  });
});

describe('hostAllowed', () => {
  it('lets a well known repository through under the network rule alone', () => {
    expect(hostAllowed({ ...base, mode: 'on', trusted: false }, central)).toBe(true);
    expect(hostAllowed({ ...base, mode: 'on' }, { kind: 'google', url: 'https://dl.google.com/dl/android/maven2' })).toBe(true);
    expect(hostAllowed({ ...base, mode: 'on' }, { kind: 'gradlePluginPortal', url: 'https://plugins.gradle.org/m2' })).toBe(true);
    expect(hostAllowed({ ...base, mode: 'on' }, { kind: 'gradle', url: 'https://services.gradle.org/versions' })).toBe(true);
    expect(hostAllowed({ ...base, mode: 'off' }, central)).toBe(false);
  });

  it('never reaches a custom repository from an untrusted workspace, without the opt in, over http, or with credentials', () => {
    const on: ConsentInput = { ...base, mode: 'on', customReposOptIn: true };
    expect(hostAllowed(on, jitpack)).toBe(true);
    expect(hostAllowed({ ...on, trusted: false }, jitpack)).toBe(false);
    expect(hostAllowed({ ...on, customReposOptIn: false }, jitpack)).toBe(false);
    expect(hostAllowed(on, { kind: 'custom', url: 'http://jitpack.io' })).toBe(false);
    expect(hostAllowed(on, { kind: 'custom', url: 'https://nexus.example.org/releases', private: true })).toBe(false);
    expect(hostAllowed({ ...on, mode: 'off' }, jitpack)).toBe(false);
  });
});

describe('shouldPrompt', () => {
  it('prompts under ask only, once, when there is something to check and no decision yet', () => {
    expect(shouldPrompt(base, true, false)).toBe(true);
    expect(shouldPrompt(base, false, false)).toBe(false);
    expect(shouldPrompt(base, true, true)).toBe(false);
    expect(shouldPrompt({ ...base, workspaceDecision: 'granted' }, true, false)).toBe(false);
    expect(shouldPrompt({ ...base, workspaceDecision: 'denied' }, true, false)).toBe(false);
    expect(shouldPrompt({ ...base, sessionGrant: true }, true, false)).toBe(false);
    expect(shouldPrompt({ ...base, mode: 'on' }, true, false)).toBe(false);
    expect(shouldPrompt({ ...base, mode: 'off' }, true, false)).toBe(false);
  });
});
