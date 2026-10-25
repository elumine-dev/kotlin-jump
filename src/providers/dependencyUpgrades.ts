import type { Dependency, EditSpan, Finding, Policy, RailFinding, RepoKind, UpgradeReport } from '../upgrades/model';
import { compareVersions, isStable } from '../upgrades/gradleVersion';
import { collectDependencies, type GradleFileKind } from '../upgrades/UpgradeEngine';
import { kspFor } from '../upgrades/rails';
import { plural } from '../util/plural';

/**
 * What the editor says about a dependency upgrade (KJ-082), in words a
 * reviewer can check: the diagnostic message, the badge, the hover, the quick
 * fix titles and the markdown report. Pure: no vscode import, the provider
 * wraps it and the tests call it directly.
 *
 * House rules: English, no dash of any kind in the copy (version strings and
 * identifiers are data), counts that agree in number, dates as a month and a
 * year. A fix title says what moves before anyone clicks: a `[versions]` entry
 * read by four libraries moves four libraries.
 */

export type Tier = 'patch' | 'minor' | 'major' | 'other';

export interface Fix {
  title: string;
  edits: EditSpan[];
  preferred: boolean;
  kind: 'bump' | 'pin' | 'comment' | 'bulk' | 'coupled';
  /** The tier a bulk fix applies. */
  tier?: Tier;
  /** Offered greyed out, with the reason, when the fix cannot be written yet. */
  disabledReason?: string;
}

export type BumpEdits = (finding: Finding, to: string, opts?: { wrapper?: { dependency: Dependency; to: string } }) => EditSpan[];

export interface FixExtras {
  /** What an AGP bump drags along, from `UpgradeEngine.wrapperRequirement`. */
  wrapperRequirement?: (finding: Finding, to: string) => { gradle: string; wrapper: Dependency; checksumRequired: boolean } | undefined;
}

const KOTLIN_CORE = new Set(['org.jetbrains.kotlin.jvm', 'org.jetbrains.kotlin.android', 'org.jetbrains.kotlin.multiplatform']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isNumeric = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);

export function tierOf(from: string, to: string): Tier {
  const a = from.split(/[.\-+_]/), b = to.split(/[.\-+_]/);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (!isNumeric(a[i]) || !isNumeric(b[i])) return 'other';
    return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
  }
  return 'other';
}

/** Reported means underlined: a newer version, or a dynamic version with a stable to pin. */
export function isReported(f: Finding): boolean {
  const v = f.verdict;
  return v.kind === 'newer' || (v.kind === 'rich' && v.form === 'dynamic' && v.pin !== undefined);
}

const current = (f: Finding) => f.dependency.currentVersion ?? '';
const sharedCount = (d: Dependency) => (d.sharedBy.length >= 2 ? d.sharedBy.length : 0);
const libraries = (n: number) => plural(n, 'library', 'libraries');

export function messageFor(f: Finding): string {
  const d = f.dependency, v = f.verdict;
  if (v.kind === 'newer') {
    if (v.stability === 'stable') {
      const shared = sharedCount(d) ? `, shared by ${libraries(sharedCount(d))}` : '';
      return `${d.name} ${current(f)}: newer stable ${v.to}, ${plural(v.candidate.newerCount, 'version')} behind${shared}`;
    }
    return `${d.name} ${current(f)}: newer preview ${v.to}${v.alsoStable ? `, stable ${v.alsoStable} available` : ''}`;
  }
  if (v.kind === 'rich' && v.form === 'dynamic' && v.pin) {
    return `${d.name} ${current(f)}: dynamic version, builds can change without a commit. Latest stable is ${v.pin}`;
  }
  return '';
}

export function codeFor(f: Finding): 'outdated-dependency' | 'dynamic-version' {
  return f.verdict.kind === 'rich' ? 'dynamic-version' : 'outdated-dependency';
}

export function severityFor(f: Finding): 'warning' | 'information' {
  return f.verdict.kind === 'rich' ? 'information' : 'warning';
}

export function badgeFor(f: Finding): string | undefined {
  const v = f.verdict;
  if (v.kind === 'newer') return `↑ ${v.to}`;
  if (v.kind === 'rich' && v.form === 'dynamic' && v.pin) return `pin ${v.pin}`;
  return undefined;
}

/** `2025-05-27` reads `May 2025`. */
export function formatReleased(date: string | undefined): string | undefined {
  const m = date ? /^(\d{4})-(\d{2})-\d{2}$/.exec(date) : undefined;
  if (!m) return undefined;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : undefined;
}

/** `25 October 2026`. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function ago(now: number, then: number): string {
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${plural(hours, 'hour')} ago`;
  return `${plural(Math.round(hours / 24), 'day')} ago`;
}

function repoLabel(kind: RepoKind | undefined): string {
  switch (kind) {
    case 'mavenCentral': return 'Maven Central';
    case 'google': return 'Google Maven';
    case 'gradlePluginPortal': return 'the Gradle plugin portal';
    case 'gradle': return 'services.gradle.org';
    default: return 'the declared repository';
  }
}

/** A link per family of libraries, by URL pattern; no request is made for it. */
export function releaseNotesUrl(d: Dependency, version: string): string | undefined {
  const m = d.members[0];
  if (!m) return undefined;
  if (d.kind === 'wrapper') return `https://docs.gradle.org/${version}/release-notes.html`;
  if (d.kind === 'agp') return 'https://developer.android.com/build/releases/gradle-plugin';
  if (m.group.startsWith('org.jetbrains.kotlin')) return `https://github.com/JetBrains/kotlin/releases/tag/v${version}`;
  if (m.group.startsWith('androidx.')) return `https://developer.android.com/jetpack/androidx/releases/${m.group.slice('androidx.'.length).replace(/\./g, '-')}`;
  if (d.kind === 'plugin') return `https://plugins.gradle.org/plugin/${m.group}`;
  return undefined;
}

export function repositoryUrl(d: Dependency, kind: RepoKind | undefined): string | undefined {
  const m = d.members[0];
  if (!m || d.kind === 'wrapper') return undefined;
  if (kind === 'google') return `https://maven.google.com/web/index.html#${m.group}:${m.artifact}`;
  if (kind === 'gradlePluginPortal') return `https://plugins.gradle.org/plugin/${m.group}`;
  return `https://central.sonatype.com/artifact/${m.group}/${m.artifact}`;
}

/** The hover, as markdown. */
export function hoverFor(f: Finding, rails: readonly RailFinding[], now: number): string {
  const d = f.dependency, v = f.verdict;
  const lines: string[] = [];
  const coordinate = d.members[0] ? `${d.members[0].group}:${d.members[0].artifact}` : d.name;
  const shared = sharedCount(d) ? `Shared by ${libraries(sharedCount(d))}: ${d.sharedBy.map(s => s.alias).join(', ')}` : '';
  switch (v.kind) {
    case 'newer': {
      lines.push(`**${d.name}** ${current(f)}: newer ${v.stability === 'stable' ? 'stable' : 'preview'} **${v.to}**`);
      const released = formatReleased(v.candidate.releasedAt);
      lines.push(`${plural(v.candidate.newerCount, 'version')} behind${released ? `, latest published ${released}` : ''}`);
      if (v.alsoStable) lines.push(`Stable ${v.alsoStable} is available too`);
      else if (v.candidate.latest !== v.to && !isStable(v.candidate.latest) && compareVersions(v.candidate.latest, current(f)) > 0) lines.push(`Preview available: ${v.candidate.latest}`);
      if (shared) lines.push(shared);
      lines.push(links(d, v.to, v.candidate.repository));
      lines.push(`Checked ${ago(now, v.candidate.fetchedAt)} from ${repoLabel(v.candidate.repository)}`);
      break;
    }
    case 'upToDate': {
      const preview = v.candidate.latest && !isStable(v.candidate.latest) && compareVersions(v.candidate.latest, current(f)) > 0 ? `. Preview available: ${v.candidate.latest}` : '';
      lines.push(`${d.name} ${current(f)} is the latest stable${preview}, checked ${ago(now, v.candidate.fetchedAt)}`);
      if (shared) lines.push(shared);
      break;
    }
    case 'unknown':
      lines.push(v.reason === 'noConsent'
        ? 'Version checks are off. Run Kotlin Jump: Check Dependency Upgrades to turn them on'
        : v.reason === 'pending' ? `Checking ${coordinate}` : `No version data for ${coordinate}: ${v.reason}${v.detail ? ` (${v.detail})` : ''}`);
      break;
    case 'pinned':
      lines.push(`${d.name} ${current(f)} is pinned (${v.by === 'pin-comment' ? '# @pin' : 'kotlin-jump:ignore'}). Upgrades are not reported for it`);
      break;
    case 'rich':
      if (v.form === 'dynamic') lines.push(v.pin ? messageFor(f) : `${d.name} ${current(f)}: dynamic version, no stable pin known yet`);
      else lines.push(`${d.name}: rich version, not checked`);
      break;
    case 'bomManaged':
      lines.push(`${d.name}: version managed by a BOM, nothing to bump here`);
      break;
  }
  for (const r of rails) if (r.dependency.key === d.key) lines.push(r.message);
  return lines.filter(Boolean).join('  \n');
}

function links(d: Dependency, version: string, repo: RepoKind | undefined): string {
  const parts: string[] = [];
  const notes = releaseNotesUrl(d, version);
  if (notes) parts.push(`[Release notes](${notes})`);
  const repoUrl = repositoryUrl(d, repo);
  if (repoUrl) parts.push(`[${repoLabel(repo)}](${repoUrl})`);
  return parts.join(' · ');
}

function lineEndAfter(text: string, offset: number): number {
  const i = text.indexOf('\n', offset);
  const end = i < 0 ? text.length : i;
  return text[end - 1] === '\r' ? end - 1 : end;
}

function commentFix(f: Finding, textOf: (file: string) => string | undefined): Fix | undefined {
  const d = f.dependency;
  const text = textOf(d.range.file);
  if (!text) return undefined;
  const end = lineEndAfter(text, d.range.start);
  const toml = d.source.startsWith('toml');
  const marker = toml ? ' # @pin' : d.source === 'wrapper' ? ' # kotlin-jump:ignore dependency-upgrade' : ' // kotlin-jump:ignore dependency-upgrade';
  return {
    title: toml ? `Pin ${d.name} at ${current(f)} with # @pin` : 'Ignore this version in upgrade checks',
    edits: [{ file: d.range.file, start: end, end, newText: marker }], preferred: false, kind: 'comment',
  };
}

/** The bumps of one tier in one file, the current finding included. */
function bulkOf(f: Finding, report: UpgradeReport, tier: Tier, bump: BumpEdits): Fix | undefined {
  if (tier !== 'patch' && tier !== 'minor') return undefined;
  const same = report.findings.filter(x => x.dependency.range.file === f.dependency.range.file && x.verdict.kind === 'newer'
    && tierOf(current(x), x.verdict.to) === tier);
  if (same.length < 2) return undefined;
  const edits = same.flatMap(x => (x.verdict.kind === 'newer' ? bump(x, x.verdict.to) : []));
  return { title: `Bump all ${same.length} ${tier} versions in this file`, edits, preferred: false, kind: 'bulk', tier };
}

export function fixesFor(f: Finding, report: UpgradeReport, policy: Policy, textOf: (file: string) => string | undefined, bump: BumpEdits, extras: FixExtras = {}): Fix[] {
  const d = f.dependency, v = f.verdict;
  const out: Fix[] = [];
  const movers = sharedCount(d) ? `, ${libraries(sharedCount(d))} move` : '';
  const rail = report.rails.find(r => r.rail === 'ksp-kotlin' && r.dependency.key === d.key && r.compatiblePick);

  if (rail && rail.compatiblePick) {
    out.push({ title: `Bump ${d.name} to ${rail.compatiblePick}, matches Kotlin ${rail.expected}`, edits: rail.edits ?? [], preferred: true, kind: 'bump' });
    const kotlin = report.findings.find(x => x.verdict.kind === 'newer' && x.dependency.members.some(m => KOTLIN_CORE.has(m.group)));
    if (kotlin && kotlin.verdict.kind === 'newer' && v.kind === 'newer') {
      const kspTo = kspFor(kotlin.verdict.to, v.candidate.versions);
      if (kspTo) {
        out.push({
          title: `Bump ${kotlin.dependency.name} to ${kotlin.verdict.to} and ${d.name} to ${kspTo} together`,
          edits: [...bump(kotlin, kotlin.verdict.to), ...bump(f, kspTo)], preferred: false, kind: 'coupled',
        });
      }
    }
  } else if (v.kind === 'newer') {
    const requirement = d.kind === 'agp' ? extras.wrapperRequirement?.(f, v.to) : undefined;
    const previewSuffix = v.stability === 'stable' ? '' : ', preview';
    if (requirement) {
      const edits = bump(f, v.to, { wrapper: { dependency: requirement.wrapper, to: requirement.gradle } });
      out.push({
        title: `Bump ${d.name} to ${v.to} and the Gradle wrapper to ${requirement.gradle}`, edits, preferred: !requirement.checksumRequired, kind: 'bump',
        ...(requirement.checksumRequired ? { disabledReason: 'The wrapper declares distributionSha256Sum. Run Kotlin Jump: Check Dependency Upgrades, which fetches the checksum before writing it.' } : {}),
      });
    } else {
      out.push({ title: `Bump ${d.name} to ${v.to}${movers}${previewSuffix}`, edits: bump(f, v.to), preferred: true, kind: 'bump' });
    }
    if (v.stability === 'stable' && policy !== 'stable' && v.candidate.latest !== v.to && !isStable(v.candidate.latest) && compareVersions(v.candidate.latest, current(f)) > 0) {
      out.push({ title: `Bump ${d.name} to ${v.candidate.latest}${movers}, preview`, edits: bump(f, v.candidate.latest), preferred: false, kind: 'bump' });
    }
    if (v.stability === 'preRelease' && v.alsoStable) {
      out.push({ title: `Bump ${d.name} to ${v.alsoStable}${movers}, stable`, edits: bump(f, v.alsoStable), preferred: false, kind: 'bump' });
    }
    const bulk = bulkOf(f, report, tierOf(current(f), v.to), bump);
    if (bulk) out.push(bulk);
  } else if (v.kind === 'rich' && v.form === 'dynamic' && v.pin) {
    out.push({ title: `Pin ${d.name} to ${v.pin}`, edits: bump(f, v.pin), preferred: true, kind: 'pin' });
  }

  if (isReported(f)) {
    const comment = commentFix(f, textOf);
    if (comment) out.push(comment);
  }
  return out;
}

/**
 * After an edit, the findings of a file are re-read by key: an entry whose
 * literal still reads the same keeps its finding at its new place, an entry
 * that changed loses it until the engine re-evaluates the file.
 */
export function reanchor(text: string, file: string, kind: GradleFileKind, findings: readonly Finding[]): Finding[] {
  const fresh = collectDependencies({ path: file, text, kind });
  if (fresh.unparsed) return [];
  const byKey = new Map(fresh.dependencies.map(d => [d.key, d]));
  const out: Finding[] = [];
  for (const f of findings) {
    const d = byKey.get(f.dependency.key);
    if (!d || d.currentVersion !== f.dependency.currentVersion) continue;
    out.push({ ...f, dependency: d });
  }
  return out;
}

export interface ReportInput {
  findings: readonly Finding[];
  rails: readonly RailFinding[];
  checkedAt: number;
  sources: readonly RepoKind[];
  policy: Policy;
  /** Workspace root, to write paths relative to it. */
  racine: string;
}

const relative = (path: string, racine: string) => (path.startsWith(`${racine}/`) ? path.slice(racine.length + 1) : path);
const policyLabel = (p: Policy) => (p === 'preferStable' ? 'prefer stable' : p === 'stable' ? 'stable only' : 'latest');

/** The markdown a pull request description can carry. */
export function buildReport(input: ReportInput): string {
  const newer = input.findings.filter(f => f.verdict.kind === 'newer');
  const byTier = new Map<Tier, Finding[]>();
  for (const f of newer) {
    const t = f.verdict.kind === 'newer' ? tierOf(current(f), f.verdict.to) : 'other';
    byTier.set(t, [...(byTier.get(t) ?? []), f]);
  }
  const order: Tier[] = ['major', 'minor', 'patch', 'other'];
  const counts = order.filter(t => byTier.has(t)).map(t => `${byTier.get(t)!.length} ${t}`).join(', ');
  const out: string[] = ['## Dependency upgrades', ''];
  out.push(`${plural(newer.length, 'upgrade')} available${counts ? `: ${counts}` : ''}. Checked ${formatDate(input.checkedAt)} against ${input.sources.map(repoLabel).join(', ')}. Policy: ${policyLabel(input.policy)}.`);
  if (newer.length > 0) {
    out.push('', '| Dependency | Current | Latest stable | Type | Release notes |', '|---|---|---|---|---|');
    for (const t of order) {
      for (const f of byTier.get(t) ?? []) {
        if (f.verdict.kind !== 'newer') continue;
        const d = f.dependency;
        const who = sharedCount(d) ? `${d.name} (${libraries(sharedCount(d))})` : `${d.name} (${d.members[0]?.group}:${d.members[0]?.artifact})`;
        const notes = releaseNotesUrl(d, f.verdict.to) ?? repositoryUrl(d, f.verdict.candidate.repository);
        out.push(`| ${who} | ${current(f)} | ${f.verdict.to} | ${t} | ${notes ? `[notes](${notes})` : ''} |`);
      }
    }
  }
  const dynamic = input.findings.filter(f => f.verdict.kind === 'rich' && f.verdict.form === 'dynamic' && f.verdict.pin);
  const unknown = input.findings.filter(f => f.verdict.kind === 'unknown');
  const pinned = input.findings.filter(f => f.verdict.kind === 'pinned');
  const rails = input.rails;
  if (dynamic.length + unknown.length + pinned.length + rails.length > 0) out.push('');
  if (rails.length > 0) out.push(`Compatibility (${rails.length}): ${rails.map(r => r.message).join('; ')}`);
  if (dynamic.length > 0) out.push(`Dynamic (${dynamic.length}): ${dynamic.map(f => `${f.dependency.name} ${current(f)}, latest stable ${f.verdict.kind === 'rich' ? f.verdict.pin : ''}`).join('; ')}`);
  if (unknown.length > 0) out.push(`Not checked (${unknown.length}): ${unknown.map(f => `${f.dependency.name} ${current(f)} (${f.verdict.kind === 'unknown' ? f.verdict.reason : ''})`).join('; ')}`);
  if (pinned.length > 0) out.push(`Pinned (${pinned.length}): ${pinned.map(f => `${f.dependency.name} ${current(f)} in ${relative(f.dependency.range.file, input.racine)}`).join('; ')}`);
  return `${out.join('\n')}\n`;
}
