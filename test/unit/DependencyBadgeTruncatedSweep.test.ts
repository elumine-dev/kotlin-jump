/**
 * KJ-022 — un balayage tronque ne peut pas produire un compte.
 *
 * Le fournisseur lisait les imports de l'espace de travail avec un plafond de
 * 4000 fichiers. Mesure sur /Users/kevin/Desktop/work/lapresse : 5088 sources
 * hors `build/`, donc 1088 fichiers n'etaient jamais lus, et le badge affichait
 * quand meme un chiffre.
 *
 * Consequences mesurees par les fonctions de production, catalogue reel
 * (160 entrees, 29 coordonnees avec un chiffre affiche) :
 *   - 1 a 3 artefacts tombaient a « 0 imports » ET etaient GRISES comme morts,
 *     selon l'ordre de parcours. `org.junit.jupiter:junit-jupiter-api` en fait
 *     partie, avec 33 imports reels.
 *   - 22 autres etaient sous-comptes : un chiffre faux, sans aucun signe.
 *
 * Le plafond passe a 20000 et, s'il est atteint, le fournisseur rend
 * « ? imports » au lieu d'un chiffre invente.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import {
  classifyDependency,
  MAX_SWEEP_FILES,
  DependencyUsageBadgeProvider,
} from '../../src/providers/DependencyUsageBadgeProvider';

const NL = String.fromCharCode(10);
const RETROFIT = 'com.squareup.retrofit2:retrofit';

afterEach(() => vi.restoreAllMocks());

describe('classifyDependency — le drapeau de completude', () => {
  it('balayage complet : le chiffre est rendu', () => {
    expect(classifyDependency(RETROFIT, ['import retrofit2.Retrofit'], true))
      .toEqual({ kind: 'counted', imports: 1 });
  });

  it('balayage tronque : inconnu plutot qu un chiffre', () => {
    expect(classifyDependency(RETROFIT, ['import retrofit2.Retrofit'], false))
      .toEqual({ kind: 'unknown' });
  });

  it('balayage tronque : surtout pas un zero, c est lui qui grise la ligne', () => {
    expect(classifyDependency(RETROFIT, [], false)).toEqual({ kind: 'unknown' });
  });

  it('par defaut le balayage est repute complet', () => {
    expect(classifyDependency(RETROFIT, ['import retrofit2.Retrofit']))
      .toEqual({ kind: 'counted', imports: 1 });
  });

  it('un BOM et un processeur ne dependent pas du balayage', () => {
    expect(classifyDependency('androidx.compose:compose-bom', [], false)).toEqual({ kind: 'bom' });
    expect(classifyDependency('com.google.dagger:hilt-compiler', [], false)).toEqual({ kind: 'buildTime' });
  });
});

const TOML = 'retrofit-core = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "r" }' + NL;
const GRADLE = ['dependencies {', '    implementation(libs.retrofit.core)', '}'].join(NL);

const encode = (s: string) => new TextEncoder().encode(s);

/** Monte le fournisseur sur un build.gradle.kts et rend les deux jeux de decorations. */
async function decorations(nbSources: number, avecImport: boolean) {
  const sources = Array.from({ length: nbSources }, (_, i) => ({
    toString: () => `file:///w/src/F${i}.kt`,
    fsPath: `/w/src/F${i}.kt`,
  }));
  const toml = { toString: () => 'file:///w/gradle/libs.versions.toml', fsPath: '/w/gradle/libs.versions.toml' };

  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async (pattern: any) => (
    String(pattern).includes('libs.versions.toml') ? [toml] : sources
  )) as any);
  const contenu = encode(avecImport ? 'import retrofit2.Retrofit' : 'import kotlin.math.max');
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async (uri: any) => (
    String(uri).endsWith('.toml') ? encode(TOML) : contenu
  )) as any);

  const editor = {
    document: {
      uri: { fsPath: '/w/app/build.gradle.kts', toString: () => 'file:///w/app/build.gradle.kts' },
      getText: () => GRADLE,
    },
    setDecorations: vi.fn(),
  } as any;
  (vscodeMock.window as any).activeTextEditor = editor;

  const provider = new DependencyUsageBadgeProvider();
  for (let i = 0; i < 6; i++) await new Promise<void>(r => setTimeout(r, 0));
  provider.dispose();
  (vscodeMock.window as any).activeTextEditor = undefined;

  const calls = editor.setDecorations.mock.calls;
  return { badges: calls[calls.length - 2]?.[1] ?? [], dead: calls[calls.length - 1]?.[1] ?? [] };
}

describe('DependencyUsageBadgeProvider — le badge quand le balayage deborde', () => {
  it('le plafond depasse la taille d un vrai projet', () => {
    // lapresse : 5088 sources hors build/. L ancien plafond, 4000, passait
    // dessous sans rien dire.
    expect(MAX_SWEEP_FILES).toBeGreaterThan(5088);
  });

  it('balayage complet : le chiffre reel', async () => {
    const { badges, dead } = await decorations(3, true);
    expect(
      (vscodeMock.workspace.findFiles as any).mock.calls.find((c: any[]) => String(c[0]).includes('kt,java')),
      'le plafond demande a findFiles est bien celui de la constante',
    ).toEqual(['**/*.{kt,java}', expect.anything(), MAX_SWEEP_FILES]);
    expect(badges).toHaveLength(1);
    expect(badges[0].renderOptions.after.contentText).toBe('3 imports');
    expect(dead, 'rien de grise, la dependance sert').toHaveLength(0);
  });

  it('balayage complet et zero import : chiffre ET ligne grisee', async () => {
    const { badges, dead } = await decorations(3, false);
    expect(badges[0].renderOptions.after.contentText).toBe('0 imports');
    expect(dead, 'la ligne est grisee, et c est legitime ici').toHaveLength(1);
  });

  it('balayage au plafond : point d interrogation, et rien de grise', async () => {
    const { badges, dead } = await decorations(MAX_SWEEP_FILES, false);
    expect(badges).toHaveLength(1);
    expect(badges[0].renderOptions.after.contentText).toBe('? imports');
    expect(dead, 'on ne grise pas une ligne sur un balayage incomplet').toHaveLength(0);
  });
});
