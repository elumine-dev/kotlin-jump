import { describe, it, expect } from 'vitest';
import { WhatsNewPanel } from '../../src/providers/WhatsNewPanel';

// Le panneau échappait tout et n'interprétait rien : les notes de version, qui
// nomment des fichiers et des drapeaux entre accents graves depuis la v1.42.20,
// affichaient ces accents graves tels quels au lecteur.

const build = (data: unknown): string => (WhatsNewPanel as any).buildHtml(data);

const base = {
  version: '1.42.30',
  title: "What's New",
  tagline: 'Des actions de suppression fiables',
  summary: 'Le constructeur `attrs: AttributeSet?` est préservé.',
  highlights: [
    { title: 'Le correctif vise `res/raw/keep.xml`', kind: 'fix', description: 'La liste `tools:keep` est respectée.' },
  ],
  sections: [
    { heading: 'Fixes', bullets: ['Les enums `@Entity` de Room ne sont plus signalés.'] },
  ],
  links: {},
};

describe("Panneau What's New — portions de code", () => {
  it('rend les accents graves en <code> dans le résumé, les cartes et les puces', () => {
    const html = build(base);
    expect(html).toContain('<code>attrs: AttributeSet?</code>');
    expect(html).toContain('<code>res/raw/keep.xml</code>');
    expect(html).toContain('<code>tools:keep</code>');
    expect(html).toContain('<code>@Entity</code>');
    // Plus un seul accent grave visible dans le corps rendu.
    const body = html.slice(html.indexOf('<body'));
    expect(body).not.toContain('`');
  });

  it('échappe le HTML avant de découper les portions de code', () => {
    const html = build({
      ...base,
      summary: '<img src=x onerror=alert(1)>',
      sections: [{ heading: 'Fixes', bullets: ['Le type `List<String>` est lu.', 'Une "citation" et un & seul.'] }],
      highlights: [],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // Le contenu d'une portion de code est échappé lui aussi.
    expect(html).toContain('<code>List&lt;String&gt;</code>');
    expect(html).toContain('&quot;citation&quot;');
    expect(html).toContain('&amp;');
  });

  it('un accent grave isolé ou à cheval sur deux lignes reste littéral', () => {
    const html = build({
      ...base,
      summary: 'Un seul accent grave ` reste tel quel.',
      highlights: [],
      sections: [{ heading: 'Fixes', bullets: ['Ouvre `ici\nferme là.'] }],
    });
    expect(html).not.toContain('<code>');
    expect(html).toContain('accent grave ` reste');
  });

  it('le style de code est présent une seule fois et suit le thème', () => {
    const html = build(base);
    const matches = html.match(/^\s*code \{/gm) ?? [];
    expect(matches.length).toBe(1);
    expect(html).toContain('--vscode-editor-font-family');
    expect(html).toContain('--vscode-textCodeBlock-background');
  });
});
