/**
 * Le portail des tirets ne regardait jamais DANS un gabarit multiligne.
 *
 * Il lisait ligne par ligne et exigeait un litteral ouvert ET ferme sur la
 * meme ligne. Toute la vue web d un panneau est ecrite en un seul gabarit qui
 * court sur cent lignes, donc son texte visible n a jamais ete examine. Son
 * propre commentaire l annonçait : « every banned dash lives in a single line
 * literal ». C etait vrai le jour ou il a ete ecrit, et rien ne le verifiait.
 *
 * Mesure sur l arbre : un seul tiret vit dans cette zone aveugle aujourd hui,
 * et il est dans un commentaire CSS de la feuille de style du panneau de
 * previsualisation, donc pas de la copie. Le trou, lui, est bien reel.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error le portail est un script .mjs sans types
import { scanSource } from '../../../.github/scripts/check-no-dashes.mjs';

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const NL = String.fromCharCode(10);
const scan = (texte: string) => scanSource('src/x.ts', texte) as { line: number; which: string }[];

describe('le portail des tirets', () => {
  it('voit un tiret dans un gabarit multiligne', () => {
    const r = scan([
      'const html = `',
      '  <body>',
      `    <p>Aucun apercu ${EM} ouvrez un fichier</p>`,
      '  </body>',
      '`;',
    ].join(NL));
    expect(r).toHaveLength(1);
    expect(r[0].line).toBe(3);
    expect(r[0].which).toBe('em-dash');
  });

  it('voit aussi un tiret en dans un gabarit multiligne', () => {
    expect(scan(['const h = `', `  <p>2019${EN}2020</p>`, '`;'].join(NL))[0].which).toBe('en-dash');
  });

  it('un commentaire CSS du gabarit reste du code', () => {
    // Le seul cas present dans l arbre : une note de mise en page, jamais
    // affichee. La signaler ferait echouer la publication sur du code.
    expect(scan([
      'const html = `',
      '  <style>',
      '    /* damier pour rendre la transparence',
      `       lisible ${EM} comme Photoshop et Figma. */`,
      '    main { color: red; }',
      '  </style>',
      '`;',
    ].join(NL))).toEqual([]);
  });

  it('un commentaire HTML du gabarit aussi', () => {
    expect(scan(['const h = `', `  <!-- note ${EM} interne -->`, '`;'].join(NL))).toEqual([]);
  });

  it('temoin : un litteral sur une seule ligne reste vu', () => {
    expect(scan(`void show('Rien ${EM} ouvrez un dossier');`)).toHaveLength(1);
  });

  it('temoin : la journalisation reste exemptee', () => {
    expect(scan(`this.log.info('scan ${EM} termine');`)).toEqual([]);
  });

  it('temoin : un commentaire de code n est pas de la copie', () => {
    expect(scan(`// une note ${EM} pour le lecteur du code${NL}const x = 1;`)).toEqual([]);
  });

  it('temoin : un fichier sans tiret ne rend rien', () => {
    expect(scan('const html = `' + NL + '  <p>tout va bien</p>' + NL + '`;')).toEqual([]);
  });

  it('la ligne rapportee est celle du tiret, pas celle du gabarit', () => {
    const r = scan(['const h = `', '  <p>a</p>', '  <p>b</p>', `  <p>c ${EM} d</p>`, '`;'].join(NL));
    expect(r[0].line).toBe(4);
  });
});
