/**
 * Un import référencé seulement par un lien KDoc n'est pas mort.
 *
 * En Kotlin, `[Flow]` dans une KDoc se resout PAR LES IMPORTS du fichier :
 * retirer l'import casse le lien, la documentation generee et le survol de
 * l'IDE. IntelliJ ne signale donc jamais un tel import comme inutilise.
 *
 * Le detecteur balayait le texte apres `sanitizeForUsageScan`, qui supprime
 * les commentaires : ces references etaient invisibles. Sur un projet reel de
 * 3187 fichiers Kotlin, 15 des 37 imports signales, soit 41 %, ne sont
 * references QUE par une KDoc. Aucun n'etait utilise dans du code, donc le
 * build ne cassait pas, mais suivre le conseil degradait 15 liens de
 * documentation.
 */
import { describe, it, expect } from 'vitest';
import { findUnusedImports } from '../../src/providers/unusedImports';

const NL = String.fromCharCode(10);
const Q3 = String.fromCharCode(34).repeat(3);
const fichier = (...lignes: string[]) => lignes.join(NL);

const morts = (texte: string) => findUnusedImports(texte).map(u => u.statement.trim());

describe('un import cite dans une KDoc reste vivant', () => {
  it('lien simple [Flow]', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import kotlinx.coroutines.flow.Flow',
      '',
      '/**',
      ' * @return A [Flow] emitting items.',
      ' */',
      'fun f(): Int = 1',
    ))).toEqual([]);
  });

  it('lien qualifie [MediaSession.Token]', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import androidx.media3.session.MediaSession',
      '',
      '/** Voir [MediaSession.Token] pour le detail. */',
      'fun f(): Int = 1',
    ))).toEqual([]);
  });

  it('lien avec texte [le flux][Flow]', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import kotlinx.coroutines.flow.Flow',
      '',
      '/** Rend [le flux][Flow]. */',
      'fun f(): Int = 1',
    ))).toEqual([]);
  });

  it('balise @see et @throws', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import java.io.IOException',
      'import org.reactivestreams.Subscriber',
      '',
      '/**',
      ' * @throws IOException si la lecture echoue',
      ' * @see Subscriber',
      ' */',
      'fun f(): Int = 1',
    ))).toEqual([]);
  });

  it('un commentaire de ligne compte aussi', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import kotlinx.coroutines.flow.Flow',
      '',
      '// renvoie un [Flow] plus tard',
      'fun f(): Int = 1',
    ))).toEqual([]);
  });

  it('mais un import cite nulle part reste mort', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import kotlinx.coroutines.flow.Flow',
      'import java.io.File',
      '',
      '/** Rend un [Flow]. */',
      'fun f(): Int = 1',
    ))).toEqual(['import java.io.File']);
  });

  it('un crochet dans une CHAINE ne compte pas', () => {
    // Une chaine n'est pas de la documentation : rien ne s'y resout.
    expect(morts(fichier(
      'package p',
      '',
      'import kotlinx.coroutines.flow.Flow',
      '',
      'fun f(): String = "voir [Flow] ailleurs"',
    ))).toEqual(['import kotlinx.coroutines.flow.Flow']);
  });

  it('ni un crochet dans une chaine brute', () => {
    expect(morts(fichier(
      'package p',
      '',
      'import kotlinx.coroutines.flow.Flow',
      '',
      'val doc = ' + Q3,
      'voir [Flow]',
      Q3,
    ))).toEqual(['import kotlinx.coroutines.flow.Flow']);
  });

  it('et un nom seulement cite en prose, sans crochets, reste mort', () => {
    // Sans crochets ce n'est pas un lien : rien ne casse a le retirer.
    expect(morts(fichier(
      'package p',
      '',
      'import java.io.File',
      '',
      '/** On pourrait utiliser File ici un jour. */',
      'fun f(): Int = 1',
    ))).toEqual(['import java.io.File']);
  });
});
