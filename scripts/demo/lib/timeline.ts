import * as fs from 'node:fs';

export type EventType = 'keystroke' | 'click' | 'caption';

export interface TimelineEvent {
  /** Milliseconds since recording start */
  t:        number;
  type:     EventType;
  label:    string;
  /** Optional secondary description (e.g., "Navigate Back" under a keystroke) */
  sublabel?: string;
  /** Duration the overlay stays visible (ms) */
  duration: number;
}

export class Timeline {
  private readonly events: TimelineEvent[] = [];
  private readonly startMs: number = Date.now();

  push(event: Omit<TimelineEvent, 't'>): void {
    this.events.push({ ...event, t: Date.now() - this.startMs });
  }

  all(): readonly TimelineEvent[] {
    return this.events;
  }

  /** Total elapsed ms since start */
  elapsed(): number {
    return Date.now() - this.startMs;
  }

  /** Persist to JSON for debugging or reproducibility checks */
  writeJson(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.events, null, 2));
  }
}
