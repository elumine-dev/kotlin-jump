import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import * as vides from '../../../src/providers/emptySourceFiles';
import { cascadeAfterRemoval } from '../../../src/providers/removalCascade';
import { buildRemovalEdit } from '../../../src/providers/UnusedResourceKeyProvider';
import { collectValueKeyDeclarations } from '../../../src/indexer/ValueResourceScanner';

/**
 * G47 — un fichier de valeurs vide reste en coquille `<resources/>`.
 *
 * Kevin a du commenter « Remove the file » sept fois sur deux PR du projet de
 * reference (`shell_integers.xml`, `adpreflight_integers.xml`,
 * `admin_styles.xml`, `weather_colors.xml`) : la coquille laissee par la
 * suppression de la derniere cle etait identique octet pour octet a celle de
 * la correction a la main. `removalCascade` deleguait a `fileBecomesEmpty`, qui
 * ne connait que Kotlin et Java ; le quick fix ne faisait que des `replace` ;
 * et KJ-060 ne regardait que kt, kts et java, si bien que dix coquilles deja
 * vides sur develop n etaient vues par personne.
 *
 * Regle : un `res/values*\/*.xml` dont `<resources>` n a plus d element part.
 * Le prologue, les commentaires et `xmlns:*` ne comptent pas. Garde : un
 * `tools:keep`, `tools:discard` ou `tools:shrinkMode` le garde.
 */

const STRINGS = '/w/app/src/main/res/values/strings.xml';
const ENTETE = '<?xml version="1.0" encoding="utf-8"?>\n<!--\n  Couleurs de la meteo.\n  <color name="ancienne">#fff</color>\n-->\n';
const coquille = (attrs = '') => `${ENTETE}<resources xmlns:tools="http://schemas.android.com/tools"${attrs}>\n</resources>\n`;
const UNE_CLE = `${ENTETE}<resources>\n    <string name="morte">x</string>\n</resources>\n`;

describe('G47, ce qu est un fichier de valeurs vide', () => {
  const vide = (t: string) => (vides as any).valuesFileDeclaresNothing?.(t);

  it('une coquille avec prologue, commentaire et xmlns est vide', () => {
    expect(vide(coquille())).toBe(true);
    expect(vide('<resources/>')).toBe(true);
    expect(vide('<?xml version="1.0"?>\n<resources />\n')).toBe(true);
  });

  it('une cle restante le garde', () => {
    expect(vide(UNE_CLE)).toBe(false);
  });

  it.each([' tools:keep="@string/x"', ' tools:discard="@string/y"', ' tools:shrinkMode="strict"'])('%s le garde', (attr) => {
    expect(vide(coquille(attr))).toBe(false);
  });
});

describe('G47, les coquilles deja vides sont rapportees par KJ-060', () => {
  it('une coquille de values est un fichier vide', () => {
    const trouves = vides.findEmptySourceFiles({ sources: [{ path: STRINGS, text: coquille() }] }).map(f => f.path);
    expect(trouves).toEqual([STRINGS]);
  });

  it('garde : un layout vide n est pas un fichier de valeurs', () => {
    const layout = { path: '/w/app/src/main/res/layout/a.xml', text: '<?xml version="1.0"?>\n<merge/>\n' };
    expect(vides.findEmptySourceFiles({ sources: [layout] })).toEqual([]);
  });

  it('garde : un fichier de valeurs garde par tools:keep n est pas rapporte', () => {
    expect(vides.findEmptySourceFiles({ sources: [{ path: STRINGS, text: coquille(' tools:keep="@string/x"') }] })).toEqual([]);
  });
});

describe('G47, la derniere cle emporte son fichier', () => {
  const coupe = (t: string) => {
    const s = t.indexOf('    <string');
    return { start: s, end: t.indexOf('\n', s) + 1 };
  };

  it('la cascade de Remove All le compte parmi les fichiers vides', () => {
    const c = cascadeAfterRemoval(new Map([[STRINGS, [coupe(UNE_CLE)]]]), new Map([[STRINGS, UNE_CLE]]));
    expect(c.emptyFiles).toEqual([STRINGS]);
  });

  it('garde : une cle qui reste, le fichier aussi', () => {
    const deux = UNE_CLE.replace('</resources>', '    <string name="vivante">y</string>\n</resources>');
    const c = cascadeAfterRemoval(new Map([[STRINGS, [coupe(deux)]]]), new Map([[STRINGS, deux]]));
    expect(c.emptyFiles).toEqual([]);
  });

  afterEach(() => vi.restoreAllMocks());

  const edition = async (texte: string) => {
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    (vscodeMock.workspace as any).fs = { readFile: async () => Buffer.from(texte, 'utf8') };
    const d = collectValueKeyDeclarations(STRINGS, texte).find((x: any) => x.name === 'morte')!;
    const finding: any = { kind: d.kind, name: 'morte', variants: [{ ...d, path: STRINGS, qualifier: 'values' }] };
    return (await buildRemovalEdit([finding], undefined, false)).edit as any;
  };

  it('le quick fix supprime le fichier au lieu d y laisser une coquille', async () => {
    const e = await edition(UNE_CLE);
    expect(e._fileDeletes.map((d: any) => d.uri.fsPath)).toEqual([STRINGS]);
    expect(e._entries).toEqual([]);
  });

  it('garde : avec une cle vivante, le quick fix remplace et ne supprime rien', async () => {
    const e = await edition(UNE_CLE.replace('</resources>', '    <string name="vivante">y</string>\n</resources>'));
    expect(e._fileDeletes).toEqual([]);
    expect(e._entries.length).toBe(1);
  });
});

// ── Find Everything Unused annonce le fichier que la cle emporte ───────────

import { findEverythingUnusedCommand } from '../../../src/commands/FindEverythingUnused';

describe('G47, le resume de Find compte le fichier vide', () => {
  afterEach(() => vi.restoreAllMocks());
  async function resume(sources: { path: string; text: string }[]) {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    const avant = { info: win.showInformationMessage, warn: win.showWarningMessage, prog: win.withProgress };
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    const messages: string[] = [];
    win.showInformationMessage = async (m: string) => { messages.push(m); return undefined; };
    win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
    const corpus: any = {
      invalidate: () => {},
      get: async () => ({ sources, moduleDirs: ['/w/app'], modulesWithCode: ['/w/app'], libraryModules: [], index: { entries: () => [] }, truncated: false, sourcesTruncated: false }),
    };
    const stub: any = { setFindings: () => {}, setUnreadable: () => {}, setScan: () => {} };
    try {
      await findEverythingUnusedCommand(corpus, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, async () => undefined);
    } finally {
      Object.assign(win, { showInformationMessage: avant.info, showWarningMessage: avant.warn, withProgress: avant.prog });
    }
    return messages.join(' | ');
  }
  const main = { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(1)\n}\n' };
  const gradle = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };

  it('la derniere cle d un fichier : le resume annonce un fichier laisse vide', async () => {
    expect(await resume([gradle, main, { path: STRINGS, text: UNE_CLE }])).toMatch(/1 file\(s\) left empty/);
  });

  it('garde : une cle vivante a cote, aucun fichier annonce', async () => {
    const deux = { path: STRINGS, text: UNE_CLE.replace('</resources>', '    <string name="vivante">y</string>\n</resources>') };
    const lit = { path: main.path, text: 'package p\n\nfun main() {\n    println(R.string.vivante)\n}\n' };
    expect(await resume([gradle, lit, deux])).not.toMatch(/left empty/);
  });
});

describe('G47, garde : un fichier vide sans cle a nous ne part pas', () => {
  afterEach(() => vi.restoreAllMocks());
  it('la cle a deja quitte le fichier : rien a supprimer', async () => {
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    (vscodeMock.workspace as any).fs = { readFile: async () => Buffer.from(coquille(), 'utf8') };
    const d = collectValueKeyDeclarations(STRINGS, UNE_CLE).find((x: any) => x.name === 'morte')!;
    const finding: any = { kind: d.kind, name: 'morte', variants: [{ ...d, path: STRINGS, qualifier: 'values' }] };
    const e = (await buildRemovalEdit([finding], undefined, false)).edit as any;
    expect(e._fileDeletes).toEqual([]);
  });
});
