export class Worker {
  constructor(_path: string) { throw new Error('worker_threads not supported in browser'); }
  on(_event: string, _listener: unknown): this { return this; }
  postMessage(_data: unknown): void {}
  terminate(): Promise<void> { return Promise.resolve(); }
}
