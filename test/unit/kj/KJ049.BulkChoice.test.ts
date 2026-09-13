import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { askHowToApply, bulkDetail } from '../../../src/util/bulkEdit';

/**
 * `needsConfirmation: true` est ce qui OUVRE l'apercu de refactoring, et c'est
 * le meme drapeau qui laisse chacune de ses cases DECOCHEE. Cette vue n'a pas
 * de « tout selectionner » : accepter 171 resserrements repartis sur 43
 * fichiers demandait 43 clics avant le bouton Apply, un par fichier.
 *
 * La question se pose donc une fois, en amont, ou un seul clic repond pour
 * tout. Qui veut lire l'apercu l'obtient inchange.
 */

const repond = (choix: string | undefined) =>
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockResolvedValue(choix as any);

afterEach(() => vi.restoreAllMocks());

describe('askHowToApply', () => {
  it('Apply all rend apply', async () => {
    repond('Apply all');
    expect(await askHowToApply('q', 'd')).toBe('apply');
  });

  it('Review one by one rend review', async () => {
    repond('Review one by one');
    expect(await askHowToApply('q', 'd')).toBe('review');
  });

  it('fermer la boite rend cancel, et rien ne doit etre applique', async () => {
    repond(undefined);
    expect(await askHowToApply('q', 'd')).toBe('cancel');
  });

  it('une reponse inconnue ne vaut pas un oui', async () => {
    repond('Autre chose');
    expect(await askHowToApply('q', 'd')).toBe('cancel');
  });

  it('la boite est MODALE : sinon la question se perd dans les notifications', async () => {
    const spy = repond('Apply all');
    await askHowToApply('Narrow 171 members to private?', bulkDetail(171, 43));
    expect(spy).toHaveBeenCalledWith(
      'Narrow 171 members to private?',
      expect.objectContaining({ modal: true }),
      'Apply all', 'Review one by one',
    );
  });
});

describe('bulkDetail', () => {
  it('la phrase se laisse completer sans coller ses mots', () => {
    const d = bulkDetail(3, 2) + ' 1 file deleted outright.';
    expect(d).toContain('files. Apply all');
    expect(d).toContain('ticked. 1 file deleted outright.');
  });

  it('accorde ses comptes', () => {
    expect(bulkDetail(171, 43)).toContain('171 changes in 43 files.');
    expect(bulkDetail(1, 1)).toContain('1 change in 1 file.');
  });

  it('dit ce que chaque bouton fait', () => {
    const d = bulkDetail(2, 2);
    expect(d).toContain('Apply all skips the preview');
    expect(d).toContain('nothing ticked');
  });
});
