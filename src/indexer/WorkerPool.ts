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
  private vivants = 0;

  /** Vrai tant qu'au moins un worker repond. */
  get available(): boolean { return this.vivants > 0; }

  constructor(size: number) {
    try {
      // `__dirname` does not exist in the web extension host. Checked
      // explicitly (rather than left to throw as an implicit
      // ReferenceError) so this fallback reads as an intentional
      // environment check, not an accident. It must land in the same
      // inline-parsing fallback as a missing worker file, not crash
      // activate(). Doubly protected either way: even if this check were
      // removed, `new Worker(...)` below would still throw via the browser
      // build's worker_threads stub (src/browser/worker-threads-stub.ts).
      if (typeof __dirname === 'undefined') {
        throw new Error('worker_threads unavailable (web extension host)');
      }
      const workerPath = path.join(__dirname, 'parser-worker.js');
      for (let i = 0; i < size; i++) {
        const w = new Worker(workerPath);
        w.on('message', (result: ParsedFile) => this.onMessage(w, result));
        // `new Worker` ne lève PAS pour un fichier absent : Node signale
        // l'échec plus tard, par `error` (MODULE_NOT_FOUND) puis `exit`. Le
        // try/catch autour de cette boucle ne pouvait donc pas jouer le repli
        // qu'il annonce, et un worker mort remis dans le vivier recevait des
        // `postMessage` que Node accepte sans rien renvoyer : chaque parse
        // restait en suspens pour toujours.
        w.on('error', (err: Error)   => this.onDead(w, err));
        w.on('exit',  (code: number) => this.onDead(w, new Error(`parser worker exited with code ${code}`)));
        this.workers.push(w);
        this.idle.push(w);
        this.vivants++;
      }
    } catch {
      // Pas de worker_threads (hôte web) : repli sur le parse en ligne.
    }
  }

  // Send one file to the pool; resolves with ParsedFile when done
  run(uriString: string, text: string): Promise<ParsedFile> {
    if (this.vivants === 0) return Promise.reject(new Error('no live parser worker'));
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

  /**
   * Un worker qui meurt sort du vivier au lieu d'y retourner. Quand le dernier
   * s'en va, tout ce qui attendait est rejeté : le rejet fait basculer
   * l'appelant sur le parse en ligne, alors que l'attente ne finissait jamais.
   */
  private onDead(worker: Worker, err: Error): void {
    const job = this.pending.get(worker);
    this.pending.delete(worker);
    job?.reject(err);

    const i = this.idle.indexOf(worker);
    if (i !== -1) this.idle.splice(i, 1);
    const j = this.workers.indexOf(worker);
    if (j === -1) return;                 // déjà retiré : `error` puis `exit`
    this.workers.splice(j, 1);
    this.vivants--;
    if (this.vivants > 0) return;

    const restants = this.jobQueue.splice(0);
    for (const attente of restants) attente.reject(err);
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
