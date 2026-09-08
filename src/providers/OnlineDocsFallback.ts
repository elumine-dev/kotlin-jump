import * as vscode from 'vscode';
import { resolveExplicit } from '../util/ImportResolver';

// `kotlinJump.fallbackToOnlineDocs`: when Go to Definition finds no local
// source for a symbol, jump to its online reference page instead of the
// "No definition found" toast.
//
// Shape: the definition provider returns a Location on a virtual
// `kotlin-jump-docs:` document. The browser opens when that document becomes
// the active editor (Cmd+Click, F12); Peek and the Cmd+hover preview render
// its text without opening anything. Returning the Location alone has no
// side effect, which matters because VS Code also calls provideDefinition on
// Cmd+hover to decide whether to underline the word.

export const ONLINE_DOCS_SCHEME = 'kotlin-jump-docs';

const DOCS_AUTHORITY = 'docs';

// Dokka page slugs: `HashMap` → `-hash-map`, `listOf` → `list-of`.
function dokkaSlug(name: string): string {
  return name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

function isTypeName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

// JDK modules for the javadoc URL. Anything not listed lives in java.base,
// which covers java.lang / util / io / nio / time / net / text / math.
const JDK_MODULES: ReadonlyArray<[prefix: string, module: string]> = [
  ['java.net.http',      'java.net.http'],
  ['java.sql',           'java.sql'],
  ['javax.sql',          'java.sql'],
  ['java.awt',           'java.desktop'],
  ['javax.swing',        'java.desktop'],
  ['javax.imageio',      'java.desktop'],
  ['javax.sound',        'java.desktop'],
  ['java.util.logging',  'java.logging'],
  ['java.lang.management', 'java.management'],
  ['javax.management',   'java.management'],
  ['javax.xml',          'java.xml'],
  ['org.w3c.dom',        'java.xml'],
  ['org.xml.sax',        'java.xml'],
  ['javax.crypto',       'java.base'],
  ['javax.net',          'java.base'],
  ['javax.security',     'java.base'],
  ['java.util.prefs',    'java.prefs'],
  ['java.rmi',           'java.rmi'],
  ['javax.script',       'java.scripting'],
  ['java.beans',         'java.desktop'],
  ['java.util.concurrent', 'java.base'],
];

const KOTLINLANG_LIBRARIES: ReadonlyArray<[prefix: string, path: string]> = [
  ['kotlinx.coroutines',    'kotlinx.coroutines/kotlinx-coroutines-core'],
  ['kotlinx.serialization', 'kotlinx.serialization/kotlinx-serialization-core'],
  ['kotlinx.datetime',      'kotlinx-datetime/kotlinx-datetime'],
  ['kotlinx.io',            'kotlinx-io/kotlinx-io-core'],
  ['kotlin',                'core/kotlin-stdlib'],
];

/**
 * Best-effort reference URL for a fully qualified name, or undefined when the
 * package has no known documentation host.
 */
export function onlineDocsUrl(fqn: string): string | undefined {
  const dot = fqn.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const pkg  = fqn.slice(0, dot);
  const name = fqn.slice(dot + 1);
  if (!name) return undefined;

  for (const [prefix, libPath] of KOTLINLANG_LIBRARIES) {
    if (pkg === prefix || pkg.startsWith(`${prefix}.`)) {
      return `https://kotlinlang.org/api/${libPath}/${pkg}/${dokkaSlug(name)}/`;
    }
  }

  if (pkg.startsWith('java.') || pkg.startsWith('javax.') || pkg.startsWith('org.w3c.') || pkg.startsWith('org.xml.')) {
    // `import java.util.Collections.emptyList` (static import): the page is the
    // enclosing class, the member is the anchor.
    const segments = pkg.split('.');
    const last = segments[segments.length - 1];
    const [classPkg, className, anchor] = !isTypeName(name) && isTypeName(last)
      ? [segments.slice(0, -1).join('.'), last, `#${name}`]
      : [pkg, name, ''];
    if (!isTypeName(className)) return undefined;
    const mod = JDK_MODULES.find(([prefix]) => classPkg === prefix || classPkg.startsWith(`${prefix}.`))?.[1] ?? 'java.base';
    return `https://docs.oracle.com/en/java/javase/21/docs/api/${mod}/${classPkg.replace(/\./g, '/')}/${className}.html${anchor}`;
  }

  if (pkg.startsWith('android.') || pkg.startsWith('androidx.') || pkg.startsWith('com.google.android.material')) {
    const pkgPath = pkg.replace(/\./g, '/');
    return isTypeName(name)
      ? `https://developer.android.com/reference/kotlin/${pkgPath}/${name}`
      : `https://developer.android.com/reference/kotlin/${pkgPath}/package-summary#${name}`;
  }

  return undefined;
}

export function isOnlineDocsEnabled(): boolean {
  return vscode.workspace.getConfiguration('kotlinJump').get<boolean>('fallbackToOnlineDocs', false);
}

/**
 * Location on the virtual docs document for `word`, or null when the setting
 * is off or no import pins the symbol down. An exact import is the truth, so
 * it is used even when its package has no docs host (then: no fallback). A
 * wildcard import is only trusted when it is the file's sole wildcard; with
 * two, `import okhttp3.*` + `import kotlinx.coroutines.*` would send every
 * unresolved OkHttp name to a 404 on kotlinlang.org.
 */
export function onlineDocsLocation(word: string, document: vscode.TextDocument): vscode.Location | null {
  if (!isOnlineDocsEnabled()) return null;
  const { exact, wildcards } = resolveExplicit(word, document);
  const candidates = exact.length > 0 ? exact : wildcards.length === 1 ? wildcards : [];
  for (const fqn of candidates) {
    const url = onlineDocsUrl(fqn);
    if (url) return new vscode.Location(docsUri(fqn, url), new vscode.Position(0, 0));
  }
  return null;
}

export function docsUri(fqn: string, url: string): vscode.Uri {
  // The path's last segment is the editor tab title, so it carries the FQN.
  return vscode.Uri.parse(`${ONLINE_DOCS_SCHEME}://${DOCS_AUTHORITY}/${fqn}?url=${encodeURIComponent(url)}`);
}

export function parseDocsUri(uri: { path: string; query: string }): { fqn: string; url: string } | undefined {
  const fqn = uri.path.replace(/^\//, '');
  const m = /(?:^|&)url=([^&]*)/.exec(uri.query ?? '');
  if (!fqn || !m) return undefined;
  try {
    const url = decodeURIComponent(m[1]);
    if (!/^https:\/\//.test(url)) return undefined;
    return { fqn, url };
  } catch {
    return undefined;
  }
}

export class OnlineDocsContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly sub: vscode.Disposable;

  constructor(private readonly openExternal: (url: string) => Thenable<boolean> = url => vscode.env.openExternal(vscode.Uri.parse(url))) {
    // VS Code also resolves the target document to render the Cmd+hover
    // definition preview, so opening the browser from
    // provideTextDocumentContent would pop a tab on every hover. The page
    // becoming the active editor is the actual navigation.
    this.sub = vscode.window.onDidChangeActiveTextEditor(editor => this.onActiveEditor(editor));
  }

  onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.uri.scheme !== ONLINE_DOCS_SCHEME) return;
    const parsed = parseDocsUri(editor.document.uri);
    if (parsed) void this.openExternal(parsed.url);
  }

  dispose(): void { this.sub.dispose(); }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const parsed = parseDocsUri(uri);
    if (!parsed) return 'Kotlin Jump: malformed online docs link.';
    return [
      parsed.fqn,
      '',
      'No local source for this symbol: it is not in the workspace, the bundled Kotlin stdlib,',
      'or any indexed sources JAR (see "Kotlin Jump: Download missing sources").',
      '',
      `Online reference (opens in your browser when this tab is shown): ${parsed.url}`,
      '',
      'This page shows because kotlinJump.fallbackToOnlineDocs is on.',
    ].join('\n');
  }
}
