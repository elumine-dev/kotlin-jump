import { Worker } from 'worker_threads';
import * as path from 'path';
import type { ParsedFile } from './KotlinParser';

interface Job {
  resolve: (file: ParsedFile) => void;
  reject:  (err: Error)       => void;
}

export class WorkerPool {
  private readonly workers:  Worker[]  = [];
  private readonly idle:     Worker[]  = [];
  private readonly jobQueue: Array<{ uriString: string; text: string } & Job> = [];
  private readonly pending   = new Map<Worker, Job>();
  readonly available: boolean;

  constructor(size: number) {
    try {
      // Inside the try: `__dirname` does not exist in the web extension
      // host, and the ReferenceError must hit the same inline-parsing
      // fallback as a missing worker file — not crash activate().
      const workerPath = path.join(__dirname, 'parser-worker.js');
      for (let i = 0; i < size; i++) {
        const w = new Worker(workerPath);
        w.on('message', (result: ParsedFile) => this.onMessage(w, result));
        w.on('error',   (err: Error)         => this.onError(w, err));
        this.workers.push(w);
        this.idle.push(w);
      }
      this.available = size > 0;
    } catch {
      // Worker file not found (e.g. not yet built) or no worker_threads
      // (web) — fall back to inline parsing
      this.available = false;
    }
  }

  // Send one file to the pool; resolves with ParsedFile when done
  run(uriString: string, text: string): Promise<ParsedFile> {
    return new Promise((resolve, reject) => {
      const worker = this.idle.pop();
      if (worker) {
        this.dispatch(worker, uriString, text, resolve, reject);
      } else {
        this.jobQueue.push({ uriString, text, resolve, reject });
      }
    });
  }

  async destroy(): Promise<void> {
    await Promise.all(this.workers.map(w => w.terminate()));
  }

  private dispatch(
    worker: Worker,
    uriString: string,
    text: string,
    resolve: Job['resolve'],
    reject: Job['reject'],
  ): void {
    this.pending.set(worker, { resolve, reject });
    worker.postMessage({ uriString, text });
  }

  private onMessage(worker: Worker, result: ParsedFile): void {
    const job = this.pending.get(worker);
    this.pending.delete(worker);
    job?.resolve(result);
    this.recycle(worker);
  }

  private onError(worker: Worker, err: Error): void {
    const job = this.pending.get(worker);
    this.pending.delete(worker);
    job?.reject(err);
    this.recycle(worker);
  }

  private recycle(worker: Worker): void {
    const next = this.jobQueue.shift();
    if (next) {
      const { uriString, text, resolve, reject } = next;
      this.dispatch(worker, uriString, text, resolve, reject);
    } else {
      this.idle.push(worker);
    }
  }
}
