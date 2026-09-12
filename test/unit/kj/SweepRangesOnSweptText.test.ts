import { describe, it, expect } from 'vitest';
import { sweptRanges } from '../../../src/commands/DeadCodeSweep';

/**
 * Le balayage de l'espace de travail lit le DISQUE, puis relit le disque une
 * seconde fois pour convertir ses offsets en positions, puis applique le
 * resultat au DOCUMENT. Pour un fichier ouvert et non enregistre, cela fait
 * trois textes differents pour une meme suppression, et rien ne les comparait.
 *
 * Les offsets viennent du texte balaye. Ils ne valent que contre lui.
 */

const BALAYE = [
  'package com.x',
  '',
  'class A',
  '',
  'class Mort',
  '',
].join('\n');

const debut = BALAYE.indexOf('class Mort');
const coupes = [{ start: debut, end: debut + 'class Mort'.length }];

describe('sweptRanges', () => {
  it('temoin : le texte vivant est celui balaye, les positions sont rendues', () => {
    const r = sweptRanges(BALAYE, BALAYE, coupes);
    expect(r).toBeDefined();
    expect(r![0].start.line).toBe(4);
    expect(r![0].start.character).toBe(0);
    expect(r![0].end.line).toBe(4);
  });

  it('une ligne ajoutee au dessus dans un tampon non enregistre : rien n est rendu', () => {
    const sale = 'import com.y.Z\n' + BALAYE;
    expect(sweptRanges(BALAYE, sale, coupes)).toBeUndefined();
  });

  it('le fichier a change sur le disque depuis le balayage : rien n est rendu', () => {
    expect(sweptRanges(BALAYE, BALAYE.replace('class A', 'class A2'), coupes)).toBeUndefined();
  });

  it('le degat evite, mesure : la coupe tombait dans le package', () => {
    const sale = 'import com.y.Z\n' + BALAYE;
    // L'ancien comportement, reproduit : les offsets de BALAYE convertis avec
    // les debuts de ligne du texte vivant. Une seule ligne ajoutee au dessus et
    // la coupe visant `class Mort` ligne 4 designe la ligne 1 caractere 9,
    // c'est a dire le milieu de `package com.x`.
    const ancien = sweptRanges(sale, sale, coupes);
    expect(ancien![0].start.line).toBe(1);
    expect(ancien![0].start.character).toBe(9);
    expect(sweptRanges(BALAYE, sale, coupes)).toBeUndefined();
  });
});
