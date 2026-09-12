/**
 * Un pourcentage sous la resolution du bench est une fausse alerte.
 *
 * `perf-diff` comparait deux mesures quelles que soient leurs valeurs. Entre
 * les deux references commitees, `resolveTarget.object` passait de 0,001 a
 * 0,000 ms et la table annonçait un vert vif « -100.0% » : six dixiemes de
 * microseconde presentes comme un doublement de vitesse, sur un scenario dont
 * le temps est celui de la boucle de mesure elle meme.
 *
 * Le watchdog de perf tourne a chaque tick sur cette table. Un lecteur qui
 * apprend a sauter une fausse alerte saute la vraie a cote.
 */
import { describe, it, expect } from 'vitest';
import { ecart } from '../../../scripts/perf-diff';

const nu = (s: string) => s.replace(/\x1b\[\d+m/g, '');

describe('perf-diff : le seuil de lecture', () => {
  it('une difference sous le seuil ne devient pas un pourcentage', () => {
    // Le cas reel des deux references commitees.
    expect(nu(ecart(0.0006, 0.0000))).toBe('sous le seuil');
    expect(nu(ecart(0.001, 0.000))).toBe('sous le seuil');
  });

  it('une base a zero ne se lit pas non plus en pourcentage', () => {
    expect(nu(ecart(0, 0.5))).toBe('base a zero');
  });

  it('temoin : une vraie amelioration reste lisible', () => {
    expect(nu(ecart(2.560, 2.334))).toBe('-8.8%');
    expect(nu(ecart(0.067, 0.052))).toBe('-22.4%');
  });

  it('temoin : une vraie regression reste lisible', () => {
    expect(nu(ecart(0.035, 0.038))).toBe('8.6%');
    expect(nu(ecart(1.000, 1.100))).toBe('10.0%');
  });

  it('temoin : le seuil porte sur la difference, pas sur les valeurs', () => {
    // Deux grands nombres tres proches : rien a signaler.
    expect(nu(ecart(100.000, 100.001))).toBe('sous le seuil');
    // Deux petits nombres assez ecartes : signale.
    expect(nu(ecart(0.004, 0.010))).toBe('150.0%');
  });
});
