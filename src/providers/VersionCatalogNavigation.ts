import * as vscode from 'vscode';
import { aliasSegments, parseCatalog, type CatalogAlias } from '../indexer/VersionCatalogIndex';
import { stripKotlinComments } from '../util/xmlRefs';
import { catalogRootOf } from './unusedGradleDependencies';
import { tokenAt } from './versionCatalogSyntax';

/**
 * Navigation inside `gradle/libs.versions.toml` itself. Until now the catalog
 * was a destination and never a departure: Ctrl+click worked from a build file
 * into the catalog, and once there every name was a dead end.
 *
 * Two moves, both on Ctrl+click:
 *   `version.ref = "androidxNavigation"` lands on the `[versions]` line that
 *   declares it, one hop inside the same file.
 *   An alias such as `navigation-safeArgs` lands on the places that use it,
 *   which is what a reader of a catalog actually wants to know before touching
 *   a line. Several usages open the peek list VS Code shows for a multi target
 *   definition, and Shift+F12 gives the same list through the reference
 *   provider below.
 *
 * The token under the cursor is read with the scanner that colours the file,
 * so what is clickable is exactly what is coloured as a reference or an alias.
 * The alias itself comes from the catalog parser that already backs the hover
 * and the unused dependency scan, so the three never disagree about what an
 * accessor resolves to.
 */

const BUILD_FILES = '**/*.{gradle,gradle.kts}';
const EXCLUDE     = '**/{build,.gradle,node_modules}/**';
const MAX_FILES   = 400;

/** `navigation-safeArgs` in `[plugins]` is reached as `libs.plugins.navigation.safeArgs`. */
export function accessorOf(alias: CatalogAlias, root: string): string {
  const prefixe = alias.namespace === 'libraries' ? [] : [alias.namespace];
  return [root, ...prefixe, ...alias.segments].join('.');
}

/** The alias declared on a line, or undefined when the line declares none. */
export function aliasOnLine(texte: string, line: number): CatalogAlias | undefined {
  return parseCatalog(texte).aliases.find(a => a.line === line);
}

/** A lookup by name, `libs.findLibrary("foo-bar")`. */
const RE_LOOKUP = /\bfind(?:Library|Plugin|Version|Bundle)\s*\(\s*"([^"]+)"/g;

/**
 * Every place a build file reaches this alias.
 *
 * Segments are compared one by one rather than by spelling: Gradle treats
 * `-`, `_` and `.` as the same separator, so `navigation-safeArgs` and
 * `navigation.safeArgs` are one alias, and an accessor with an extra segment
 * is a different one.
 *
 * Comments are blanked out with the very function the unused dependency scan
 * uses, and a lookup by name counts the way that scan counts it, kind ignored.
 * The two features answer the same question and used to disagree four ways out
 * of five: a commented out accessor was a usage here and a dead alias there,
 * and a `findLibrary("foo-bar")` was the reverse. Blanking keeps every offset,
 * so the positions below stay exact.
 */
export function findAccessorUsages(
  texte: string,
  alias: CatalogAlias,
  root: string,
): Array<{ line: number; start: number; length: number }> {
  const code = stripKotlinComments(texte);
  const echappe = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${echappe}((?:\\.[A-Za-z0-9_]+)+)`, 'g');
  const debuts = lineStarts(code);
  const trouves: Array<{ line: number; start: number; length: number }> = [];

  RE_LOOKUP.lastIndex = 0;
  let l: RegExpExecArray | null;
  while ((l = RE_LOOKUP.exec(code)) !== null) {
    const segments = aliasSegments(l[1]);
    if (segments.length !== alias.segments.length) continue;
    if (segments.some((s, i) => s !== alias.segments[i])) continue;
    const debut = l.index + l[0].length - 1 - l[1].length;
    const { line, character } = positionOf(debuts, debut);
    trouves.push({ line, start: character, length: l[1].length });
  }

  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const segments = m[1].split('.').filter(Boolean);
    const tete = segments[0];
    const namespace = tete === 'versions' || tete === 'plugins' || tete === 'bundles' ? tete : 'libraries';
    const utiles = namespace === 'libraries' ? segments : segments.slice(1);
    if (namespace !== alias.namespace) continue;
    if (utiles.length !== alias.segments.length) continue;
    if (utiles.some((s, i) => s !== alias.segments[i])) continue;
    const { line, character } = positionOf(debuts, m.index);
    trouves.push({ line, start: character, length: m[0].length });
  }
  trouves.sort((a, b) => a.line - b.line || a.start - b.start);
  return trouves;
}

function lineStarts(texte: string): number[] {
  const out = [0];
  for (let i = 0; i < texte.length; i++) if (texte.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

function positionOf(debuts: number[], offset: number): { line: number; character: number } {
  let bas = 0, haut = debuts.length - 1;
  while (bas < haut) {
    const mid = (bas + haut + 1) >> 1;
    if (debuts[mid] <= offset) bas = mid; else haut = mid - 1;
  }
  return { line: bas, character: offset - debuts[bas] };
}

const RE_SETTINGS = /(?:^|[\\/])settings\.gradle(?:\.kts)?$/;

/**
 * The accessor root is NOT always `libs`. Gradle takes it from the catalog's
 * file name, so `deps.versions.toml` is reached as `deps.x`, and
 * `versionCatalogs { create("acme") { … } }` in settings renames it again.
 * VersionCatalogIndex.rootFor answers `libs` in every case, because
 * reindexFile calls parseCatalog without a root, so an alias of a renamed
 * catalog opened onto nothing. The unused dependency scan already resolves
 * this properly; catalogRootOf is its implementation, reused here rather than
 * written a second time. It returns undefined for a catalog declared in Kotlin
 * instead of TOML, whose aliases cannot be known: staying silent then is the
 * same choice that scan makes.
 *
 * The settings files come out of the same sweep as the build files, so this
 * costs no extra read.
 */
async function usagesInWorkspace(alias: CatalogAlias, cheminCatalogue: string): Promise<vscode.Location[]> {
  const uris = await vscode.workspace.findFiles(BUILD_FILES, EXCLUDE, MAX_FILES);
  const lus = await Promise.all(uris.map(async uri => {
    try {
      return { uri, texte: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) };
    } catch { return undefined; }
  }));
  const presents = lus.filter((x): x is { uri: vscode.Uri; texte: string } => x !== undefined);
  const settings = presents.filter(x => RE_SETTINGS.test(x.uri.fsPath)).map(x => x.texte);

  const root = catalogRootOf(cheminCatalogue, settings);
  if (root === undefined) return [];

  const out: vscode.Location[] = [];
  for (const { uri, texte } of presents) {
    for (const h of findAccessorUsages(texte, alias, root)) {
      out.push(new vscode.Location(uri, new vscode.Range(h.line, h.start, h.line, h.start + h.length)));
    }
  }
  out.sort((a, b) => a.uri.toString().localeCompare(b.uri.toString()) || a.range.start.line - b.range.start.line);
  return out;
}

/** Where a `[versions]` key is declared, and where the catalog points at it. */
function versionKeySites(texte: string, cle: string): { declaration?: vscode.Range; refs: vscode.Range[] } {
  const catalogue = parseCatalog(texte);
  const decl = catalogue.aliases.find(a => a.namespace === 'versions' && a.raw === cle);
  const refs: vscode.Range[] = [];
  const lignes = texte.split('\n');
  for (const a of catalogue.aliases) {
    if (a.versionRef !== cle) continue;
    const ligne = lignes[a.line]?.replace(/\r$/, '') ?? '';
    const i = ligne.indexOf(`"${cle}"`);
    if (i !== -1) refs.push(new vscode.Range(a.line, i + 1, a.line, i + 1 + cle.length));
  }
  return {
    declaration: decl ? new vscode.Range(decl.line, decl.character, decl.line, decl.character + decl.raw.length) : undefined,
    refs,
  };
}

/**
 * A key of the versions table is reached two ways, and both count: the entries
 * of the catalog that pin their version on it, and the build files that read
 * it as `libs.versions.<key>` or through `findVersion`. v1.42.106 lined the
 * navigation up with the unused dependency scan for libraries, plugins and
 * bundles and left this one namespace behind, so a version used only from a
 * build file opened onto nothing while the scan considered it alive.
 */
async function versionSites(
  document: vscode.TextDocument,
  cle: string,
  avecDeclaration: boolean,
): Promise<vscode.Location[]> {
  const texte = document.getText();
  const { declaration, refs } = versionKeySites(texte, cle);
  const out: vscode.Location[] = [];
  if (avecDeclaration && declaration) out.push(new vscode.Location(document.uri, declaration));
  out.push(...refs.map(r => new vscode.Location(document.uri, r)));

  const alias = parseCatalog(texte).aliases.find(a => a.namespace === 'versions' && a.raw === cle);
  if (alias) out.push(...await usagesInWorkspace(alias, document.uri.fsPath));
  return out;
}

export class CatalogTomlDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const texte = document.getText();
    const hit = tokenAt(texte, position.line, position.character);
    if (!hit) return undefined;

    if (hit.type === 'enumMember') {
      const { declaration } = versionKeySites(texte, hit.texte);
      return declaration ? [new vscode.Location(document.uri, declaration)] : undefined;
    }

    if (hit.type === 'property') {
      const alias = aliasOnLine(texte, hit.line);
      if (!alias) return undefined;
      // A `[versions]` key has no accessor of its own worth jumping to: what a
      // reader wants is the entries that pin their version on it.
      if (alias.namespace === 'versions') {
        return versionSites(document, alias.raw, false);
      }
      return usagesInWorkspace(alias, document.uri.fsPath);
    }
    return undefined;
  }
}

export class CatalogTomlReferenceProvider implements vscode.ReferenceProvider {
  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Location[] | undefined> {
    const texte = document.getText();
    const hit = tokenAt(texte, position.line, position.character);
    if (!hit) return undefined;

    // On a reference, the question is the same as on the key it points at.
    const cle = hit.type === 'enumMember' ? hit.texte
      : hit.type === 'property' ? aliasOnLine(texte, hit.line)?.raw
        : undefined;
    if (cle === undefined) return undefined;

    const alias = hit.type === 'property' ? aliasOnLine(texte, hit.line) : undefined;
    if (alias && alias.namespace !== 'versions') {
      return usagesInWorkspace(alias, document.uri.fsPath);
    }
    return versionSites(document, cle, true);
  }
}
