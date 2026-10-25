/**
 * What a cut can say for itself to a reviewer.
 *
 * `Coupe` used to keep only where to cut and what family asked for it. The
 * detector's verdict, its test mentions, the channel it reasoned through and
 * the declaration a cascade cut follows were all dropped on the way in. A
 * reviewer who asked "are you sure?" never got an answer the tool could have
 * given. This record travels with the cut so the cleanup plan can print it.
 *
 * Optional everywhere: a `Coupe` without a `preuve` is still a valid cut, and
 * every consumer of cuts keeps working without reading this.
 */
export type Verdict =
  /** No reference outside its own declaration, main and tests included. */
  | 'unreferenced'
  /** Referenced by tests only; Remove All never cuts these. */
  | 'test-only'
  /** Dead because of another cut: an import, an injection line, an argument. */
  | 'cascade'
  /** A container emptied by other cuts: an enum left with no entry. */
  | 'emptied'
  /** A baseline entry whose file no longer exists. */
  | 'stale'
  /** Assigned and never read. */
  | 'write-only'
  /** Posted and never listened to. */
  | 'unheard'
  /** Member of a group of declarations that reference only each other. */
  | 'island';

export interface Preuve {
  verdict: Verdict;
  /** Mentions the detector counted, when it counts them. */
  mentions?: { tests: number };
  /** How the symbol detector set the bag's count aside (KJ-064, KJ-067). */
  via?: 'visibility' | 'injection';
  /** Island names whose extents hold this member's only mentions. */
  gardePar?: string[];
  /** Other files this cut takes lines from: stale imports, injection sites. */
  emporte?: { path: string; line: number }[];
  /** The declaration a cascade cut follows. */
  suit?: string;
  /** Declarations of the same key, one per build variant. */
  variantes?: number;
  /** Another top-level declaration of the same name exists in the workspace. */
  homonyme?: boolean;
  /** The detector's own name for the finding, when the cut's `quoi` is left empty. */
  nom?: string;
}
