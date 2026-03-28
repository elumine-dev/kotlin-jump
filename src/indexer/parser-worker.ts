// Runs in a Node.js worker thread — no vscode API available here
import { parentPort } from 'worker_threads';
import { parse } from './KotlinParser';

parentPort!.on('message', ({ uriString, text }: { uriString: string; text: string }) => {
  try {
    parentPort!.postMessage(parse(uriString, text));
  } catch {
    // Return an empty result so the pool doesn't deadlock
    parentPort!.postMessage({ uriString, packageName: '', imports: [], symbols: [] });
  }
});
