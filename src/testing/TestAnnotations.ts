import type { SymbolEntry } from '../indexer/SymbolIndex';

// Path segments that identify test source sets
export const DEFAULT_TEST_SEGS = [
  'test/java/', 'test/kotlin/', 'androidTest/', 'jvmTest/', 'commonTest/',
  // AGP's unit-test source sets and the KMP targets: their classes got a
  // ▶ lens and then "test not found in index", since discovery skipped them.
  'androidUnitTest/', 'sharedTest/', 'iosTest/', 'jsTest/', 'nativeTest/', 'desktopTest/',
];

export function isTestFun(entry: SymbolEntry, _extraSegs: string[]): boolean {
  if (entry.kind !== 'fun' && entry.kind !== 'composable') return false;
  if (entry.isPrivate) return false;
  if (entry.isLifecycle) return false;    // @Before / @After / @BeforeEach etc. are setup, not tests
  return !!entry.isTest;
}
