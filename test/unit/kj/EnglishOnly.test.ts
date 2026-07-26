import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT, DEMO_ROOT } from './harness';

/**
 * Everything an extension user or contributor can read must be in English.
 *
 * Kotlin Jump ships on the Marketplace to an English-speaking audience.
 * That covers three surfaces that are easy to forget:
 *   1. demo captions and callouts (burned into the published GIFs);
 *   2. code comments in the shipped sources;
 *   3. comments in the demo fixtures, because the recorder films them.
 *
 * French stays fine for what never leaves Kevin's machine: `doc/`, work
 * journals, this project's internal notes.
 */

/** Words frequent enough in French, rare enough in English, to be a signal. */
const FRENCH_MARKERS =
  /\b(le|la|les|une|des|dans|pour|sans|qui|que|est|sont|avec|sur|par|cette|donc|mais|puis|aucun|chaque|jamais|ligne|fichier|cadre|colonne|utilisé|attendu|grisé|mort)\b/i;

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function walk(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, ext));
    else if (ext.test(entry)) out.push(full);
  }
  return out;
}

/** Sources shipped in the VSIX (KJ wave). Legacy files predate the rule. */
const SHIPPED = [
  'src/providers/PostfixCompletionProvider.ts',
  'src/providers/NamedArgumentsActionProvider.ts',
  'src/providers/SurroundWithProvider.ts',
  'src/providers/ExtractStringResourceProvider.ts',
  'src/providers/UnusedImportProvider.ts',
  'src/providers/MethodSeparatorProvider.ts',
  'src/providers/StateProvenanceProvider.ts',
  'src/providers/ComposeOutlineProvider.ts',
  'src/providers/LifecyclePairingProvider.ts',
  'src/providers/DispatcherLensProvider.ts',
  'src/providers/ResourceShadowingProvider.ts',
  'src/providers/StringXmlHoverProvider.ts',
  'src/providers/ResourceUsageBadgeProvider.ts',
  'src/providers/DependencyUsageBadgeProvider.ts',
  'src/providers/ManifestNecessityProvider.ts',
  'src/providers/HardcodedStringProvider.ts',
  'src/providers/RoomMigrationProvider.ts',
  'src/providers/DeadWeightActionProvider.ts',
  'src/indexer/NavigationIndex.ts',
  'src/indexer/RoomSchemaIndex.ts',
  'src/indexer/ResourcePriorityResolver.ts',
  'src/ui/AndroidProjectViewProvider.ts',
  'src/ui/ScreenFlowPanel.ts',
  'src/commands/recentLocations.ts',
  'src/commands/smartJoinLines.ts',
  'src/util/demoProbe.ts',
];

describe('English only: shipped sources', () => {
  it('no French comment in the KJ providers and indexers', () => {
    const offenders: string[] = [];
    for (const rel of SHIPPED) {
      const lines = readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (isComment(line) && FRENCH_MARKERS.test(line)) {
          offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 56)}`);
        }
      });
    }
    expect(offenders, 'contributors read these files').toEqual([]);
  });
});

describe('English only: demo fixtures (filmed in the GIFs)', () => {
  const fixtures = walk(
    path.join(DEMO_ROOT, 'src/main/kotlin/com/example/kj'),
    /\.kt$/,
  );

  it('no French comment in the recorded fixtures', () => {
    const offenders: string[] = [];
    for (const file of fixtures) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (isComment(line) && FRENCH_MARKERS.test(line)) {
          offenders.push(`${path.basename(file)}:${i + 1} ${line.trim().slice(0, 56)}`);
        }
      });
    }
    expect(offenders, 'these comments are on screen in the published GIFs').toEqual([]);
  });

  it('no fixture line overflows the recording frame', () => {
    // The frame shows about 88 columns. A longer line is cut off on screen,
    // so a teaching comment nobody can read is worse than no comment.
    const offenders: string[] = [];
    for (const file of fixtures) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.trimEnd().length > 88) {
            offenders.push(`${path.basename(file)}:${i + 1} (${line.trimEnd().length} cols)`);
          }
        });
    }
    expect(offenders, 'line cut off in the recorded frame').toEqual([]);
  });
});

describe('English only: demo captions and callouts', () => {
  it('no French in the text burned into the GIFs', () => {
    const dir = path.join(REPO_ROOT, 'scripts', 'demo', 'demos');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter(n => n.endsWith('.demo.ts'))) {
      readFileSync(path.join(dir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/stage\.(caption|calloutAt)\(/.test(line)) return;
          // Only look at the quoted label, not the surrounding code.
          const quoted = /'((?:[^'\\]|\\.)*)'/.exec(line)?.[1] ?? '';
          if (FRENCH_MARKERS.test(quoted)) {
            offenders.push(`${f}:${i + 1} ${quoted.slice(0, 48)}`);
          }
        });
    }
    expect(offenders, 'viewers of the published GIFs read this').toEqual([]);
  });
});
