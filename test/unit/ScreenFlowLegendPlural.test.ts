/**
 * « 1 screens · 1 navigations · 1 deeplinks · 1 orphan(s) ».
 *
 * La legende de la carte des ecrans porte quatre comptes sur une ligne, tous
 * les quatre ecrits au pluriel en dur, le dernier avec un `(s)`. Une carte
 * d un seul ecran, ce qui arrive des qu on regarde un petit module, les
 * affiche tous les quatre faux.
 *
 * Le plus parlant : un test de regression epinglait deja `1 navigations`. Il
 * verifiait le NOMBRE, pas la phrase, donc il gelait la faute au lieu de la
 * signaler.
 */
import { describe, it, expect } from 'vitest';
import { renderHtml } from '../../src/ui/ScreenFlowPanel';

const nav = (nodes: number, deepLinks: number) => ({
  nodes: Array.from({ length: nodes }, (_, i) => ({
    route: `ecran${i}`, label: `Ecran${i}`, uri: `file:///w/E${i}.kt`, line: 0, kind: 'composable',
  })),
  edges: [],
  deepLinks: Array.from({ length: deepLinks }, (_, i) => ({ route: `ecran${i}`, uri: `app://x${i}` })),
  startDestinations: [] as string[],
} as any);

describe('la legende de la carte des ecrans s accorde', () => {
  it('un seul de chaque ne prend pas de s', () => {
    const html = renderHtml(nav(1, 1));
    expect(html).not.toContain('1 screens');
    expect(html).not.toContain('1 navigations');
    expect(html).not.toContain('1 deeplinks');
    expect(html).not.toContain('orphan(s)');
    expect(html).toContain('1 screen ');
    expect(html).toContain('1 deeplink ');
  });

  it('zero prend le pluriel, comme en anglais', () => {
    const html = renderHtml(nav(0, 0));
    expect(html).toContain('0 screens');
    expect(html).toContain('0 navigations');
    expect(html).toContain('0 deeplinks');
    expect(html).toContain('0 orphans');
  });

  it('plusieurs gardent le pluriel', () => {
    const html = renderHtml(nav(3, 2));
    expect(html).toContain('3 screens');
    expect(html).toContain('2 deeplinks');
  });

  it('temoin : le reste de la legende est intact', () => {
    const html = renderHtml(nav(2, 1));
    expect(html).toContain('click a screen to jump to the code');
    expect(html).toContain(' · ');
  });
});
