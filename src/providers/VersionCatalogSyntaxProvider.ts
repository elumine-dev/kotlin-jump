import * as vscode from 'vscode';
import { CATALOG_TOKEN_TYPES, scanVersionCatalog } from './versionCatalogSyntax';

/**
 * Colour and folding for `gradle/libs.versions.toml`, which VS Code opens as
 * plain text for want of a TOML grammar.
 *
 * Both providers are registered on a file name pattern, not on a language id:
 * the catalog is plain text when nothing else claims it, and TOML when a
 * grammar extension is installed. The pattern covers both, and claims no
 * other `.toml` file in the workspace.
 */
export const VERSION_CATALOG_SELECTOR: vscode.DocumentSelector = [
  { pattern: '**/*.versions.toml' },
];

export const CATALOG_LEGEND = new vscode.SemanticTokensLegend([...CATALOG_TOKEN_TYPES], []);

export class VersionCatalogSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(CATALOG_LEGEND);
    for (const t of scanVersionCatalog(document.getText()).tokens) {
      builder.push(t.line, t.start, t.length, CATALOG_TOKEN_TYPES.indexOf(t.type), 0);
    }
    return builder.build();
  }
}

export class VersionCatalogFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    return scanVersionCatalog(document.getText()).regions
      .map(r => new vscode.FoldingRange(r.start, r.end, vscode.FoldingRangeKind.Region));
  }
}
