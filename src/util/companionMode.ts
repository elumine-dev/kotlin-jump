/**
 * Pure companion mode resolution — no VS Code dependency.
 * Extracted so it can be unit-tested independently of extension activation.
 */

/**
 * Returns true when Kotlin Jump should run in companion mode,
 * i.e. disable providers that the full LSP already covers.
 *
 * @param mode             The `kotlinJump.companionMode` setting value
 * @param lspExtensionActive  Whether the JetBrains Kotlin LSP extension is installed and active
 */
/**
 * Ids the JetBrains Kotlin extension has shipped under: `kotlin-server` on the
 * Marketplace, `kotlin` for the GitHub VSIX. `kotlin-lsp`, the only id
 * checked before, never existed, so `auto` never detected it and every
 * provider was registered twice (doubled hovers, outline groups, hints).
 */
export const JETBRAINS_KOTLIN_EXTENSION_IDS = ['JetBrains.kotlin-server', 'JetBrains.kotlin', 'JetBrains.kotlin-lsp'] as const;

export function isJetBrainsKotlinInstalled(getExtension: (id: string) => unknown): boolean {
  return JETBRAINS_KOTLIN_EXTENSION_IDS.some(id => getExtension(id) !== undefined);
}

export function resolveCompanionMode(mode: string, lspExtensionActive: boolean): boolean {
  if (mode === 'always') return true;
  if (mode === 'never')  return false;
  // 'auto' (and any unknown/future value) — follow LSP presence
  return lspExtensionActive;
}
