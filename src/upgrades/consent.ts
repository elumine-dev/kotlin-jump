/**
 * When a version check may talk to the network at all.
 *
 * Until KJ-082 the extension never contacted a server without a click. A
 * version check sends group and artifact names to Maven Central, Google and
 * the plugin portal, so it sits behind `kotlinJump.upgrades.check`: `ask`
 * prompts once per workspace, `on` checks, `off` never does. A repository
 * read out of the workspace's own build files is one step further, because
 * an untrusted workspace could name any host: it needs the setting, a trusted
 * workspace, the explicit opt in, https, and no credentials.
 *
 * Pure: the host reads the settings and the workspace state and passes them in.
 */
import type { RepoRef } from './model';

export type CheckMode = 'ask' | 'on' | 'off';

export interface ConsentInput {
  /** `kotlinJump.upgrades.check`. */
  mode: CheckMode;
  /** The answer given to the prompt in this workspace, if any. */
  workspaceDecision: 'granted' | 'denied' | undefined;
  /** An explicit command run this session counts as a yes for the session. */
  sessionGrant: boolean;
  /** `vscode.workspace.isTrusted`. */
  trusted: boolean;
  /** `kotlinJump.upgrades.customRepositories`. */
  customReposOptIn: boolean;
}

export function networkAllowed(i: ConsentInput): boolean {
  if (i.mode === 'on') return true;
  if (i.mode === 'off') return false;
  return i.workspaceDecision === 'granted' || i.sessionGrant;
}

/** Well known repositories need the network rule alone; a custom one needs trust, the opt in, https and no credentials. */
export function hostAllowed(i: ConsentInput, repo: RepoRef): boolean {
  if (!networkAllowed(i)) return false;
  if (repo.kind !== 'custom') return true;
  return i.trusted && i.customReposOptIn && repo.url.startsWith('https://') && !repo.private;
}

/** Under `ask`, once per session, when there is something to check and no answer yet. */
export function shouldPrompt(i: ConsentInput, hasDependencies: boolean, promptedThisSession: boolean): boolean {
  return i.mode === 'ask' && i.workspaceDecision === undefined && !i.sessionGrant && hasDependencies && !promptedThisSession;
}
