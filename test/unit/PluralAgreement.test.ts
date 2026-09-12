/**
 * Les comptes affiches a l utilisateur s accordent.
 *
 * Plusieurs endroits ecrivaient le pluriel en dur a cote d un compte, donc un
 * seul element donnait « 1 screens », « 1 declarations », « 1 file(s) »,
 * « 1 findings », « 1 tests ». Le meme depot accordait pourtant deja
 * correctement a plusieurs autres endroits : la forme etait connue, elle
 * n etait simplement pas partagee.
 *
 * Trois sites qui ressemblaient au meme defaut sont laisses tels quels parce
 * qu ils ne peuvent pas valoir un : le selecteur d ecran est garde par
 * `alternatives.length > 1`, l ombrage de ressource par `defs.length < 2`, et
 * le bouton « ambiguous » ne s affiche qu a partir de deux candidats.
 */
import { describe, it, expect } from 'vitest';
import { plural } from '../../src/util/plural';

describe('plural', () => {
  it('un est singulier, zero et plus sont pluriels', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(2, 'file')).toBe('2 files');
  });

  it('un pluriel irregulier peut etre donne', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });

  it('temoin : un nombre negatif n est pas traite a part', () => {
    expect(plural(-1, 'file')).toBe('-1 files');
  });
});

describe('les messages qui comptent', () => {
  it('aucune chaine visible ne colle un pluriel a un compte', async () => {
    // Balayage du source : un `${...length}` suivi d un mot au pluriel, hors
    // journalisation et hors sites gardes a deux ou plus. Le gardien empeche
    // la faute de revenir ailleurs que la ou elle a ete jugee inatteignable.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const racine = path.resolve(__dirname, '..', '..', 'src');
    // Deux formes : un compte calcule sur place, et un compte deja range dans
    // une variable. La premiere version du gardien ne voyait que la premiere,
    // et laissait passer onze sites de la seconde.
    const COMPTE = /\$\{[^}]*(?:length|size|count)[^}]*\}\s+([a-z]+s)\b|\$\{[A-Za-z_][\w.]*\}\s+([a-z]+s)\b/;
    const LOG = /\.(debug|info|warn|error|appendLine)\s*\(|console\.\w+\s*\(|\blog\s*\(|\btrace\?\.\(/;
    // Sites qui ne peuvent pas valoir un, ou dont le pluriel est celui d un
    // rapport (`1/12 libs missing` se lit tres bien). Nommes un par un plutot
    // que tolerés par un motif, pour qu un nouveau cas doive etre juge.
    const TOLERES = new Set([
      'src/ui/ScreenFlowPanel.ts',                  // alternatives.length > 1
      'src/providers/ResourceShadowingProvider.ts', // defs.length < 2 retourne
      'src/commands/AndroidRunCommand.ts',          // cas `ambiguous`, deux au moins
      'src/providers/FindUsagesPanel.ts',           // 0, 1 et N deja distingues
      'src/providers/unusedRemoteConfigKeys.ts',    // n > 1 dans le ternaire
      'src/providers/SealedWhenCoverageProvider.ts', // rapport `1/1 branches`
      'src/providers/UnusedParameterProvider.ts',   // fileCount > 1
      'src/ui/SourcesStatusBar.ts',                 // rapport `1/12 libs missing`
      'src/extension.ts',                           // infobulle d index, projet a un fichier
      'src/extension.browser.ts',                   // idem
    ]);
    const fautes: string[] = [];
    const walk = (dir: string): void => {
      for (const nom of fs.readdirSync(dir)) {
        const complet = path.join(dir, nom);
        if (fs.statSync(complet).isDirectory()) { walk(complet); continue; }
        if (!nom.endsWith('.ts')) continue;
        const rel = path.relative(path.resolve(__dirname, '..', '..'), complet).split(path.sep).join('/');
        if (TOLERES.has(rel)) continue;
        const lignes = fs.readFileSync(complet, 'utf8').split('\n');
        lignes.forEach((l, i) => {
          if (LOG.test(l)) return;
          // Une ligne qui accorde deja en place, `${n > 1 ? 's' : ''}`, n est
          // pas en faute : c est la forme longue de ce que `plural` fait.
          // L accord peut etre sur la ligne d au dessus : `const base = n > 1`
          // suivi des deux branches. Regarder la seule ligne courante faisait
          // crier la sonde sur du code deja correct.
          const accord = /[><=!]==?\s*1\s*\?|>\s*1\s*\?|[><=!]==?\s*1$|>\s*1$/;
          // Deux lignes de recul : un ternaire s ecrit couramment sur trois
          // lignes, condition, branche vraie, branche fausse, et c est la
          // condition qui porte l accord.
          if (accord.test(l) || accord.test(lignes[i - 1] ?? '') || accord.test(lignes[i - 2] ?? '')) return;
          const nu = l.trim();
          if (nu.startsWith('//') || nu.startsWith('*')) return;
          const m = COMPTE.exec(l);
          // `${gap.to} is missing` : le verbe finit par un s sans etre un nom.
          const VERBES = new Set(['is', 'was', 'has', 'does', 'goes', 'as', 'its', 'this', 'us', 'plus', 'less', 'across', 'says', 'needs', 'keeps', 'holds']);
          const mot = m?.[1] ?? m?.[2];
          if (mot && !VERBES.has(mot)) fautes.push(`${rel}:${i + 1}: ${nu.slice(0, 90)}`);
        });
      }
    };
    walk(racine);
    expect(fautes, 'utiliser plural() de src/util/plural.ts').toEqual([]);
  });
});
