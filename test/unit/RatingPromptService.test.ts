import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

import * as vscode from 'vscode';
import { RatingPromptService, shouldPrompt, type RatingPromptState } from '../../src/ui/RatingPromptService';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-06T00:00:00.000Z');

function baseState(overrides: Partial<RatingPromptState> = {}): RatingPromptState {
  return {
    status: 'unprompted',
    activationCount: 10,
    firstActivationAt: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    nextEligibleAt: undefined,
    promptCount: 0,
    ...overrides,
  };
}

describe('shouldPrompt (pure gate)', () => {
  it('allows a prompt once activation count and elapsed days both clear the bar', () => {
    expect(shouldPrompt(baseState(), NOW)).toBe(true);
  });

  it('blocks below the activation-count floor', () => {
    expect(shouldPrompt(baseState({ activationCount: 9 }), NOW)).toBe(false);
  });

  it('blocks before enough days have passed since first activation', () => {
    const firstActivationAt = new Date(NOW.getTime() - 6 * DAY_MS).toISOString();
    expect(shouldPrompt(baseState({ firstActivationAt }), NOW)).toBe(false);
  });

  it('blocks when firstActivationAt was never recorded', () => {
    expect(shouldPrompt(baseState({ firstActivationAt: undefined }), NOW)).toBe(false);
  });

  it('never re-prompts once declined', () => {
    expect(shouldPrompt(baseState({ status: 'declined' }), NOW)).toBe(false);
  });

  it('never re-prompts once rated', () => {
    expect(shouldPrompt(baseState({ status: 'rated' }), NOW)).toBe(false);
  });

  it('caps lifetime prompts even if the snooze window elapsed', () => {
    expect(shouldPrompt(baseState({ promptCount: 3 }), NOW)).toBe(false);
  });

  it('respects an in-progress snooze', () => {
    const nextEligibleAt = new Date(NOW.getTime() + DAY_MS).toISOString();
    expect(shouldPrompt(baseState({ status: 'later', nextEligibleAt }), NOW)).toBe(false);
  });

  it('re-prompts once a snooze has elapsed', () => {
    const nextEligibleAt = new Date(NOW.getTime() - DAY_MS).toISOString();
    expect(shouldPrompt(baseState({ status: 'later', nextEligibleAt }), NOW)).toBe(true);
  });

  it('does not crash on clock skew (firstActivationAt in the future)', () => {
    const firstActivationAt = new Date(NOW.getTime() + DAY_MS).toISOString();
    expect(shouldPrompt(baseState({ firstActivationAt }), NOW)).toBe(false);
  });

  it('is inclusive at the exact activation-count and day boundaries', () => {
    const firstActivationAt = new Date(NOW.getTime() - 7 * DAY_MS).toISOString();
    expect(shouldPrompt(baseState({ activationCount: 10, firstActivationAt }), NOW)).toBe(true);
  });
});

function makeContext(initial: Record<string, unknown> = {}): vscode.ExtensionContext {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    globalState: {
      get: (key: string, defaultValue?: unknown) => (store.has(key) ? store.get(key) : defaultValue),
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      keys: () => Array.from(store.keys()),
    },
  } as unknown as vscode.ExtensionContext;
}

describe('RatingPromptService.maybePrompt (orchestration)', () => {
  let showInformationMessage: ReturnType<typeof vi.spyOn>;
  let openExternal: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    showInformationMessage = vi.spyOn(vscodeMock.window, 'showInformationMessage');
    openExternal = vi.spyOn(vscodeMock.env, 'openExternal').mockResolvedValue(true);
    vscodeMock.env.uriScheme = 'vscode';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays silent for the first 9 activations, then prompts on the 10th', async () => {
    const context = makeContext();
    const sevenDaysLater = new Date(NOW.getTime() + 7 * DAY_MS);

    // Activation #1 establishes firstActivationAt = NOW.
    await RatingPromptService.maybePrompt(context, NOW);
    // Activations #2-9 happen once enough days have passed, so only the
    // activation-count floor is still gating the prompt.
    for (let i = 0; i < 8; i++) {
      await RatingPromptService.maybePrompt(context, sevenDaysLater);
    }
    expect(showInformationMessage).not.toHaveBeenCalled();

    await RatingPromptService.maybePrompt(context, sevenDaysLater);
    expect(showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('records firstActivationAt once and never overwrites it on later calls', async () => {
    const context = makeContext();
    await RatingPromptService.maybePrompt(context, NOW);
    await RatingPromptService.maybePrompt(context, new Date(NOW.getTime() + DAY_MS));

    expect(context.globalState.get('kotlinJump.ratingPrompt.firstActivationAt')).toBe(NOW.toISOString());
  });

  it('"Rate it" opens the review URL and permanently silences the prompt', async () => {
    showInformationMessage.mockResolvedValue('Rate it');
    const context = makeContext({
      'kotlinJump.ratingPrompt.activationCount': 9,
      'kotlinJump.ratingPrompt.firstActivationAt': new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    });

    await RatingPromptService.maybePrompt(context, NOW);

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(context.globalState.get('kotlinJump.ratingPrompt.status')).toBe('rated');

    await RatingPromptService.maybePrompt(context, new Date(NOW.getTime() + 400 * DAY_MS));
    expect(showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('routes to Open VSX reviews for non-VS Code hosts (Cursor, Windsurf, ...)', async () => {
    vscodeMock.env.uriScheme = 'cursor';
    showInformationMessage.mockResolvedValue('Rate it');
    const context = makeContext({
      'kotlinJump.ratingPrompt.activationCount': 9,
      'kotlinJump.ratingPrompt.firstActivationAt': new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    });

    await RatingPromptService.maybePrompt(context, NOW);

    expect(openExternal.mock.calls[0][0].toString()).toContain('open-vsx.org');
  });

  it('"Don\'t ask again" silences the prompt permanently', async () => {
    showInformationMessage.mockResolvedValue("Don't ask again");
    const context = makeContext({
      'kotlinJump.ratingPrompt.activationCount': 9,
      'kotlinJump.ratingPrompt.firstActivationAt': new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    });

    await RatingPromptService.maybePrompt(context, NOW);
    expect(context.globalState.get('kotlinJump.ratingPrompt.status')).toBe('declined');

    await RatingPromptService.maybePrompt(context, new Date(NOW.getTime() + 400 * DAY_MS));
    expect(showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('"Remind me later" snoozes for 30 days, then re-prompts', async () => {
    showInformationMessage.mockResolvedValue('Remind me later');
    const context = makeContext({
      'kotlinJump.ratingPrompt.activationCount': 9,
      'kotlinJump.ratingPrompt.firstActivationAt': new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    });

    await RatingPromptService.maybePrompt(context, NOW);
    expect(showInformationMessage).toHaveBeenCalledTimes(1);

    await RatingPromptService.maybePrompt(context, new Date(NOW.getTime() + 10 * DAY_MS));
    expect(showInformationMessage).toHaveBeenCalledTimes(1);

    await RatingPromptService.maybePrompt(context, new Date(NOW.getTime() + 31 * DAY_MS));
    expect(showInformationMessage).toHaveBeenCalledTimes(2);
  });

  it('treats a dismissal with no chosen action as a snooze, not a decline', async () => {
    showInformationMessage.mockResolvedValue(undefined);
    const context = makeContext({
      'kotlinJump.ratingPrompt.activationCount': 9,
      'kotlinJump.ratingPrompt.firstActivationAt': new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    });

    await RatingPromptService.maybePrompt(context, NOW);
    expect(context.globalState.get('kotlinJump.ratingPrompt.status')).toBe('later');

    await RatingPromptService.maybePrompt(context, new Date(NOW.getTime() + 31 * DAY_MS));
    expect(showInformationMessage).toHaveBeenCalledTimes(2);
  });

  it('gives up for good after 3 lifetime prompts, even once the snooze elapses', async () => {
    showInformationMessage.mockResolvedValue('Remind me later');
    const context = makeContext({
      'kotlinJump.ratingPrompt.activationCount': 9,
      'kotlinJump.ratingPrompt.firstActivationAt': new Date(NOW.getTime() - 7 * DAY_MS).toISOString(),
    });

    let t = NOW;
    for (let i = 0; i < 3; i++) {
      await RatingPromptService.maybePrompt(context, t);
      t = new Date(t.getTime() + 31 * DAY_MS);
    }
    expect(showInformationMessage).toHaveBeenCalledTimes(3);

    await RatingPromptService.maybePrompt(context, t);
    expect(showInformationMessage).toHaveBeenCalledTimes(3);
  });
});
