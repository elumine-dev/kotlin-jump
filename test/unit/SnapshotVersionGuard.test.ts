/**
 * A snapshot on disk is only reparsed when a file's mtime or size moved.
 * So when the parser starts reading a construct differently, every unchanged
 * file keeps the OLD reading after the upgrade, silently, until the day it
 * happens to be edited. The only lever is SNAPSHOT_VERSION: a mismatch throws
 * the whole snapshot away and forces a full reindex.
 *
 * IndexStore already carries three comments for three past occurrences (Java
 * imports, isExpect/isActual/isPrimaryCtorParam, superQualifiers). A fourth
 * slipped through between v1.42.90 and v1.42.95: the receiver annotation made
 * six declarations appear in one real file, and the header rewrite removed 45
 * phantom supertypes, over 43 files of a 5088 file project, with no bump.
 *
 * This guard pins what actually reaches the disk. When it fails, the parser
 * output changed: bump SNAPSHOT_VERSION, then paste the new EMPREINTE.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { parseJava } from '../../src/indexer/JavaParser';
import { buildSnapshotFile } from '../../src/indexer/SnapshotFormat';
import { SNAPSHOT_VERSION } from '../../src/indexer/IndexStore';

const KOTLIN = `package com.example.guard

import com.example.other.Base
import com.example.other.*

typealias Handler = (Int) -> Unit

const val SEP: String = ")"

@Deprecated("gone")
sealed class Node(
    val label: String = ")",
    private val sep: String = SEP,
) : Base.Callback,
    Handler {

    companion object {
        const val TAG = "Node"
    }

    abstract suspend fun load(): Int

    override fun toString(): String = label
}

data class Leaf(val id: Int) : Node()

class Wrapped(
    private val cb: (Int) -> Unit,
) : Node() {
    private lateinit var late: String
    val listener = object : Base.Callback {
        override fun onDone() {}
    }

    fun outer() {
        val temp = 1
        fun inner() {}
    }
}

interface Api {
    suspend fun fetch(): Payload
}

fun @receiver:ColorInt Int.darken(ratio: Int): Int = ratio

inline fun <T> T.tapped(block: (T) -> Unit): T = this

infix operator fun Int.plus2(other: Int): Int = other

expect class Platform

actual class Desktop

@HiltViewModel
class HomeViewModel

@Composable
@Preview
fun Screen() {}

enum class Mode { FAST, SLOW }

object Registry

@RunWith(JUnit4::class)
class NodeTest {
    @Before fun setUp() {}

    @Test
    fun works() {}

    @Ignore
    @Test
    fun skipped() {}
}
`;

const JAVA = `package com.example.guard;

import com.example.other.Base;
import java.util.List;

public class JavaNode extends Base implements Runnable {
    private static final String TAG = "java";

    @Override
    public void run() {}
}
`;

function persiste(): string {
  const kt = parse('file:///guard/Guard.kt', KOTLIN);
  const java = parseJava('file:///guard/JavaNode.java', JAVA);
  return JSON.stringify([
    buildSnapshotFile(kt.symbols, kt.packageName, 'guard', 0, undefined, kt.imports),
    buildSnapshotFile(java.symbols, java.packageName, 'guard', 0, undefined, java.imports),
  ]);
}

// Recorded together on purpose: the pair only moves when a parser change that
// reaches the disk is paired with the bump that invalidates the old snapshots.
const EMPREINTE = {
  version: 26,
  persiste: String.raw`[{"t":0,"p":"com.example.guard","m":"guard","n":["Handler","SEP","Node","label","sep","Companion","TAG","load","toString","Leaf","id","Wrapped","cb","late","$anon$31","listener","onDone","outer","temp","inner","Api","fetch","darken","tapped","plus2","Platform","Desktop","HomeViewModel","Screen","Mode","FAST","SLOW","Registry","NodeTest","setUp","works","skipped"],"k":["typealias","val","sealedClass","val","val","object","val","fun","fun","dataClass","val","class","val","var","object","val","fun","fun","val","fun","interface","fun","fun","fun","fun","class","class","class","composable","enum","enum","enum","object","class","fun","fun","fun"],"l":[5,7,10,11,12,16,17,20,22,25,25,27,28,30,31,31,32,35,36,37,41,42,45,47,49,51,53,56,60,62,62,62,64,67,68,71,75],"c":[10,10,13,8,16,4,18,25,17,11,20,6,16,25,19,8,21,8,12,12,10,16,27,17,23,13,13,6,4,11,18,24,7,6,16,8,8],"i":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"d":[0,0,0,1,1,1,2,1,1,0,1,0,1,1,1,1,2,1,2,2,0,1,0,0,0,0,0,0,0,0,1,1,0,0,1,1,1],"at":{"0":"(Int) -> Unit"},"co":{"1":1,"6":1},"cv":{"1":"\")\"","6":"\"Node\""},"st":{"2":["Base","Callback","Handler"],"9":["Node"],"11":["Node"],"14":["Base","Callback"]},"sq":{"2":["Base"],"14":["Base"]},"de":{"2":1},"pc":{"3":1,"4":1,"10":1,"12":1},"pv":{"4":1,"12":1,"13":1},"cn":{"5":1},"su":{"7":1,"21":1},"ab":{"7":1},"or":{"8":1,"16":1},"li":{"13":1},"lo":{"18":1},"ex":{"22":1,"23":1,"24":1},"il":{"23":1},"ix":{"24":1},"io":{"24":1},"ep":{"25":1},"ac":{"26":1},"hv":{"27":1},"pr":{"28":1},"tc":{"33":1},"lc":{"34":1},"te":{"35":1,"36":1},"ig":{"36":1},"im":["com.example.other.Base","com.example.other.*"]},{"t":0,"p":"com.example.guard","m":"guard","n":["JavaNode","TAG","run"],"k":["class","val","fun"],"l":[5,6,9],"c":[13,32,16],"i":[0,0,0],"d":[0,1,1],"st":{"0":["Base","Runnable"]},"co":{"1":1},"pv":{"1":1},"or":{"2":1},"im":["com.example.other.Base","java.util.List"]}]`,
};

describe('SNAPSHOT_VERSION covers what the parser persists', () => {
  it('the persisted payload has not moved without a version bump', () => {
    expect({ version: SNAPSHOT_VERSION, persiste: persiste() }).toEqual(EMPREINTE);
  });
});
