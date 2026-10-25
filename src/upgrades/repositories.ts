import type { RepoRef, RepositorySet } from './model';

/**
 * Which Maven repositories a build declares (KJ-082).
 *
 * The version check must ask the repositories the build itself resolves
 * from. Guessing from the group prefix misses JitPack, the JetBrains Compose
 * dev repository and any private Nexus, and it would send a request to a
 * host the build never named. So the settings and build files are read:
 * `pluginManagement` and `buildscript` feed the plugin repositories,
 * `dependencyResolutionManagement`, `allprojects`, `subprojects` and the top
 * level `repositories` block feed the project ones. Declaration order is
 * kept, because it is the order Gradle searches in.
 *
 * Nothing here imports vscode or Node: the harness and the tests call it
 * with texts.
 */

export const MAVEN_CENTRAL_URL = 'https://repo1.maven.org/maven2';
export const GOOGLE_MAVEN_URL = 'https://dl.google.com/dl/android/maven2';
export const GRADLE_PLUGIN_PORTAL_URL = 'https://plugins.gradle.org/m2';

const CENTRAL: RepoRef = { kind: 'mavenCentral', url: MAVEN_CENTRAL_URL };
const GOOGLE: RepoRef = { kind: 'google', url: GOOGLE_MAVEN_URL };
const PORTAL: RepoRef = { kind: 'gradlePluginPortal', url: GRADLE_PLUGIN_PORTAL_URL };

/** Gradle's own defaults when a build declares nothing readable. */
export const DEFAULT_REPOSITORIES: RepositorySet = {
  plugins: [PORTAL, CENTRAL, GOOGLE],
  project: [CENTRAL, GOOGLE],
};

export interface GradleFileText {
  path: string;
  text: string;
  kind: 'settings' | 'build';
}

/**
 * Blanks `//` and `/* *\/` comments while keeping every offset and newline,
 * in both Gradle DSLs: Groovy writes `'https://jitpack.io'` with single
 * quotes, and a stripper that knows only double quotes would read the `//`
 * of the URL as a comment and blank the rest of the line.
 */
export function blankGradleComments(text: string): string {
  const out: string[] = [];
  let mode: 'code' | 'line' | 'block' | 'dq' | 'sq' | 'raw' = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out.push('  '); i++; continue; }
      if (two === '/*') { mode = 'block'; out.push('  '); i++; continue; }
      if (text.startsWith('"""', i)) { mode = 'raw'; out.push('"""'); i += 2; continue; }
      if (ch === '"') mode = 'dq';
      else if (ch === "'") mode = 'sq';
      out.push(ch);
    } else if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
    } else if (mode === 'block') {
      if (two === '*/') { mode = 'code'; out.push('  '); i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
    } else if (mode === 'raw') {
      if (ch === '"') {
        let run = 0;
        while (i + run < text.length && text[i + run] === '"') run++;
        if (run >= 3) { mode = 'code'; out.push('"'.repeat(run)); i += run - 1; continue; }
      }
      out.push(ch);
    } else {
      if (ch === '\\') { out.push(two); i++; continue; }
      if ((mode === 'dq' && ch === '"') || (mode === 'sq' && ch === "'") || ch === '\n') mode = 'code';
      out.push(ch);
    }
  }
  return out.join('');
}

/** A `name { ... }` block: content offsets in the stripped text and the names of its enclosing blocks. */
export interface GradleBlock {
  name: string;
  start: number;
  end: number;
  parents: string[];
}

/** Every brace delimited block, named by the identifier before its `{` (an argument list is skipped). */
export function findGradleBlocks(clean: string): GradleBlock[] {
  const blocks: GradleBlock[] = [];
  const stack: { name: string; start: number }[] = [];
  let quote: string | undefined;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quote !== undefined) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote || ch === '\n') quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') { stack.push({ name: nameBefore(clean, i), start: i + 1 }); continue; }
    if (ch === '}') {
      const open = stack.pop();
      if (!open) continue;
      blocks.push({ name: open.name, start: open.start, end: i, parents: stack.map(s => s.name) });
    }
  }
  return blocks;
}

/** The identifier that owns the brace at `brace`: `maven {`, `maven("x") {`, `tasks.register("x") {`. */
function nameBefore(clean: string, brace: number): string {
  let i = brace - 1;
  while (i >= 0 && /\s/.test(clean[i])) i--;
  if (clean[i] === ')') {
    let depth = 0;
    for (; i >= 0; i--) {
      if (clean[i] === ')') depth++;
      else if (clean[i] === '(') { depth--; if (depth === 0) { i--; break; } }
    }
    while (i >= 0 && /\s/.test(clean[i])) i--;
  }
  let j = i;
  while (j >= 0 && /[\w.]/.test(clean[j])) j--;
  return clean.slice(j + 1, i + 1);
}

const WELL_KNOWN: Record<string, RepoRef> = { mavenCentral: CENTRAL, google: GOOGLE, gradlePluginPortal: PORTAL };
const SIMPLE_CALL_RE = /\b(mavenCentral|google|gradlePluginPortal)\s*\(\s*\)/g;
const MAVEN_CALL_RE = /\bmaven\s*\(\s*(?:url\s*=\s*)?(?:uri\s*\(\s*)?(["'])([^"'\n]*)\1\s*\)?\s*\)/g;
const URL_IN_BLOCK_RES = [
  /\burl\s*=\s*uri\s*\(\s*(["'])([^"'\n]*)\1\s*\)/,
  /\burl\s*=\s*(["'])([^"'\n]*)\1/,
  /\burl\s+(["'])([^"'\n]*)\1/,
  /\bsetUrl\s*\(\s*(["'])([^"'\n]*)\1\s*\)/,
  /\buri\s*\(\s*(["'])([^"'\n]*)\1\s*\)/,
];

/** A URL the check may contact: https only, nothing templated, no trailing slash. */
function customRepo(url: string, isPrivate: boolean): RepoRef | undefined {
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://') || trimmed.includes('$')) return undefined;
  const ref: RepoRef = { kind: 'custom', url: trimmed.replace(/\/+$/, '') };
  return isPrivate ? { ...ref, private: true } : ref;
}

/** The repositories one `repositories { }` block declares, in order. */
function repositoriesIn(clean: string, block: GradleBlock, blocks: readonly GradleBlock[]): RepoRef[] {
  const content = clean.slice(block.start, block.end);
  const found: { at: number; ref: RepoRef }[] = [];

  for (const m of content.matchAll(SIMPLE_CALL_RE)) found.push({ at: m.index ?? 0, ref: WELL_KNOWN[m[1]] });
  for (const m of content.matchAll(MAVEN_CALL_RE)) {
    const ref = customRepo(m[2], false);
    if (ref) found.push({ at: m.index ?? 0, ref });
  }
  for (const sub of blocks) {
    if (sub.name !== 'maven' || sub.start <= block.start || sub.end > block.end) continue;
    if (sub.parents.length !== block.parents.length + 1) continue;
    const body = clean.slice(sub.start, sub.end);
    let url: string | undefined;
    for (const re of URL_IN_BLOCK_RES) { const m = re.exec(body); if (m) { url = m[2]; break; } }
    if (url === undefined) continue;
    const ref = customRepo(url, /\bcredentials\b/.test(body));
    if (ref) found.push({ at: sub.start - block.start, ref });
  }

  return found.sort((a, b) => a.at - b.at).map(f => f.ref);
}

/** Which set a `repositories` block feeds, given the file it sits in and the block that encloses it. */
function setOf(kind: GradleFileText['kind'], parents: readonly string[]): 'plugins' | 'project' | undefined {
  const parent = parents[parents.length - 1];
  if (kind === 'settings') {
    if (parents.length === 1 && parent === 'pluginManagement') return 'plugins';
    if (parents.length === 1 && parent === 'dependencyResolutionManagement') return 'project';
    return undefined;
  }
  if (parents.length === 0) return 'project';
  if (parents.length === 1 && parent === 'buildscript') return 'plugins';
  if (parents.length === 1 && (parent === 'allprojects' || parent === 'subprojects')) return 'project';
  return undefined;
}

function dedupe(refs: readonly RepoRef[]): RepoRef[] {
  const seen = new Set<string>();
  const out: RepoRef[] = [];
  for (const r of refs) { if (!seen.has(r.url)) { seen.add(r.url); out.push(r); } }
  return out;
}

/**
 * The repositories a build declares, settings files first, in declaration
 * order and without duplicates. A set nothing declares falls back to Gradle's
 * defaults, never to a custom host.
 */
export function readRepositories(files: readonly GradleFileText[]): RepositorySet {
  const plugins: RepoRef[] = [];
  const project: RepoRef[] = [];
  const ordered = [...files].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'settings' ? -1 : 1));
  for (const file of ordered) {
    const clean = blankGradleComments(file.text);
    const blocks = findGradleBlocks(clean);
    for (const block of blocks) {
      if (block.name !== 'repositories') continue;
      const set = setOf(file.kind, block.parents);
      if (set === undefined) continue;
      (set === 'plugins' ? plugins : project).push(...repositoriesIn(clean, block, blocks));
    }
  }
  return {
    plugins: plugins.length > 0 ? dedupe(plugins) : [...DEFAULT_REPOSITORIES.plugins],
    project: project.length > 0 ? dedupe(project) : [...DEFAULT_REPOSITORIES.project],
  };
}
