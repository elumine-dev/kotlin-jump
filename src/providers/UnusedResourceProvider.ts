import * as vscode from 'vscode';
import { FileResEntry, FileResKind, FileResourceIndex } from '../indexer/FileResourceIndex';
import {
  bindingClassTokens,
  bindingStemOf,
  collectCodeResourceRefs,
  collectStringLiterals,
  collectXmlResourceRefs,
} from '../util/xmlRefs';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-029: Android resource FILES nothing references.
 *
 * THE CONTRACT — a finding means: no textual reference to this resource name
 * exists anywhere we can read. It does NOT mean the build has no other
 * consumer. Every rule below exists to make the first sentence true with zero
 * false positives, at the cost of accepted false negatives:
 *
 *  1. Any occurrence we cannot classify counts as a usage.
 *  2. A TRUNCATED corpus produces zero findings — if we could not read
 *     everything, the one reference that matters may be what we missed.
 *  3. The delete quick fix always goes through the Refactor Preview.
 *  4. No reachability analysis: two layouts that include each other are both
 *     alive. Cycles are where these detectors grow bugs.
 *
 * Kinds never covered, on purpose: `xml/` (manifest and library driven),
 * `navigation/` (referenced from the manifest and NavHost), `font/`,
 * `transition/`, `values*` (KJ-021's territory).
 */

export type UnusedResourceKind = Extract<
  FileResKind,
  'layout' | 'menu' | 'anim' | 'animator' | 'raw' | 'drawable' | 'mipmap'
>;

const SUPPORTED_KINDS: UnusedResourceKind[] = [
  'layout', 'menu', 'anim', 'animator', 'raw', 'drawable', 'mipmap',
];
/** Reported but not deletable unless `includeDrawables` is on. */
const REVIEW_ONLY_KINDS = new Set<UnusedResourceKind>(['drawable', 'mipmap']);

/** Names the manifest or the toolchain reaches without ever naming them in code. */
const MANIFEST_CRITICAL = [
  /^ic_launcher/, /^ic_notification/, /^network_security_config$/, /^file_paths$/,
  /^provider_paths$/, /^backup_rules$/, /^data_extraction_rules$/, /^shortcuts$/,
  /^splash/, /^app_widget/, /^ic_shortcut/,
];

/** Prefixes owned by AndroidX / Material / Play libraries: an overlay we must not touch. */
const LIBRARY_PREFIXES = [
  'abc_', 'mtrl_', 'm3_', 'design_', 'notification_', 'preference_', 'browser_',
  'common_google_', 'googleg_', 'exo_', 'ime_', 'tooltip_', 'select_dialog_',
  'support_', 'expand_activities_', 'material_', 'androidx_',
];

export interface ResourceSource {
  path: string;
  text: string;
}

export interface ScanInput {
  entries: FileResEntry[];
  sources: ResourceSource[];
  /** Module directories that contain at least one .kt/.java file. */
  modulesWithCode: readonly string[];
  /** Module directories declaring com.android.library. */
  libraryModules?: readonly string[];
  /** True when the corpus could not be read in full: forces zero findings. */
  truncated?: boolean;
  includeDrawables?: boolean;
}

export interface UnusedResource {
  kind: UnusedResourceKind;
  name: string;
  /** Every file backing this name: density and configuration variants. */
  paths: string[];
  isLibraryModule: boolean;
  /** False for drawables/mipmaps while `includeDrawables` is off. */
  deletable: boolean;
}

/** `<!-- kotlin-jump:ignore unused-resource -->` anywhere in the file. */
const IGNORE_RE = /kotlin-jump:ignore\s+unused-resource/;

/**
 * `Resources.getIdentifier(name, type, pkg)` builds a resource name at
 * runtime, so anything of that TYPE becomes unprovable.
 *
 * Two traps this had to learn from a real codebase: a no-argument
 * `article.getIdentifier()` is an ordinary business getter and means nothing
 * here, and when the type argument is a literal only THAT kind is affected —
 * disabling every kind because one call looks up a string made the whole
 * feature silent on a 3400-file project.
 */
const GET_IDENTIFIER_RE = /\bgetIdentifier\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
const REFLECTION_RE = /\bR(?:\.\w+)?::class\s*\.\s*java|\bR(?:\.\w+)?\.class\b/;

/** Kinds made unprovable by dynamic lookup; `null` means all of them. */
export function dynamicallyLookedUpKinds(code: string): Set<string> | null {
  if (REFLECTION_RE.test(code)) return null;
  const affected = new Set<string>();
  GET_IDENTIFIER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GET_IDENTIFIER_RE.exec(code)) !== null) {
    const args = m[1].trim();
    if (args === '') continue; // business getter, not Resources.getIdentifier
    const parts = args.split(',');
    if (parts.length < 3) continue; // not the (name, type, package) overload
    const typeLiteral = /^\s*"(\w+)"\s*$/.exec(parts[1]);
    if (!typeLiteral) return null; // type computed: every kind is at risk
    affected.add(typeLiteral[1]);
  }
  return affected;
}

function isCodePath(path: string): boolean {
  return /\.(kt|kts|java)$/.test(path);
}

export function findUnusedResources(input: ScanInput): UnusedResource[] {
  // Guard 8: an incomplete corpus can never prove absence.
  if (input.truncated) return [];

  const codeText: string[] = [];
  const referenced = new Set<string>();
  const literals = new Set<string>();
  const bindings = new Set<string>();
  let manifestHasPlaceholder = false;
  /** Kinds reached by dynamic lookup; `null` once any call is unreadable. */
  let dynamicKinds: Set<string> | null = new Set<string>();

  for (const src of input.sources) {
    if (isCodePath(src.path)) {
      codeText.push(src.text);
      // Guard 1: dynamic lookup, narrowed to the kinds it can actually reach.
      if (dynamicKinds !== null) {
        const kinds = dynamicallyLookedUpKinds(src.text);
        if (kinds === null) dynamicKinds = null;
        else for (const k of kinds) dynamicKinds.add(k);
      }
      for (const r of collectCodeResourceRefs(src.text, SUPPORTED_KINDS)) {
        referenced.add(`${r.kind}/${r.name}`);
      }
      for (const s of collectStringLiterals(src.text)) literals.add(s);
      for (const b of bindingClassTokens(src.text)) bindings.add(b);
      continue;
    }
    if (/\.xml$/.test(src.path)) {
      for (const r of collectXmlResourceRefs(src.text, SUPPORTED_KINDS)) {
        referenced.add(`${r.kind}/${r.name}`);
      }
      for (const s of collectStringLiterals(src.text)) literals.add(s);
      // Guard 3: a manifest placeholder resolves to a name we cannot know.
      if (/AndroidManifest\.xml$/.test(src.path) && /\$\{[^}]+\}/.test(src.text)) {
        manifestHasPlaceholder = true;
      }
      continue;
    }
    // Gradle scripts: resValue, manifestPlaceholders, bare literals
    if (/\.(gradle|gradle\.kts|toml|pro|properties)$/.test(src.path)) {
      for (const r of collectXmlResourceRefs(src.text, SUPPORTED_KINDS)) {
        referenced.add(`${r.kind}/${r.name}`);
      }
      for (const s of collectStringLiterals(src.text)) literals.add(s);
    }
  }

  // A lookup whose type we could not read puts every kind out of reach.
  if (dynamicKinds === null) return [];

  const libraryModules = new Set(input.libraryModules ?? []);
  const withCode = new Set(input.modulesWithCode);
  const includeDrawables = input.includeDrawables ?? false;

  // Guard 5: a name defined in several modules is an overlay; the consumer of
  // one is the consumer of the other.
  const moduleCountByKey = new Map<string, Set<string>>();
  for (const e of input.entries) {
    const key = FileResourceIndex.key(e.kind, e.name);
    const set = moduleCountByKey.get(key) ?? new Set<string>();
    for (const v of e.variants) set.add(v.moduleDir);
    moduleCountByKey.set(key, set);
  }

  const findings: UnusedResource[] = [];

  for (const entry of input.entries) {
    const kind = entry.kind as UnusedResourceKind;
    if (!SUPPORTED_KINDS.includes(kind)) continue;
    if (dynamicKinds.has(kind)) continue;
    if (manifestHasPlaceholder && REVIEW_ONLY_KINDS.has(kind)) continue;
    if (MANIFEST_CRITICAL.some(re => re.test(entry.name))) continue;
    if (LIBRARY_PREFIXES.some(p => entry.name.startsWith(p))) continue;

    const key = FileResourceIndex.key(kind, entry.name);
    if ((moduleCountByKey.get(key)?.size ?? 0) > 1) continue;

    // Guard 4: a module with no code cannot be the consumer of its own files.
    const moduleDir = entry.variants[0]?.moduleDir ?? '';
    if (moduleDir && !withCode.has(moduleDir)) continue;

    if (referenced.has(key)) continue;
    if (literals.has(entry.name)) continue;
    if (bindings.has(bindingStemOf(entry.name))) continue;

    // The escape hatch, and self-references: a file naming itself is not a use.
    const ownPaths = new Set(entry.variants.map(v => v.path));
    const ignored = input.sources.some(s => ownPaths.has(s.path) && IGNORE_RE.test(s.text));
    if (ignored) continue;

    findings.push({
      kind,
      name: entry.name,
      paths: entry.variants.map(v => v.path).sort(),
      isLibraryModule: libraryModules.has(moduleDir),
      deletable: !REVIEW_ONLY_KINDS.has(kind) || includeDrawables,
    });
  }

  return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** Message shown in the Problems panel. */
export function messageFor(finding: UnusedResource, bytes?: number): string {
  const noun = finding.kind[0].toUpperCase() + finding.kind.slice(1);
  const size = bytes !== undefined && bytes > 0 ? ` — ${(bytes / 1024).toFixed(1)} KB` : '';
  if (finding.isLibraryModule) {
    return `${noun} '${finding.name}' is not referenced anywhere in this workspace (library module, an external consumer may use it)`;
  }
  return `${noun} '${finding.name}' is never referenced${size}`;
}

/** Quick fix title; says how many files go when the name has variants. */
export function deleteTitleFor(finding: UnusedResource): string {
  const base = `Delete unused ${finding.kind} ${finding.name}`;
  const files = finding.paths.length > 1 ? ` (${finding.paths.length} files)` : '';
  const caution = finding.isLibraryModule ? ' (library module, check external consumers)' : '';
  return `${base}${files}${caution}`;
}

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedResources';
const DRAWABLES_KEY = 'unusedResourcesIncludeDrawables';

/** Reads the two settings that govern the scan. */
export function readSettings(): { enabled: boolean; includeDrawables: boolean } {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    enabled: cfg.get<boolean>(CONFIG_KEY, true),
    includeDrawables: cfg.get<boolean>(DRAWABLES_KEY, false),
  };
}

export class UnusedResourceProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-resources');
  private readonly byPath = new Map<string, UnusedResource>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) {
          this.collection.delete(uri);
          this.byPath.delete(uri.fsPath);
        }
      }),
    ];
  }

  /** Replaces every finding with a fresh scan result. */
  setFindings(findings: UnusedResource[], sizeOf?: (path: string) => number | undefined): void {
    this.collection.clear();
    this.byPath.clear();
    for (const f of findings) {
      const bytes = sizeOf
        ? f.paths.reduce((sum, p) => sum + (sizeOf(p) ?? 0), 0)
        : undefined;
      const d = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        messageFor(f, bytes),
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-resource';
      for (const p of f.paths) {
        this.byPath.set(p, f);
        this.collection.set(vscode.Uri.file(p), [d]);
      }
    }
    reportDecorations('unusedResources', findings.length);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
    reportDecorations('unusedResources', 0);
  }

  provideCodeActions(document: vscode.TextDocument): vscode.CodeAction[] {
    if (!vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true)) return [];
    const finding = this.byPath.get(document.uri.fsPath);
    if (!finding || !finding.deletable) return [];

    const action = new vscode.CodeAction(deleteTitleFor(finding), vscode.CodeActionKind.QuickFix);
    const edit = new vscode.WorkspaceEdit();
    for (const p of finding.paths) {
      edit.deleteFile(
        vscode.Uri.file(p),
        { ignoreIfNotExists: true },
        { needsConfirmation: true, label: `Delete ${p.split('/').pop()}` },
      );
    }
    action.edit = edit;
    // Deleting a file is never the default lightbulb pick.
    action.isPreferred = false;
    return [action];
  }

  dispose(): void {
    this.collection.dispose();
    for (const s of this.subs) s.dispose();
  }
}
