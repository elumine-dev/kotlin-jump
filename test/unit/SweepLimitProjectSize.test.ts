/**
 * Le plafond des balayages de projet, mesure contre un vrai projet.
 *
 * Trois fonctionnalites repondent a une ABSENCE en parcourant tout le projet :
 * le badge d'usage des dependances Gradle, les badges de necessite du
 * manifeste, et les correctifs rapides « Remove unused … » qui s'appuient sur
 * les deux. Chacune avait son propre plafond a 4000 fichiers, et chacune une
 * garde qui coupe tout quand le plafond est atteint.
 *
 * Or /Users/kevin/Desktop/work/lapresse compte 5088 sources Kotlin et Java,
 * 6278 en comptant les XML de ressources. Les trois gardes etaient donc
 * declenchees en PERMANENCE :
 *   - les 56 permissions des 51 manifestes affichaient toutes la meme etiquette
 *     « may come from a library ». Avec un listing complet, 15 deviennent
 *     « used in N files » et 1 « no usage found », donc 16 portent enfin une
 *     information.
 *   - aucun correctif « Remove unused … » n'etait jamais propose.
 *
 * La v1.42.177 a corrige le plafond du seul badge de dependance, ce qui a cree
 * un desaccord visible : le badge annonce « 0 imports » et grise la ligne,
 * pendant que le correctif rapide cense la supprimer reste muet. Les trois
 * partagent desormais la meme constante.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { MAX_SWEEP_FILES } from '../../src/util/sweepLimit';
import { ManifestNecessityProvider } from '../../src/providers/ManifestNecessityProvider';
import { DeadWeightActionProvider } from '../../src/providers/DeadWeightActionProvider';
import { Range, Position } from './__mocks__/vscode';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => vi.restoreAllMocks());

describe('MAX_SWEEP_FILES — au dessus d un vrai projet', () => {
  it('depasse les 6278 fichiers de lapresse', () => {
    expect(MAX_SWEEP_FILES).toBeGreaterThan(6278);
  });
});

const MANIFESTE = [
  '<manifest package="com.exemple">',
  '    <uses-permission android:name="android.permission.VIBRATE" />',
  '</manifest>',
].join(NL);

function sourcesFactices(n: number, texte: string) {
  const uris = Array.from({ length: n }, (_, i) => ({
    toString: () => `file:///w/src/F${i}.kt`,
    fsPath: `/w/src/F${i}.kt`,
  }));
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => uris) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => encode(texte)) as any);
  return uris;
}

async function badgesManifeste(nbSources: number) {
  sourcesFactices(nbSources, 'import android.os.Vibrator' + NL + 'class A { val v: Vibrator? = null }');
  const editor = {
    document: {
      uri: { fsPath: '/w/app/src/main/AndroidManifest.xml', toString: () => 'file:///w/app/src/main/AndroidManifest.xml' },
      getText: () => MANIFESTE,
    },
    setDecorations: vi.fn(),
  } as any;
  (vscodeMock.window as any).activeTextEditor = editor;
  const p = new ManifestNecessityProvider();
  await attendre();
  p.dispose();
  (vscodeMock.window as any).activeTextEditor = undefined;
  const calls = editor.setDecorations.mock.calls;
  return (calls[calls.length - 2]?.[1] ?? []).map((b: any) => b.renderOptions.after.contentText);
}

describe('ManifestNecessityProvider — le listing sous le plafond', () => {
  it('rend un vrai verdict sur la permission', async () => {
    // Les 10 fichiers factices ont des noms distincts, donc les 10 comptent.
    expect(await badgesManifeste(10)).toEqual(['used in 10 files']);
  });

  it('et retombe sur l etiquette prudente quand le plafond est atteint', async () => {
    expect(await badgesManifeste(MAX_SWEEP_FILES)).toEqual(['may come from a library']);
  });

  it('demande bien le plafond partage a findFiles', async () => {
    await badgesManifeste(10);
    const appel = (vscodeMock.workspace.findFiles as any).mock.calls
      .find((c: any[]) => String(c[0]).includes('kt,java'));
    expect(appel?.[2]).toBe(MAX_SWEEP_FILES);
  });
});

const GRADLE = [
  'dependencies {',
  '    implementation("com.squareup.retrofit2:retrofit:2.9.0")',
  '}',
].join(NL);

async function actionsGradle(nbSources: number) {
  sourcesFactices(nbSources, 'import kotlin.math.max' + NL + 'class A');
  const lignes = GRADLE.split(NL);
  const document = {
    uri: { fsPath: '/w/app/build.gradle.kts', toString: () => 'file:///w/app/build.gradle.kts' },
    lineCount: lignes.length,
    lineAt: (i: number) => ({ text: lignes[i] }),
    getText: () => GRADLE,
  } as any;
  const provider = new DeadWeightActionProvider();
  await attendre();
  const actions = await provider.provideCodeActions(
    document,
    new Range(new Position(1, 4), new Position(1, 4)) as any,
  );
  return actions.map(a => a.title);
}

describe('DeadWeightActionProvider — le correctif suit le badge', () => {
  it('propose la suppression quand le listing est complet', async () => {
    expect(await actionsGradle(10)).toEqual(['Remove unused dependency com.squareup.retrofit2:retrofit']);
  });

  it('se tait quand le listing a touche le plafond', async () => {
    // Une absence ne se prouve pas sur un listing tronque : supprimer ici
    // enleverait une dependance utilisee par un fichier jamais lu.
    expect(await actionsGradle(MAX_SWEEP_FILES)).toEqual([]);
  });

  it('demande bien le plafond partage a findFiles', async () => {
    await actionsGradle(10);
    const appel = (vscodeMock.workspace.findFiles as any).mock.calls
      .find((c: any[]) => String(c[0]).includes('kt,java,xml'));
    expect(appel?.[2]).toBe(MAX_SWEEP_FILES);
  });
});
