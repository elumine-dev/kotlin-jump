import * as vscode from 'vscode';
import { androidApi, AndroidApi, AndroidApiIndex } from '../util/androidApi';

/** The bundled index, built by scripts/build-android-api-index.ts. */
export const ANDROID_API_FILE = 'android-api-36.json';

/**
 * G61: loads the bundled platform index once, on first use, the way
 * `BundledStdlibProvider` reads its own asset: `vscode.workspace.fs`, so the
 * web build reads it too.
 *
 * Lazy because only a dead-code scan needs it: 1.2 MB of JSON has no business
 * in activation. A failed load is logged and answers undefined, which keeps
 * the detectors' cautious behaviour rather than failing the scan.
 */
export function androidApiLoader(
  extensionUri: vscode.Uri,
  warn: (message: string) => void,
): () => Promise<AndroidApi | undefined> {
  let pending: Promise<AndroidApi | undefined> | undefined;
  return () => pending ??= (async () => {
    const uri = vscode.Uri.joinPath(extensionUri, 'bundled', ANDROID_API_FILE);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return androidApi(JSON.parse(new TextDecoder().decode(bytes)) as AndroidApiIndex);
    } catch (err) {
      warn(`[android-api] failed to load ${uri.toString()}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  })();
}
