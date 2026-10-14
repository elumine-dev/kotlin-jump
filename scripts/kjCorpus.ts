/**
 * The corpus `ResourceCorpus` hands the removal commands, rebuilt from disk.
 *
 * Shared by `apply-kj-removals.ts` and `oracle-units.ts`: an oracle that read
 * a different corpus than the command would measure something no button does.
 */
import * as fs from 'fs';
import * as path from 'path';
import { FileResourceIndex } from '../src/indexer/FileResourceIndex';

/** What the detectors read as text. */
const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$|[\\/]nitro\.json$/;
/** Wider: the file-resource index must see binaries to know a name is backed. */
const RES_RE = /\.(xml|png|webp|svg|jpg|jpeg|gif|bmp|json|txt|mp3|mp4|ogg|wav|ttf|otf|lottie)$/i;
const ASSET_TEXTE_RE = /\.(json|css|js|xml|txt|properties|html|htm|svg|md|csv)$/i;
const EXCLUDED_DIRS = new Set(['build', '.gradle', 'generated', '.idea', '.git', 'node_modules', '.worktrees', '.kotlin']);

const LIBRARY_PLUGIN_RE = /com\.android\.library|android-library|android\.library\b|androidLibrary/;
const withoutUnappliedPlugins = (t: string) => t.split('\n').filter(l => !/\bapply\s+false\b/.test(l)).join('\n');
const declaresLibraryPlugin = (t: string) => LIBRARY_PLUGIN_RE.test(withoutUnappliedPlugins(t));

export interface Corpus {
  sources: { path: string; text: string }[];
  /** KJ-081 : `src/main/assets/`, hors de `sources` et de la recolte generale. */
  assets: { path: string; text: string }[];
  modulesWithCode: string[];
  libraryModules: string[];
  /** Every module directory: KJ-055 needs them to know the legal source sets. */
  moduleDirs: string[];
  resourceEntries: ReturnType<FileResourceIndex['entries']>;
}

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!EXCLUDED_DIRS.has(entry.name)) walk(full, hit); }
    else hit(full);
  }
}

/** The same corpus `ResourceCorpus` hands the command, rebuilt from disk. */
export function readCorpus(root: string): Corpus {
  const sources: { path: string; text: string }[] = [];
  const assets: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  const index = new FileResourceIndex();
  const resFiles: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    if (RES_RE.test(file)) resFiles.push(file);
    // KJ-081 : les assets de `src/main/assets/` vont dans leur PROPRE liste,
    // jamais dans `sources`. Leur texte ne sert qu'a decider de la vie d'un
    // autre asset ; verse dans la recolte generale, il garderait en vie toute
    // declaration dont le nom y figure par hasard. Un binaire entre par son
    // chemin seul : il ne cite personne, et les 55 Mo d'assets du projet de
    // reference n'ont rien a faire en memoire.
    if (/[\\/]src[\\/]main[\\/]assets[\\/]/.test(file)) {
      if (!ASSET_TEXTE_RE.test(file)) assets.push({ path: file, text: '' });
      else { try { assets.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { assets.push({ path: file, text: '' }); } }
    } else if (SOURCE_RE.test(file) || /[\\/]META-INF[\\/]services[\\/]/.test(file)) {
      try { sources.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
    }
  });
  // The index is built from the file names, so it needs the binaries too: a
  // `drawable/x.webp` backs the name `x` exactly as a `drawable/x.xml` does.
  for (const file of resFiles) index.addFile(file, moduleDirs);
  return {
    sources,
    assets,
    moduleDirs,
    modulesWithCode: moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/`) && /\.(kt|java)$/.test(s.path))),
    libraryModules: moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && declaresLibraryPlugin(s.text))),
    resourceEntries: index.entries(),
  };
}

