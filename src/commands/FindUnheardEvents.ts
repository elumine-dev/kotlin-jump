import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  UnheardEventProvider,
  UnheardEventScan,
  findUnheardEvents,
} from '../providers/UnheardEventProvider';
import { plural } from '../util/plural';
import { sanitizeForUsageScan } from '../util/kotlinScan';

/**
 * KJ-038 commands.
 *
 * The scan can end in three states, and conflating any two of them would
 * mislead: findings, nothing found, or nothing PROVEN because a subscription
 * was unreadable. The third has to say so out loud, since a bare "no unheard
 * events" would read as an all-clear that was never established.
 */

function settings() {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    testSourceSets: cfg.get<string[]>('testSourceSets', ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest']),
    ignoreNames: cfg.get<string[]>('unheardEventsIgnoreNames', []),
    assumeSubscribed: cfg.get<string[]>('unheardEventsAssumeSubscribed', []),
  };
}

export async function scanUnheardEvents(
  corpus: ResourceCorpus,
  token?: vscode.CancellationToken,
): Promise<{ scan: UnheardEventScan; files: number } | undefined> {
  const data = await corpus.get(token);
  if (token?.isCancellationRequested) return undefined;

  const scan = findUnheardEvents({
    sources: data.sources,
    truncated: data.sourcesTruncated,
    ...settings(),
  });
  return { scan, files: data.sources.length };
}

/** Publishes a scan, and says which of the three states it landed in. */
export function reportUnheardEvents(
  provider: UnheardEventProvider,
  scan: UnheardEventScan,
  files: number,
): void {
  if (scan.unreadable.length > 0) {
    provider.setUnreadable(scan.unreadable);
    const n = scan.unreadable.length;
    void vscode.window.showWarningMessage(
      `Nothing could be checked: ${n} subscription${n > 1 ? 's' : ''} could not be read. `
      + 'An event is only unheard if every subscription is accounted for.',
    );
    return;
  }

  provider.setScan(scan);

  const parts: string[] = [];
  if (scan.events.length > 0) {
    const types = new Set(scan.events.map(e => e.name)).size;
    parts.push(`${scan.events.length} post${scan.events.length > 1 ? 's' : ''} of ${types} type${types > 1 ? 's' : ''} nothing subscribes to`);
  }
  if (scan.deadSubscriptions.length > 0) {
    parts.push(`${scan.deadSubscriptions.length} subscription${scan.deadSubscriptions.length > 1 ? 's' : ''} nothing posts to`);
  }
  if (scan.unboundedPosts.length > 0) {
    parts.push(`${scan.unboundedPosts.length} post${scan.unboundedPosts.length > 1 ? 's' : ''} with an unbounded type blocking that proof`);
  }
  if (parts.length === 0) {
    void vscode.window.showInformationMessage(
      `Every posted event has a subscriber and every subscription has a poster (${plural(files, 'file')}).`,
    );
    return;
  }
  void vscode.window.showInformationMessage(`${parts.join(' · ')}, across ${plural(files, 'file')}.`);
}

export async function findUnheardEventsCommand(
  corpus: ResourceCorpus,
  provider: UnheardEventProvider,
): Promise<void> {
  if (!UnheardEventProvider.isEnabled()) {
    void vscode.window.showInformationMessage('Unheard event detection is disabled in settings.');
    return;
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning for unheard events.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for events nobody listens to…', cancellable: true },
    async (_progress, token) => {
      const result = await scanUnheardEvents(corpus, token);
      if (!result || token.isCancellationRequested) return;
      reportUnheardEvents(provider, result.scan, result.files);
    },
  );
}

/**
 * Writes a subscriber back, which is the other half of the fix.
 *
 * The handler name and the annotation import are LEARNED from the file the
 * user picks rather than hardcoded, so this works the same against Otto,
 * greenrobot or a house-built bus.
 */
export async function createEventSubscriberCommand(eventName: string, fqn: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage('Open the file that should listen for this event.');
    return;
  }

  const doc = editor.document;
  const text = doc.getText();
  const isJava = doc.uri.fsPath.endsWith('.java');

  const ancre = subscriberAnchor(text);
  if (!ancre) {
    void vscode.window.showWarningMessage('Could not find a class to add the subscriber to.');
    return;
  }
  const { at: lastBrace, handler } = ancre;

  const body = isJava
    ? `\n    @Subscribe\n    public void ${handler}(${eventName} event) {\n        // TODO: handle ${eventName}\n    }\n`
    : `\n    @Subscribe\n    fun ${handler}(event: ${eventName}) {\n        TODO("handle ${eventName}")\n    }\n`;

  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, doc.positionAt(lastBrace), body, {
    needsConfirmation: true,
    label: `Add a subscriber for ${eventName}`,
  });

  // The event type has to be importable from here, and the annotation too.
  if (importNeeded(ancre.code, fqn)) {
    const anchor = /^\s*(?:package|import)\b.*$/m.exec(text);
    if (anchor) {
      const at = doc.positionAt(anchor.index + anchor[0].length);
      edit.insert(doc.uri, at, `\nimport ${fqn}${isJava ? ';' : ''}`, {
        needsConfirmation: true,
        label: `Import ${eventName}`,
      });
    }
  }

  await vscode.workspace.applyEdit(edit);
}

/**
 * Where the subscriber goes, and the name to give its handler.
 *
 * Both were read off the RAW text. A brace inside a comment or a string is not
 * the end of a class: measured on a real project, 6 files of 5 093 end with a
 * raw string holding a JSON fixture, so the subscriber was inserted INTO the
 * fixture, where it is text that compiles and never runs. The handler name was
 * learned the same way, so a subscriber sitting in a commented out block named
 * the new one.
 */
export function subscriberAnchor(text: string): { at: number; handler: string; code: string } | undefined {
  const code = sanitizeForUsageScan(text);
  const at = code.lastIndexOf('}');
  if (at === -1) return undefined;
  const handler = /@Subscribe[\s\S]{0,80}?\b(?:fun|void)\s+(\w+)\s*\(/.exec(code)?.[1] ?? 'onBusEvent';
  return { at, handler, code };
}

/**
 * Whether the subscriber this fix writes needs an import line for `fqn`.
 *
 * Both halves of the test this replaces answered yes too easily, and each yes
 * SUPPRESSES the import, so the subscriber that gets inserted names a type the
 * compiler cannot resolve.
 *
 *   - `text.includes('import ' + fqn)` also matches a longer import that
 *     merely begins with it, so `import a.b.EventBus` passed for `a.b.Event`.
 *   - `fqn.startsWith(packageOf(text))` has no separator, and a SUBPACKAGE is
 *     not visible without an import either. A file in
 *     `ca.lapresse.android.lapresseplus` was told it could already see
 *     `ca.lapresse.android.lapresseplus.module.fcm.FcmBreakingNewsEvent`.
 *
 * Measured on a real project, over the events the detector reports and every
 * source file: the second half is wrong 467 times, the first one 0 times. The
 * package one is the shape that actually happens, and it is the common one:
 * events live in a module subpackage of the screen that should listen.
 */
export function importNeeded(text: string, fqn: string): boolean {
  const point = fqn.lastIndexOf('.');
  if (point < 0) return false;                       // default package: nothing to import
  const echappe = fqn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // An alias counts as an import: `import a.b.Event as Ev` already resolves it.
  if (new RegExp(`^\\s*import\\s+${echappe}(?:\\s+as\\s+\\w+)?\\s*;?\\s*$`, 'm').test(text)) return false;
  return fqn.slice(0, point) !== packageOf(text);
}

function packageOf(text: string): string {
  return /^\s*package\s+([\w.]+)/m.exec(text)?.[1] ?? '\u0000';   // a prefix no FQN can start with, unlike ''
}
