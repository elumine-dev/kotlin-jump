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
export function resolveCompanionMode(mode: string, lspExtensionActive: boolean): boolean {
  if (mode === 'always') return true;
  if (mode === 'never')  return false;
  // 'auto' (and any unknown/future value) — follow LSP presence
  return lspExtensionActive;
}
