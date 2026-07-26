import * as vscode from 'vscode';

/**
 * KJ-018: Reverse String Map, "where does this string show up?".
 * Hover on <string name="x"> (XML) and on R.string.x (Kotlin): lists the
 * composable screens that display it, and the non-UI classes that use it.
 */

export interface DisplaySite {
  enclosing: string;
  isComposable: boolean;
}

export interface SourceFile {
  path: string;
  text: string;
}

interface Span {
  name: string;
  start: number;
  end: number;
  isComposable: boolean;
}

function matchBalancedBrace(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractSpans(text: string, kind: 'fun' | 'class'): Span[] {
  const spans: Span[] = [];
  // String-aware annotation args: @Preview(name = ":)") does not cut the
  // annotation block (nested parens remain a known limitation).
  const re =
    kind === 'fun'
      ? /((?:@\w+(?:\((?:[^()"']|"[^"]*"|'[^']*')*\))?\s+)*)fun\s+(\w+)\s*\(/g
      : /\b(?:class|object)\s+(\w+)[^{\n]*\{/g; // named object = enclosing class; companion (unnamed) excluded
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let open: number;
    let name: string;
    let isComposable = false;
    if (kind === 'fun') {
      name = m[2];
      isComposable = /@Composable\b/.test(m[1]);
      open = text.indexOf('{', m.index + m[0].length);
      if (open < 0) continue;
      // expression body (no brace before the next fun): skip
      const nextFun = text.indexOf('fun ', m.index + m[0].length);
      if (nextFun >= 0 && nextFun < open) continue;
    } else {
      name = m[1];
      open = m.index + m[0].length - 1;
    }
    const end = matchBalancedBrace(text, open);
    if (end < 0) continue;
    spans.push({ name, start: m.index, end, isComposable });
  }
  return spans;
}

export function findDisplaySites(resName: string, files: SourceFile[]): DisplaySite[] {
  const sites: DisplaySite[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const usageRe = new RegExp(`\\bR\\.string\\.${resName}\\b`, 'g');
    const funs = extractSpans(file.text, 'fun');
    const classes = extractSpans(file.text, 'class');

    let m: RegExpExecArray | null;
    while ((m = usageRe.exec(file.text)) !== null) {
      const idx = m.index;
      // All enclosing funs, innermost to outermost: a LOCAL fun inside a
      // composable must not hide the screen.
      const enclosingFuns = funs
        .filter(f => f.start < idx && idx < f.end)
        .sort((a, b) => b.start - a.start);
      const composableFun = enclosingFuns.find(f => f.isComposable);

      let site: DisplaySite | undefined;
      if (composableFun) {
        site = { enclosing: composableFun.name, isComposable: true };
      } else {
        const enclosingClass = classes
          .filter(c => c.start < idx && idx < c.end)
          .sort((a, b) => b.start - a.start)[0];
        if (enclosingClass) {
          site = { enclosing: enclosingClass.name, isComposable: false };
        } else if (enclosingFuns[0]) {
          site = { enclosing: enclosingFuns[0].name, isComposable: false };
        }
      }
      if (!site) continue;
      const key = `${site.enclosing}#${site.isComposable}`;
      if (!seen.has(key)) {
        seen.add(key);
        sites.push(site);
      }
    }
  }
  return sites;
}

const CACHE_MS = 20_000;

export class StringXmlHoverProvider implements vscode.HoverProvider {
  private _cache: { at: number; files: SourceFile[] } | undefined;

  private async _sources(): Promise<SourceFile[]> {
    if (this._cache && Date.now() - this._cache.at < CACHE_MS) return this._cache.files;
    const uris = await vscode.workspace.findFiles(
      '**/*.{kt,java}', '**/{build,.gradle}/**', 4000,
    );
    const files: SourceFile[] = [];
    for (const uri of uris) {
      try {
        files.push({
          path: uri.fsPath,
          text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        });
      } catch {
        continue;
      }
    }
    this._cache = { at: Date.now(), files };
    return files;
  }

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('reverseStringMap', true)) return undefined;

    const line = document.lineAt(position.line).text;
    let resName: string | undefined;

    if (document.languageId === 'xml') {
      const m = /<string\s+name="(\w+)"/.exec(line);
      if (m && position.character >= line.indexOf(m[1])) resName = m[1];
    } else {
      const re = /\bR\.string\.(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (position.character >= m.index && position.character <= m.index + m[0].length) {
          resName = m[1];
          break;
        }
      }
    }
    if (!resName) return undefined;

    const sites = findDisplaySites(resName, await this._sources());
    if (sites.length === 0) return undefined;

    const screens = sites.filter(s => s.isComposable);
    const others = sites.filter(s => !s.isComposable);
    const md = new vscode.MarkdownString();
    if (screens.length > 0) {
      const list = screens.slice(0, 5).map(s => `\`${s.enclosing}\``).join(', ');
      const extra = screens.length > 5 ? ` +${screens.length - 5}` : '';
      md.appendMarkdown(`**Shown on:** ${list}${extra}\n\n`);
    }
    if (others.length > 0) {
      md.appendMarkdown(
        `Also used in: ${others.slice(0, 5).map(s => `\`${s.enclosing}\``).join(', ')}\n`,
      );
    }
    return new vscode.Hover(md);
  }
}
