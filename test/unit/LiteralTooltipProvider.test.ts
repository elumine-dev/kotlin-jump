/**
 * LiteralTooltipProvider — traduction cron + ISO 8601 dans les strings
 *
 * Vecteurs :
 *   LT-1  Formes cron courantes → phrases exactes
 *   LT-2  "1 2 3 4 5" (données pures, sans * ni /) → rejeté exprès
 *   LT-3  Champs hors bornes (minute 75, heure 25, jour 32) → null
 *   LT-4  Formes non phrasables (mois contraint, dow avec step) → null,
 *         jamais de traduction fausse
 *   LT-5  Durées ISO : PT1H30M, P2DT4H, PT90S, PT0.5S, P1W
 *   LT-6  Presque-durées : "P", "PT", "PTXH", texte quelconque → null
 *   LT-7  findLiteralHints : string en commentaire ignorée, colonne exacte
 *   LT-8  Deux littéraux sur une ligne → deux hints
 *   LT-9  Provider : java accepté, autre langue refusée
 *   LT-10 Raw string ouverte au-dessus de la range → contenu ignoré
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import {
  describeCron, describeIsoDuration, findLiteralHints, LiteralTooltipProvider,
} from '../../src/providers/LiteralTooltipProvider';

describe('LT-1 — formes cron courantes', () => {
  it.each([
    ['* * * * *',      'every minute'],
    ['*/15 * * * *',   'every 15 minutes'],
    ['30 * * * *',     'every hour at :30'],
    ['0 */6 * * *',    'every 6 hours'],
    ['45 */2 * * *',   'every 2 hours at :45'],
    ['0 9 * * *',      'daily at 9:00'],
    ['30 14 * * *',    'daily at 14:30'],
    ['0 9 * * 1',      'Mon at 9:00'],
    ['0 9 * * 1-5',    'Mon to Fri at 9:00'],
    ['0 9 * * 1,3,5',  'Mon, Wed, Fri at 9:00'],
    ['0 9 * * 0',      'Sun at 9:00'],
    ['0 9 * * 7',      'Sun at 9:00'],
    ['0 3 15 * *',     'monthly on day 15 at 3:00'],
  ])('%s → %s', (expr, expected) => {
    expect(describeCron(expr)).toBe(expected);
  });
});

describe('LT-2 — tuples de données rejetés', () => {
  it.each(['1 2 3 4 5', '0 9 1 1 1', '10 20 30 40 50'])('%s → null', (expr) => {
    expect(describeCron(expr)).toBeNull();
  });
});

describe('LT-3 — bornes', () => {
  it.each([
    '75 * * * *',      // minute > 59 en forme "every hour at" → null
    '0 25 * * *',      // heure > 23
    '0 9 32 * *',      // jour du mois > 31
    '0 9 * * 8',       // jour de semaine > 7
  ])('%s → null', (expr) => {
    expect(describeCron(expr)).toBeNull();
  });
});

describe('LT-4 — formes non phrasables', () => {
  it.each([
    '0 9 * 6 *',       // mois contraint
    '0 9 * * */2',     // step sur le jour de semaine
    '0 9 1 * 1',       // dom ET dow contraints
    'not a cron',
    '0 9 * *',         // 4 champs
    '0 9 * * * *',     // 6 champs (quartz)
  ])('%s → null', (expr) => {
    expect(describeCron(expr)).toBeNull();
  });
});

describe('LT-5 — durées ISO', () => {
  it.each([
    ['PT1H30M',  '1 hr 30 min'],
    ['P2DT4H',   '2 days 4 hr'],
    ['PT90S',    '90 sec'],
    ['PT0.5S',   '0.5 sec'],
    ['P1W',      '1 wk'],
    ['P1DT2H3M', '1 day 2 hr 3 min'],
    ['P1Y2M',    '1 yr 2 mo'],
  ])('%s → %s', (s, expected) => {
    expect(describeIsoDuration(s)).toBe(expected);
  });
});

describe('LT-6 — presque-durées', () => {
  it.each(['P', 'PT', 'PTXH', 'PXD', 'hello', '2h30m', 'PT1H30', ''])('%s → null', (s) => {
    expect(describeIsoDuration(s)).toBeNull();
  });
});

describe('LT-7 — scan de ligne', () => {
  it('string en commentaire ignorée', () => {
    expect(findLiteralHints('// val x = "0 */6 * * *"')).toHaveLength(0);
  });

  it('colonne = fin de la string fermante', () => {
    const line = 'val schedule = "0 */6 * * *"';
    const hits = findLiteralHints(line);
    expect(hits).toHaveLength(1);
    expect(hits[0].column).toBe(line.length);
    expect(hits[0].label).toBe('↳ every 6 hours');
  });

  it('string quelconque → rien', () => {
    expect(findLiteralHints('val name = "Kevin Doremy"')).toHaveLength(0);
  });
});

describe('LT-8 — deux littéraux par ligne', () => {
  it('cron + durée → deux hints', () => {
    const hits = findLiteralHints('sync("0 9 * * *", "PT1H")');
    expect(hits.map(h => h.label)).toEqual(['↳ daily at 9:00', '↳ 1 hr']);
  });
});

function makeDoc(lines: string[], languageId: string): vscode.TextDocument {
  return {
    languageId,
    lineCount: lines.length,
    lineAt: (n: number) => ({ text: lines[n] }),
  } as unknown as vscode.TextDocument;
}

describe('LT-9 — langues', () => {
  const line = 'String cron = "0 */6 * * *";';
  it('java → hint', () => {
    const p = new LiteralTooltipProvider();
    const h = p.provideInlayHints(makeDoc([line], 'java'), new vscode.Range(0, 0, 0, 0) as any);
    expect(h).toHaveLength(1);
  });
  it('python → rien', () => {
    const p = new LiteralTooltipProvider();
    const h = p.provideInlayHints(makeDoc([line], 'python'), new vscode.Range(0, 0, 0, 0) as any);
    expect(h).toHaveLength(0);
  });
});

describe('LT-10 — raw string au-dessus de la range', () => {
  it('le contenu de la """ est ignoré même hors viewport', () => {
    const lines = [
      'val doc = """',
      '  "0 */6 * * *"',
      '"""',
      'val real = "PT1H"',
    ];
    const p = new LiteralTooltipProvider();
    const h = p.provideInlayHints(makeDoc(lines, 'kotlin'), new vscode.Range(1, 0, 3, 0) as any);
    expect(h).toHaveLength(1);
    expect(h[0].position.line).toBe(3);
  });
});
