/**
 * KJ-017 — quand aucune definition ne gagne, le survol ne doit pas en couronner
 * une au hasard.
 *
 * `score()` ne connait que deux axes : app contre library, et main contre autre
 * source set. Deux libraries `main` ont donc exactement le meme score, et
 * `resolveWinner` departageait par l'ordre du tableau. Or cet ordre vient de
 * l'iteration d'une Map alimentee par l'ordre de balayage des fichiers : le
 * « gagnant » changeait de machine en machine.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse, par le vrai chemin de
 * production (229 fichiers values, 1644 cles) : 122 survols d'ombrage rendus,
 * dont 20 couronnaient une definition a egalite et barraient l'autre.
 * Exemples : `color.colorPrimary` defini dans `ui`, `login` et `base` ;
 * `string.app_name` defini dans les deux variantes exclusives
 * `replicaLaPresseRelease` et `adPreflightLaPresseRelease` de `app`.
 *
 * Barrer une definition qui n'est pas ombragee est un faux affichage : entre
 * deux libraries c'est l'ordre des dependances Gradle qui tranche, et entre
 * deux variantes exclusives il n'y a tout simplement pas de concurrence.
 */
import { describe, it, expect } from 'vitest';
import { resolveWinner, ResourceDefinition } from '../../src/indexer/ResourcePriorityResolver';
import { ResourceShadowingProvider } from '../../src/providers/ResourceShadowingProvider';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';

const def = (over: Partial<ResourceDefinition>): ResourceDefinition => ({
  module: 'app',
  moduleType: 'app',
  sourceSet: 'main',
  folder: 'values',
  value: 'x',
  ...over,
});

describe('resolveWinner — une egalite n est pas un ombrage', () => {
  it('deux libraries main : personne n ombrage personne', () => {
    const r = resolveWinner([
      def({ module: 'ui', moduleType: 'library' }),
      def({ module: 'base', moduleType: 'library' }),
    ]);
    expect(r.shadowed, 'aucune des deux ne perd').toEqual([]);
    expect(r.tied, 'elles sont a egalite avec le gagnant annonce').toEqual([1]);
  });

  it('trois libraries main : les deux autres sont a egalite', () => {
    const r = resolveWinner([
      def({ module: 'ui', moduleType: 'library' }),
      def({ module: 'login', moduleType: 'library' }),
      def({ module: 'base', moduleType: 'library' }),
    ]);
    expect(r.shadowed).toEqual([]);
    expect(r.tied).toEqual([1, 2]);
  });

  it('deux variantes exclusives du meme module app', () => {
    const r = resolveWinner([
      def({ sourceSet: 'replicaLaPresseRelease' }),
      def({ sourceSet: 'adPreflightLaPresseRelease' }),
    ]);
    expect(r.shadowed).toEqual([]);
    expect(r.tied).toEqual([1]);
  });

  it('un vrai ombrage reste un ombrage', () => {
    const r = resolveWinner([
      def({ module: 'lib', moduleType: 'library' }),
      def({}),
    ]);
    expect(r.winner).toBe(1);
    expect(r.shadowed, 'la library perd bel et bien').toEqual([0]);
    expect(r.tied).toEqual([]);
  });

  it('egalite en tete ET un perdant strict : les deux roles coexistent', () => {
    const r = resolveWinner([
      def({ module: 'ui', moduleType: 'library' }),
      def({ module: 'base', moduleType: 'library' }),
      def({}),
    ]);
    expect(r.winner, 'app gagne').toBe(2);
    expect(r.tied, 'aucune des libraries n egale app').toEqual([]);
    expect(r.shadowed.sort()).toEqual([0, 1]);
  });
});

const NL = String.fromCharCode(10);
const TILDE = String.fromCharCode(126);

function survol(fichiers: { uri: string; name: string; value: string }[], ligne: string) {
  const colors = new ColorResourceIndex();
  const strings = new StringResourceIndex();
  for (const f of fichiers) {
    const xml = `<resources>${NL}  <color name="${f.name}">${f.value}</color>${NL}</resources>`;
    colors.reindexFile({ toString: () => f.uri }, xml);
  }
  const doc = mockDocument('file:///w/app/src/main/kotlin/A.kt', ligne);
  const provider = new ResourceShadowingProvider(colors, strings);
  const col = ligne.indexOf('R.color.') + 3;
  return provider.provideHover(doc, new Position(0, col) as any);
}

const LIB = (mod: string, value: string) => ({
  uri: `file:///w/${mod}/src/main/res/values/colors.xml`,
  name: 'colorPrimary',
  value,
});

describe('ResourceShadowingProvider — le survol sur une egalite', () => {
  it('ne couronne personne et ne barre personne', () => {
    const hover = survol(
      [LIB('ui', '#111111'), LIB('login', '#222222'), LIB('base', '#333333')],
      'val c = R.color.colorPrimary',
    );
    expect(hover, 'trois definitions : le survol doit exister').toBeTruthy();
    const md = (hover as any).contents[0].value as string;
    expect(md, 'aucune ne gagne, donc pas de trophee').not.toContain('🏆');
    expect(md, 'aucune n est ombragee, donc rien de barre').not.toContain(TILDE + TILDE);
    expect(md, 'et le survol dit pourquoi il ne tranche pas').toContain('dependency order');
    for (const mod of ['ui', 'login', 'base']) {
      expect(md, `${mod} doit rester visible`).toContain(mod);
    }
  });

  it('garde le trophee et la rature quand un module gagne vraiment', () => {
    const hover = survol(
      [
        LIB('ui', '#111111'),
        { uri: 'file:///w/app/src/main/res/values/colors.xml', name: 'colorPrimary', value: '#999999' },
      ],
      'val c = R.color.colorPrimary',
    );
    const md = (hover as any).contents[0].value as string;
    expect(md, 'app gagne pour de bon').toContain('🏆');
    expect(md, 'la library est bien ombragee').toContain(TILDE + TILDE);
  });

  it('un perdant strict reste barre meme quand la tete est a egalite', () => {
    const hover = survol(
      [
        { uri: 'file:///w/app/src/premium/res/values/colors.xml', name: 'colorPrimary', value: '#aaaaaa' },
        { uri: 'file:///w/app/src/demo/res/values/colors.xml', name: 'colorPrimary', value: '#bbbbbb' },
        LIB('ui', '#111111'),
      ],
      'val c = R.color.colorPrimary',
    );
    const md = (hover as any).contents[0].value as string;
    expect(md, 'les deux variantes ne se departagent pas').not.toContain('🏆');
    expect(md, 'la library, elle, perd vraiment').toContain(TILDE + TILDE);
    expect(md.split(NL).filter(l => l.includes(TILDE + TILDE)), 'une seule rature').toHaveLength(1);
  });

  it('deux definitions dans le MEME dossier restent un doublon, pas une egalite', () => {
    const colors = new ColorResourceIndex();
    const strings = new StringResourceIndex();
    for (const f of ['colors.xml', 'colors_refs.xml']) {
      colors.reindexFile(
        { toString: () => `file:///w/app/src/main/res/values/${f}` },
        `<resources>${NL}  <color name="colorPrimary">#123456</color>${NL}</resources>`,
      );
    }
    const ligne = 'val c = R.color.colorPrimary';
    const doc = mockDocument('file:///w/app/src/main/kotlin/A.kt', ligne);
    const hover = new ResourceShadowingProvider(colors, strings)
      .provideHover(doc, new Position(0, ligne.indexOf('R.color.') + 3) as any);
    const md = (hover as any).contents[0].value as string;
    expect(md, 'le doublon garde son etiquette d erreur de fusion').toContain('duplicated in the same folder');
    expect(md, 'un doublon n est pas une egalite entre modules').not.toContain('dependency order');
  });
});
