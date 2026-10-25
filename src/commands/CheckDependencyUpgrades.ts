import * as vscode from 'vscode';
import type { UpgradeEngine } from '../upgrades/UpgradeEngine';
import type { UpgradeSession } from '../providers/UpgradeSession';
import type { DependencyUpgradeProvider } from '../providers/DependencyUpgradeProvider';
import type { CheckMode } from '../upgrades/consent';
import type { CacheEntry, EditSpan, Finding, Policy, RailFinding, RepoKind } from '../upgrades/model';
import { buildReport, tierOf, type Tier } from '../providers/dependencyUpgrades';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';
import { plural } from '../util/plural';
import { corpusUri } from '../util/corpusUri';
import { estLeFichier } from '../util/measuredText';

/**
 * KJ-082 commands: Check Dependency Upgrades, the bulk apply the quick fixes
 * call, the report, and the consent flow.
 *
 * Network is a decision the user takes: under `ask` one prompt per workspace,
 * answered Check now (this workspace), Always (the setting, globally) or Never
 * (the setting too). The explicit command counts as consent for its run, the
 * way downloading sources does. A zero result is a sentence with its counts,
 * never a silence.
 */

export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface CommandContext {
  engine: UpgradeEngine;
  session: UpgradeSession;
  provider: DependencyUpgradeProvider;
  /** Workspace folder paths. */
  folders: () => string[];
  config: () => { check: CheckMode; policy: Policy };
  /** Writes `kotlinJump.upgrades.check` at the global target. */
  setCheck: (mode: CheckMode) => Thenable<void>;
  workspaceState: Memento;
  now?: () => number;
}

export const DECISION_KEY = 'kotlinJump.upgrades.decision';
export const APPLY_COMMAND_ID = 'kotlin-jump.applyDependencyUpgrades';

const CHECK_NOW = 'Check now';
const ALWAYS = 'Always';
const NEVER = 'Never';
const TURN_ON = 'Turn on';
const CONSENT_MESSAGE = 'Kotlin Jump can check Maven Central, Google Maven and the Gradle plugin portal for newer versions of the dependencies in this project. '
  + 'Only group and artifact names are sent, over HTTPS, and answers are cached for a day.';

const prompted = new Set<string>();

/** Tests run several sessions in one process. */
export function resetConsentPrompts(): void { prompted.clear(); }

/** Under `ask`, one prompt per workspace and per session; `on` and `off` answer at once. */
export async function ensureConsent(ctx: CommandContext, folder: string): Promise<boolean> {
  const { check } = ctx.config();
  if (check === 'on') return true;
  if (check === 'off') return false;
  const decision = ctx.workspaceState.get<'granted' | 'denied'>(DECISION_KEY);
  if (decision === 'granted') return true;
  if (decision === 'denied') return false;
  if (prompted.has(folder)) return false;
  prompted.add(folder);
  const answer = await vscode.window.showInformationMessage(CONSENT_MESSAGE, CHECK_NOW, ALWAYS, NEVER);
  if (answer === CHECK_NOW) { await ctx.workspaceState.update(DECISION_KEY, 'granted'); return true; }
  if (answer === ALWAYS) { await ctx.setCheck('on'); return true; }
  if (answer === NEVER) { await ctx.setCheck('off'); return false; }
  return false;
}

type Choice = 'patch' | 'minor' | 'patchAndMinor';

interface PickItem extends vscode.QuickPickItem {
  action: 'apply' | 'report' | 'copy' | 'unknown';
  tier?: Choice;
}

const tiersOf = (choice: Choice): Tier[] => (choice === 'patchAndMinor' ? ['patch', 'minor'] : [choice]);
const current = (f: Finding) => f.dependency.currentVersion ?? '';
const tierOfFinding = (f: Finding): Tier => (f.verdict.kind === 'newer' ? tierOf(current(f), f.verdict.to) : 'other');

function repoLabel(kind: RepoKind): string {
  switch (kind) {
    case 'mavenCentral': return 'Maven Central';
    case 'google': return 'Google Maven';
    case 'gradlePluginPortal': return 'the Gradle plugin portal';
    case 'gradle': return 'services.gradle.org';
    default: return 'the declared repository';
  }
}

function sourcesOf(findings: readonly Finding[]): RepoKind[] {
  const out = new Set<RepoKind>();
  for (const f of findings) {
    if (f.verdict.kind === 'newer' || f.verdict.kind === 'upToDate') { if (f.verdict.candidate.repository) out.add(f.verdict.candidate.repository); }
  }
  return [...out];
}

/** Publishes the whole workspace through the provider, with the `command` origin. */
async function publishAll(ctx: CommandContext, folder: string): Promise<{ findings: Finding[]; rails: RailFinding[] }> {
  const { files, report } = await ctx.session.evaluate(folder);
  for (const file of files) {
    const findings = report.findings.filter(f => f.dependency.range.file === file.path);
    const rails = report.rails.filter(r => r.dependency.range.file === file.path);
    const was = ctx.provider.findingsFor(file.path);
    ctx.provider.setFindings(file.path, file.kind, file.text, findings, rails, was?.origin === 'open' && findings.length === 0 ? 'open' : 'command');
  }
  return { findings: report.findings, rails: report.rails };
}

export async function checkDependencyUpgradesCommand(ctx: CommandContext, opts: { refresh?: boolean } = {}): Promise<void> {
  const folders = ctx.folders();
  if (folders.length === 0) { void vscode.window.showWarningMessage('Open a folder with a Gradle build first.'); return; }
  if (ctx.config().check === 'off') {
    const answer = await vscode.window.showInformationMessage('Dependency upgrade checks are off in settings.', TURN_ON);
    if (answer !== TURN_ON) return;
    await ctx.setCheck('on');
  }
  if (!(await ensureConsent(ctx, folders[0]))) return;
  ctx.engine.grantConsentForSession();

  const findings: Finding[] = [];
  const rails: RailFinding[] = [];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Checking dependency versions', cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      for (const folder of folders) {
        progress.report({ message: folder.split(/[\\/]/).pop() });
        const r = await ctx.session.refresh(folder, { force: opts.refresh, signal: controller.signal });
        if (r.quietHosts.length > 0) progress.report({ message: `${r.quietHosts.join(', ')} asked for a pause` });
        const published = await publishAll(ctx, folder);
        findings.push(...published.findings);
        rails.push(...published.rails);
        if (token.isCancellationRequested) break;
      }
    },
  );

  const newer = findings.filter(f => f.verdict.kind === 'newer');
  const sources = sourcesOf(findings);
  const against = sources.length ? sources.map(repoLabel).join(', ') : 'the cache';
  if (newer.length === 0) {
    const judged = findings.filter(f => f.verdict.kind === 'upToDate' || f.verdict.kind === 'newer');
    const libraries = judged.filter(f => f.dependency.kind === 'library').length;
    const plugins = judged.filter(f => f.dependency.kind === 'plugin' || f.dependency.kind === 'agp').length;
    void vscode.window.showInformationMessage(`Every dependency is at its latest stable version. Checked ${plural(libraries, 'library', 'libraries')} and ${plural(plugins, 'plugin')} against ${against}.`);
    return;
  }

  const byTier = { major: 0, minor: 0, patch: 0, other: 0 } as Record<Tier, number>;
  for (const f of newer) byTier[tierOfFinding(f)]++;
  const counts = (['major', 'minor', 'patch'] as Tier[]).filter(t => byTier[t] > 0).map(t => `${byTier[t]} ${t}`).join(', ');
  const unknown = findings.filter(f => f.verdict.kind === 'unknown' && f.verdict.reason !== 'pending');
  const items: PickItem[] = [];
  if (byTier.patch > 0) items.push({ label: `$(arrow-up) Apply all ${plural(byTier.patch, 'patch bump')}`, action: 'apply', tier: 'patch' });
  if (byTier.minor > 0) items.push({ label: `$(arrow-up) Apply all ${plural(byTier.minor, 'minor bump')}`, action: 'apply', tier: 'minor' });
  if (byTier.patch > 0 && byTier.minor > 0) items.push({ label: `$(arrow-up) Apply all ${byTier.patch + byTier.minor} patch and minor bumps`, action: 'apply', tier: 'patchAndMinor' });
  items.push({ label: '$(book) Open report', action: 'report' }, { label: '$(clippy) Copy report', action: 'copy' });
  if (unknown.length > 0) items.push({ label: `$(info) ${plural(unknown.length, 'dependency', 'dependencies')} not checked`, action: 'unknown' });

  const picked = await vscode.window.showQuickPick(items, { placeHolder: `Dependency upgrades: ${counts}` });
  if (!picked) return;
  const md = buildReport({ findings, rails, checkedAt: ctx.now?.() ?? Date.now(), sources, policy: ctx.config().policy, racine: folders[0] });
  switch (picked.action) {
    case 'apply': await applyFindings(ctx, newer.filter(f => tiersOf(picked.tier!).includes(tierOfFinding(f)))); return;
    case 'copy': await vscode.env.clipboard.writeText(md); void vscode.window.showInformationMessage('Report copied.'); return;
    default: await openDependencyUpgradeReport(md); return;
  }
}

export async function openDependencyUpgradeReport(markdown: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: markdown });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/** The quick fix route: every bump of one tier in one file. Returns the number of edits written. */
export async function applyDependencyUpgrades(ctx: CommandContext, file: string, tier: Choice, opts: { confirmed?: boolean } = {}): Promise<number> {
  const entry = ctx.provider.findingsFor(file);
  if (!entry) return 0;
  const selected = entry.findings.filter(f => f.verdict.kind === 'newer' && tiersOf(tier).includes(tierOfFinding(f)));
  return applyFindings(ctx, selected, opts);
}

function textOfNow(ctx: CommandContext, file: string): string | undefined {
  return vscode.workspace.textDocuments.find(estLeFichier(file))?.getText() ?? ctx.session.textOf(file);
}

async function applyFindings(ctx: CommandContext, findings: readonly Finding[], opts: { confirmed?: boolean } = {}): Promise<number> {
  const edits: EditSpan[] = [];
  const labels = new Map<EditSpan, string>();
  for (const f of findings) {
    if (f.verdict.kind !== 'newer') continue;
    for (const e of ctx.engine.bumpEdits(f, f.verdict.to, p => textOfNow(ctx, p))) {
      edits.push(e);
      labels.set(e, `${f.dependency.name}: ${current(f)} to ${f.verdict.to}`);
    }
  }
  if (edits.length === 0) return 0;
  const files = [...new Set(edits.map(e => e.file))];
  const choice = opts.confirmed ? 'apply' : await askHowToApply(`Bump ${plural(edits.length, 'version')} in ${plural(files.length, 'file')}?`, bulkDetail(edits.length, files.length));
  if (choice === 'cancel') return 0;

  const edit = new vscode.WorkspaceEdit();
  for (const file of files) {
    const text = textOfNow(ctx, file);
    if (text === undefined) continue;
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    const at = (offset: number) => {
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
      return new vscode.Position(line, offset - starts[line]);
    };
    const uri = corpusUri(file);
    for (const e of edits.filter(x => x.file === file)) {
      const range = new vscode.Range(at(e.start), at(e.end));
      if (choice === 'review') edit.replace(uri, range, e.newText, { needsConfirmation: true, label: labels.get(e) ?? 'Bump' });
      else edit.replace(uri, range, e.newText);
    }
  }
  // The result is read: an edit the editor refused must not be announced as done.
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showWarningMessage('The editor refused the edit. Nothing was changed.');
    return 0;
  }
  for (const file of files) ctx.session.invalidate(file);
  void vscode.window.showInformationMessage(`${plural(edits.length, 'version')} bumped in ${plural(files.length, 'file')}.`);
  return edits.length;
}

/**
 * The passive route: a Gradle file is open. Paint what the cache knows at
 * once, then refresh under consent and repaint when answers land.
 */
export async function openGradleFile(ctx: CommandContext, document: vscode.TextDocument): Promise<void> {
  const file = document.uri.fsPath;
  const folder = ctx.folders().find(f => file.startsWith(`${f}/`) || file.startsWith(`${f}\\`));
  if (!folder || ctx.config().check === 'off') return;
  await publishOpenDocuments(ctx, folder);
  const report = await ctx.session.evaluate(folder);
  const hasDeps = report.report.findings.some(f => f.dependency.currentVersion !== undefined);
  if (!hasDeps || !(await ensureConsent(ctx, folder))) return;
  const r = await ctx.session.refresh(folder);
  if (r.fetched > 0 || r.notModified > 0) await publishOpenDocuments(ctx, folder);
}

/** Publishes, for the open documents only, what the engine knows about a folder. */
export async function publishOpenDocuments(ctx: CommandContext, folder: string): Promise<void> {
  const { files, report } = await ctx.session.evaluate(folder);
  const open = new Set(vscode.workspace.textDocuments.map(d => d.uri.fsPath));
  for (const file of files) {
    if (!open.has(file.path)) continue;
    const text = textOfNow(ctx, file.path) ?? file.text;
    const was = ctx.provider.findingsFor(file.path);
    ctx.provider.setFindings(file.path, file.kind, text, report.findings.filter(f => f.dependency.range.file === file.path), report.rails.filter(r => r.dependency.range.file === file.path), was?.origin ?? 'open');
  }
}

/** The demo recorder only: answers from a fixture, no network, no cache written. */
export async function seedDependencyVersions(ctx: CommandContext, fixturePath: string): Promise<void> {
  if (process.env.KJ_DEMO_MODE !== '1') {
    void vscode.window.showWarningMessage('Seeding dependency versions is for the demo recorder only.');
    return;
  }
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fixturePath));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { entries: Record<string, CacheEntry> };
  // Dated now, so the hover says "checked just now" rather than the age of the fixture.
  const now = ctx.now?.() ?? Date.now();
  ctx.engine.seed(Object.fromEntries(Object.entries(parsed.entries).map(([k, e]) => [k, { ...e, fetchedAt: now }])));
  ctx.engine.grantConsentForSession();
  for (const folder of ctx.folders()) await publishOpenDocuments(ctx, folder);
}
