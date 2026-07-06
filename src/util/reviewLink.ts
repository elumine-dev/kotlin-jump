import * as vscode from 'vscode';

const MARKETPLACE_REVIEW_URL =
  'https://marketplace.visualstudio.com/items?itemName=elumine.kotlin-jump&ssr=false#review-details';
const OPEN_VSX_REVIEW_URL = 'https://open-vsx.org/extension/elumine/kotlin-jump/reviews';

const VSCODE_URI_SCHEMES = new Set(['vscode', 'vscode-insiders']);

/**
 * Open VSX serves Cursor, Windsurf, VSCodium, and most other forks — the
 * large majority of installs. An exact allowlist (not `startsWith('vscode')`)
 * is required here: VSCodium's own uriScheme is "vscodium", which contains
 * "vscode" as a prefix and would otherwise be misrouted to the Marketplace
 * it can't actually use.
 */
export function getReviewUrl(): string {
  return VSCODE_URI_SCHEMES.has(vscode.env.uriScheme) ? MARKETPLACE_REVIEW_URL : OPEN_VSX_REVIEW_URL;
}
