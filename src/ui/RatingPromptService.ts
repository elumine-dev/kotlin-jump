import * as vscode from 'vscode';
import { getReviewUrl } from '../util/reviewLink';

const DAY_MS = 24 * 60 * 60 * 1000;

const MIN_ACTIVATIONS = 10;
const MIN_DAYS_SINCE_FIRST_ACTIVATION = 7;
const SNOOZE_DAYS = 30;
const MAX_LIFETIME_PROMPTS = 3;

const KEY_STATUS         = 'kotlinJump.ratingPrompt.status';
const KEY_ACTIVATIONS    = 'kotlinJump.ratingPrompt.activationCount';
const KEY_FIRST_SEEN     = 'kotlinJump.ratingPrompt.firstActivationAt';
const KEY_NEXT_ELIGIBLE  = 'kotlinJump.ratingPrompt.nextEligibleAt';
const KEY_PROMPT_COUNT   = 'kotlinJump.ratingPrompt.promptCount';

const RATE_ACTION    = 'Rate it';
const LATER_ACTION   = 'Remind me later';
const DECLINE_ACTION = "Don't ask again";

type PromptStatus = 'unprompted' | 'later' | 'declined' | 'rated';

export interface RatingPromptState {
  status: PromptStatus;
  activationCount: number;
  firstActivationAt: string | undefined;
  nextEligibleAt: string | undefined;
  promptCount: number;
}

/**
 * Pure gate: only asks for a rating once real usage is established (not
 * install-then-abandon), and caps lifetime prompts the same way Apple's
 * SKStoreReviewController does (a handful per year, not every session).
 */
export function shouldPrompt(state: RatingPromptState, now: Date): boolean {
  if (state.status === 'declined' || state.status === 'rated') return false;
  if (state.promptCount >= MAX_LIFETIME_PROMPTS) return false;
  if (state.activationCount < MIN_ACTIVATIONS) return false;
  if (!state.firstActivationAt) return false;

  const daysSinceFirst = (now.getTime() - new Date(state.firstActivationAt).getTime()) / DAY_MS;
  if (daysSinceFirst < MIN_DAYS_SINCE_FIRST_ACTIVATION) return false;

  if (state.status === 'later' && state.nextEligibleAt && now.getTime() < new Date(state.nextEligibleAt).getTime()) {
    return false;
  }

  return true;
}

export class RatingPromptService {
  /**
   * @param force Skip the usage gate and show the prompt on this activation
   *  regardless of activation count or elapsed days. Wired to the
   *  `KJ_FORCE_RATING_PROMPT` dev env var (mirrors `KJ_OPEN_WHATS_NEW`) so
   *  the prompt can be exercised in the Extension Development Host without
   *  waiting a week of real usage. Status/count bookkeeping still applies,
   *  so "Don't ask again" and the lifetime cap behave exactly as in prod.
   */
  static async maybePrompt(
    context: vscode.ExtensionContext,
    now: Date = new Date(),
    force = false,
  ): Promise<void> {
    const status = context.globalState.get<PromptStatus>(KEY_STATUS, 'unprompted');
    if (status === 'declined' || status === 'rated') return;
    if (context.globalState.get<number>(KEY_PROMPT_COUNT, 0) >= MAX_LIFETIME_PROMPTS) return;

    let firstActivationAt = context.globalState.get<string>(KEY_FIRST_SEEN);
    if (!firstActivationAt) {
      firstActivationAt = now.toISOString();
      await context.globalState.update(KEY_FIRST_SEEN, firstActivationAt);
    }

    const activationCount = context.globalState.get<number>(KEY_ACTIVATIONS, 0) + 1;
    await context.globalState.update(KEY_ACTIVATIONS, activationCount);

    const state: RatingPromptState = {
      status,
      activationCount,
      firstActivationAt,
      nextEligibleAt: context.globalState.get<string>(KEY_NEXT_ELIGIBLE),
      promptCount: context.globalState.get<number>(KEY_PROMPT_COUNT, 0),
    };

    if (!force && !shouldPrompt(state, now)) return;

    const choice = await vscode.window.showInformationMessage(
      'Kotlin Jump saving you time? A quick rating helps other Kotlin devs find it.',
      RATE_ACTION,
      LATER_ACTION,
      DECLINE_ACTION,
    );

    await context.globalState.update(KEY_PROMPT_COUNT, state.promptCount + 1);

    if (choice === RATE_ACTION) {
      await vscode.env.openExternal(vscode.Uri.parse(getReviewUrl()));
      await context.globalState.update(KEY_STATUS, 'rated' as PromptStatus);
      return;
    }

    if (choice === DECLINE_ACTION) {
      await context.globalState.update(KEY_STATUS, 'declined' as PromptStatus);
      return;
    }

    // "Remind me later", or dismissed without picking anything: snooze
    // rather than silence permanently — an accidental Escape shouldn't be
    // read as a decline.
    await context.globalState.update(KEY_STATUS, 'later' as PromptStatus);
    await context.globalState.update(
      KEY_NEXT_ELIGIBLE,
      new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString(),
    );
  }
}
