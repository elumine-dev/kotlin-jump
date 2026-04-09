// Runs in a Node.js worker thread — no vscode API available here
import { parentPort } from 'worker_threads';
import { parse } from './KotlinParser';

type Job = { uriString: string; text: string };

parentPort!.on('message', (job: Job) => {
  try {
    parentPort!.postMessage(parse(job.uriString, job.text));
  } catch {
    parentPort!.postMessage({ uriString: job.uriString, packageName: '', imports: [], symbols: [] });
  }
});
