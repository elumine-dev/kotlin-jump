import { describe, it, expect } from 'vitest';
import { findUnusedDtoFields } from '../../../src/providers/unusedDtoFields';

/**
 * Two verdicts `kdead remove --all` could not act on, on the reference project.
 *
 * A payment request: `private data class TokenizationParameters(val gateway:
 * String = "stripe", ...)`, built in its own file and handed to the
 * serializer. Nothing reads `gateway` because the wire does: it was reported
 * as "deserialized and never read", three fields in one file.
 *
 * And a removal withdrawn for nothing: `AdRendererDO()` counted as a
 * positional construction, although it passes no argument that could shift.
 */
const SEGS = ['test/java', 'test/kotlin'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const find = (sources: { path: string; text: string }[]) => findUnusedDtoFields({ sources, testSourceSets: SEGS });

const request = (decode = '') => ({
  path: `${MAIN}/PayRequestJson.kt`,
  text: [
    'package com.x', '',
    'fun payRequest(key: String): String =',
    '    Json.encodeToString(Params(publishableKey = key))',
    decode,
    '@Serializable',
    'private data class Params(',
    '    val gateway: String = "stripe",',
    '    val publishableKey: String,',
    ')', '',
  ].join('\n'),
});

describe('KJ044 a class the app builds and serializes', () => {
  it('is a producer: its fields are read by the wire, none is reported', () => {
    expect(find([request()])).toEqual([]);
  });

  it('is still judged when its file decodes: the same class comes back from the wire', () => {
    const src = request('fun parse(s: String) = Json.decodeFromString<Params>(s)');
    expect(find([src]).map(f => f.name)).toContain('gateway');
  });
});

describe('KJ044 a construction that passes nothing', () => {
  const dto = { path: `${MAIN}/RendererDO.kt`, text: 'package com.x\n\ndata class RendererDO(\n    var version: String = "",\n    var size: Int = 0,\n)\n' };
  const reader = { path: `${MAIN}/Use.kt`, text: 'package com.x\n\nfun go(r: RendererDO) = r.version\n' };

  it('`RendererDO()` leaves the removal offered', () => {
    const maker = { path: `${MAIN}/Make.kt`, text: 'package com.x\n\nfun make() = RendererDO()\n' };
    const [f] = find([dto, reader, maker]);
    expect(f?.name).toBe('size');
    expect(f.removeStart).toBeGreaterThanOrEqual(0);
  });

  it('`RendererDO("1", 2)` withdraws it: an argument would shift', () => {
    const maker = { path: `${MAIN}/Make.kt`, text: 'package com.x\n\nfun make() = RendererDO("1", 2).version\n' };
    const hit = find([dto, maker]).find(f => f.name === 'size');
    if (hit) expect(hit.removeStart).toBe(-1);
  });
});

describe('KJ044 a field Java reads through its accessor', () => {
  const dto = { path: `${MAIN}/CardDO.kt`, text: 'package com.x\n\ndata class CardDO(\n    val title: String,\n    val authorName: String,\n    val isShown: Boolean,\n    val width: Int,\n)\n' };
  const java = { path: '/w/app/src/main/java/com/x/Holder.java', text: 'package com.x;\n\nclass Holder {\n    String a(CardDO c) { return c.getTitle() + c.getAuthorName() + c.isShown(); }\n}\n' };

  it('`getAuthorName()` and `isShown()` keep their fields, `width` is still reported', () => {
    expect(find([dto, java]).map(f => f.name)).toEqual(['width']);
  });
});

describe('KJ044 a nested class built by position under its qualified name', () => {
  it('`Outer.LimitsDO(0, 0)` withdraws the removal', () => {
    const dto = { path: `${MAIN}/Outer.kt`, text: 'package com.x\n\nclass Outer {\n    data class LimitsDO(\n        val size: Long,\n        val count: Long,\n    )\n}\n\nfun read(l: Outer.LimitsDO) = l.size\n' };
    const test = { path: '/w/app/src/test/kotlin/com/x/T.kt', text: 'package com.x\n\nval l = Outer.LimitsDO(0, 0)\n' };
    const hit = find([dto, test]).find(f => f.name === 'count');
    expect(hit?.removeStart).toBe(-1);
  });
});
