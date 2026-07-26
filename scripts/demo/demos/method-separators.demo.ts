import { Stage } from '../lib/stage';

/**
 * Demo: Method separators + SQL in @Query (KJ-011 + KJ-010). ~12 s.
 *
 * One beat, two payoffs from the same scroll: separator lines slice a
 * class into readable members, then a Room DAO shows SQL syntax
 * highlighting inside the @Query strings.
 *
 * WOW: SELECT / LEFT JOIN / GROUP BY colored inside a Kotlin string,
 * with :params in their own hue.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile(
    'src/main/kotlin/com/example/kj/g6editor/MethodSeparatorDemo.kt',
    { line: 12, column: 5 },
  );
  await stage.pause(1000);
  await stage.assertDecorations('filets separateurs', 'methodSeparators', 3);

  await stage.caption('Members, visually sliced apart', { duration: 2200 });
  await stage.dwellOn({ line: 18, column: 5 }, 1400);

  // Le DAO : SQL coloré dans les @Query.
  await stage.openFile(
    'src/main/kotlin/com/example/kj/g6editor/SqlQueryDao.kt',
    { line: 29, column: 9 },
  );
  await stage.pause(1600);

  void stage.calloutAt({ line: 21, column: 20 }, 'SQL, colored in place', 2200);
  await stage.caption('SQL, highlighted inside the @Query string', {
    duration: 2600,
  });
  await stage.pause(2200);
}
