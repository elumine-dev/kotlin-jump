/**
 * Ceiling shared by every feature that answers a question by walking the whole
 * project: the dependency usage badge, the manifest necessity badges, and the
 * "Remove unused …" quick fixes behind both.
 *
 * It used to be 4000 in each of them, set independently. A real Android project
 * measured here holds 5088 Kotlin and Java sources, 6278 once resource XML is
 * counted, so all three sweeps stopped short on every run. Each one has a
 * truncation guard, and each guard therefore fired permanently: the manifest
 * badges collapsed to a single "may come from a library" label on all 56
 * permissions, and the quick fixes disappeared entirely.
 *
 * Every one of those features answers an ABSENCE (no import, no class, no
 * usage), and a listing that stopped early cannot prove one. So the number has
 * to clear a real project by a wide margin, and the guards stay for what lies
 * beyond it.
 */
export const MAX_SWEEP_FILES = 20_000;
