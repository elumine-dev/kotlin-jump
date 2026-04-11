import * as vscode from 'vscode';

interface WhatsNewHighlight {
  title: string;
  description?: string;
  kind?: 'improvement' | 'fix' | 'note';
}

interface WhatsNewSection {
  heading: string;
  bullets: string[];
}

interface WhatsNewLinks {
  changelog?: string;
  review?: string;
  issues?: string;
}

interface WhatsNewData {
  schemaVersion?: number;
  version: string;
  title?: string;
  tagline?: string;
  summary: string;
  highlights?: WhatsNewHighlight[];
  sections: WhatsNewSection[];
  links?: WhatsNewLinks;
}

export class WhatsNewPanel {
  private static current: vscode.WebviewPanel | undefined;

  static async show(context: vscode.ExtensionContext): Promise<void> {
    if (WhatsNewPanel.current) {
      WhatsNewPanel.current.reveal(vscode.ViewColumn.One);
      return;
    }

    const data = await this.readData(context);
    if (!data) {
      void vscode.window.showInformationMessage(
        "What's New content is not available in this build."
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'kotlinJumpWhatsNew',
      `Kotlin Jump — What's New`,
      vscode.ViewColumn.One,
      {
        enableScripts: false,
        retainContextWhenHidden: false,
      }
    );

    WhatsNewPanel.current = panel;

    panel.onDidDispose(() => {
      WhatsNewPanel.current = undefined;
    });

    panel.webview.html = this.buildHtml(data);
  }

  private static async readData(
    context: vscode.ExtensionContext
  ): Promise<WhatsNewData | undefined> {
    try {
      const uri = vscode.Uri.joinPath(
        context.extensionUri,
        'media',
        'whats-new.json'
      );
      const raw = await vscode.workspace.fs.readFile(uri);
      const data = JSON.parse(Buffer.from(raw).toString('utf8')) as WhatsNewData;

      if (
        !data ||
        typeof data.version !== 'string' ||
        typeof data.summary !== 'string' ||
        !Array.isArray(data.sections)
      ) {
        return undefined;
      }

      return data;
    } catch {
      return undefined;
    }
  }

  private static buildHtml(data: WhatsNewData): string {
    const title = this.escapeHtml(data.title || "What's New in Kotlin Jump");
    const version = this.escapeHtml(data.version);
    const tagline = this.escapeHtml(
      data.tagline || 'Fast scan. Clear value. No fluff.'
    );
    const summary = this.escapeHtml(data.summary);

    const highlightsHtml = (data.highlights || [])
      .slice(0, 3)
      .map((highlight) => {
        const badgeLabel = this.getKindLabel(highlight.kind);
        const badgeClass = this.getKindClass(highlight.kind);

        return `
          <article class="card">
            <div class="badge ${badgeClass}">${this.escapeHtml(badgeLabel)}</div>
            <h3>${this.escapeHtml(highlight.title)}</h3>
            ${
              highlight.description
                ? `<p>${this.escapeHtml(highlight.description)}</p>`
                : ''
            }
          </article>
        `;
      })
      .join('');

    const sectionsHtml = data.sections
      .map((section) => {
        const bullets = (section.bullets || [])
          .map(
            (bullet) => `
              <div class="item">
                <span class="bullet"></span>
                <p>${this.escapeHtml(bullet)}</p>
              </div>
            `
          )
          .join('');

        if (!bullets) {
          return '';
        }

        return `
          <section class="section">
            <h2>${this.escapeHtml(section.heading)}</h2>
            <div class="list">
              ${bullets}
            </div>
          </section>
        `;
      })
      .join('');

    const footerHtml = this.buildFooterHtml(data.links);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light dark;
      --kj-radius-xl: 22px;
      --kj-radius-lg: 18px;
      --kj-radius-md: 14px;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: 14px;
      line-height: 1.6;
    }

    body {
      background:
        radial-gradient(
          circle at top right,
          color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent),
          transparent 28%
        ),
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--vscode-editor-background) 92%, white 8%),
          var(--vscode-editor-background)
        );
    }

    .wrap {
      max-width: 920px;
      margin: 0 auto;
      padding: 28px 22px 40px;
    }

    .hero {
      position: relative;
      overflow: hidden;
      margin-bottom: 20px;
      padding: 22px;
      border-radius: var(--kj-radius-xl);
      border: 1px solid var(--vscode-panel-border);
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent),
          color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%)
        );
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 82%, white 18%);
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-bottom: 14px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      line-height: 1.1;
      letter-spacing: -0.03em;
      max-width: 14ch;
    }

    .tagline {
      margin: 0 0 10px;
      font-size: 15px;
      color: var(--vscode-descriptionForeground);
    }

    .summary {
      margin: 0;
      max-width: 62ch;
      color: var(--vscode-editor-foreground);
    }

    .cards {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      margin: 18px 0 22px;
    }

    .card {
      padding: 18px;
      border-radius: var(--kj-radius-lg);
      border: 1px solid var(--vscode-panel-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, white 12%);
    }

    .card h3 {
      margin: 0 0 6px;
      font-size: 18px;
      line-height: 1.3;
      letter-spacing: -0.02em;
    }

    .card p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
    }

    .badge {
      display: inline-block;
      margin-bottom: 10px;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }

    .badge-improvement {
      color: var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
    }

    .badge-fix {
      color: var(--vscode-testing-iconPassed);
      background: color-mix(in srgb, var(--vscode-testing-iconPassed) 16%, transparent);
    }

    .badge-note {
      color: var(--vscode-descriptionForeground);
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 16%, transparent);
    }

    .section {
      margin-top: 22px;
    }

    .section h2 {
      margin: 0 0 10px;
      font-size: 17px;
      line-height: 1.3;
      letter-spacing: -0.02em;
    }

    .list {
      display: grid;
      gap: 10px;
    }

    .item {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--vscode-panel-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
    }

    .bullet {
      width: 8px;
      height: 8px;
      margin-top: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--vscode-textLink-foreground) 75%, white 25%),
        var(--vscode-textLink-foreground)
      );
    }

    .item p {
      margin: 0;
      color: var(--vscode-editor-foreground);
    }

    .footer {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 26px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 14px;
      border-radius: var(--kj-radius-md);
      border: 1px solid var(--vscode-panel-border);
      text-decoration: none;
      font-size: 13px;
      color: var(--vscode-editor-foreground);
      background: color-mix(in srgb, var(--vscode-editor-background) 82%, white 18%);
    }

    .btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .btn.primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: color-mix(in srgb, var(--vscode-button-background) 70%, black 30%);
    }

    .btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    @media (max-width: 720px) {
      .wrap {
        padding: 20px 16px 28px;
      }

      h1 {
        font-size: 24px;
      }

      .hero,
      .card,
      .item {
        padding-left: 16px;
        padding-right: 16px;
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Version ${version}</div>
      <h1>${title}</h1>
      <p class="tagline">${tagline}</p>
      <p class="summary">${summary}</p>
    </section>

    ${highlightsHtml ? `<section class="cards">${highlightsHtml}</section>` : ''}

    ${sectionsHtml}

    ${footerHtml}
  </main>
</body>
</html>`;
  }

  private static buildFooterHtml(links?: WhatsNewLinks): string {
    const items: string[] = [];

    if (links?.changelog) {
      items.push(
        `<a class="btn primary" href="${this.escapeAttribute(links.changelog)}">View changelog</a>`
      );
    }

    if (links?.review) {
      items.push(
        `<a class="btn" href="${this.escapeAttribute(links.review)}">Leave a review</a>`
      );
    }

    if (links?.issues) {
      items.push(
        `<a class="btn" href="${this.escapeAttribute(links.issues)}">Open issues</a>`
      );
    }

    if (items.length === 0) {
      return '';
    }

    return `<footer class="footer">${items.join('')}</footer>`;
  }

  private static getKindLabel(kind?: WhatsNewHighlight['kind']): string {
    switch (kind) {
      case 'improvement':
        return 'Improvement';
      case 'fix':
        return 'Fix';
      default:
        return 'Note';
    }
  }

  private static getKindClass(kind?: WhatsNewHighlight['kind']): string {
    switch (kind) {
      case 'improvement':
        return 'badge-improvement';
      case 'fix':
        return 'badge-fix';
      default:
        return 'badge-note';
    }
  }

  private static escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private static escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}
