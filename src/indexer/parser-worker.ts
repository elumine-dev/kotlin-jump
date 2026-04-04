// Runs in a Node.js worker thread — no vscode API available here
import { parentPort } from 'worker_threads';
import * as path from 'path';
import { parse } from './KotlinParser';
import { initWasm, isWasmReady, parseWasm } from './WasmKotlinParser';

type Job = { uriString: string; text: string };

// Queue jobs that arrive before WASM initialization completes
const pending: Job[] = [];
let ready = false;

function dispatch(job: Job): void {
  if (isWasmReady()) {
    try {
      parentPort!.postMessage(parseWasm(job.uriString, job.text));
      return;
    } catch {
      // WASM threw on this file — fall through to regex fallback
    }
  }
  try {
    parentPort!.postMessage(parse(job.uriString, job.text));
  } catch {
    parentPort!.postMessage({ uriString: job.uriString, packageName: '', imports: [], symbols: [] });
  }
}

// __filename is the bundled dist/parser-worker.js path in CJS context
const distDir = path.dirname(__filename);
initWasm(distDir).finally(() => {
  ready = true;
  for (const job of pending.splice(0)) dispatch(job);
});

parentPort!.on('message', (job: Job) => {
  ready ? dispatch(job) : pending.push(job);
});
