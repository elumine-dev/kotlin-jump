import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';

function symbols(code: string) {
  return parse('file:///test.kt', code).symbols;
}
function find(code: string, name: string) {
  return symbols(code).find(s => s.name === name);
}

// ── Composable functions with various annotations ───────────────────────────

describe('Composable function detection', () => {
  it('@Composable internal fun', () => {
    expect(find('@Composable\ninternal fun EmptyScreen() {}', 'EmptyScreen')?.kind).toBe('composable');
  });

  it('@Composable private fun', () => {
    expect(find('@Composable\nprivate fun ItemList() {}', 'ItemList')?.kind).toBe('composable');
  });

  it('3 annotations before @Composable fun', () => {
    const code = `@OptIn(ExperimentalApi::class)
@Suppress("MagicNumber")
@Composable
private fun ProductList() {}`;
    expect(find(code, 'ProductList')?.kind).toBe('composable');
  });

  it('bare @Composable fun', () => {
    expect(find('@Composable\nfun HomeScreen() {}', 'HomeScreen')?.kind).toBe('composable');
  });

  it('@Composable as LAST of 4 annotations — still composable', () => {
    const code = `@Preview(showBackground = true)
@Preview(uiMode = 1)
@OptIn(ExperimentalApi::class)
@Composable
fun PreviewScreen() {}`;
    expect(find(code, 'PreviewScreen')?.kind).toBe('composable');
  });

  it('@Composable as FIRST of 4 annotations — evicted from window (known limitation)', () => {
    const code = `@Composable
@Preview(showBackground = true)
@Preview(uiMode = 1)
@OptIn(ExperimentalApi::class)
fun PreviewScreen() {}`;
    const sym = find(code, 'PreviewScreen');
    expect(sym).toBeDefined();
    expect(sym?.kind).toBe('fun');
  });
});

// ── val with by delegation (Compose patterns) ──────────────────────────────

describe('val/var with by delegation', () => {
  it('val by animateFloat', () => {
    const code = `fun render() {
    val scale by transition.animateFloat(label = "s") { 1f }
}`;
    expect(find(code, 'scale')?.kind).toBe('val');
  });

  it('val by animateDp', () => {
    const code = `fun render() {
    val padding by transition.animateDp(label = "p") { 0.dp }
}`;
    expect(find(code, 'padding')?.kind).toBe('val');
  });

  it('var by remember', () => {
    const code = `fun render() {
    var rotation by remember { mutableFloatStateOf(0f) }
}`;
    const sym = find(code, 'rotation');
    expect(sym).toBeDefined();
    expect(sym?.kind).toBe('var');
  });

  it('val by remember + derivedStateOf', () => {
    const code = `fun render() {
    val height by remember(screenHeight) {
        derivedStateOf { 100 }
    }
}`;
    expect(find(code, 'height')).toBeDefined();
  });
});

// ── Function parameters (known limitation) ──────────────────────────────────

describe('Function parameters — known limitation', () => {
  it('function params are NOT indexed', () => {
    const code = `fun render(title: String, onClick: () -> Unit) {}`;
    expect(find(code, 'title')).toBeUndefined();
    expect(find(code, 'onClick')).toBeUndefined();
  });

  it('lambda params are NOT indexed', () => {
    const code = `fun render(onDelete: (String) -> Unit, onResume: () -> Unit) {}`;
    expect(find(code, 'onDelete')).toBeUndefined();
    expect(find(code, 'onResume')).toBeUndefined();
  });
});

// ── Constructor val params (known limitation) ───────────────────────────────

describe('Constructor val params — known limitation', () => {
  it('data class constructor val params are NOT indexed', () => {
    const code = `data class Dimensions(
    val width: Int = 0,
    val height: Int = 0,
)`;
    expect(find(code, 'width')).toBeUndefined();
    expect(find(code, 'height')).toBeUndefined();
  });

  it('data class itself IS indexed', () => {
    const code = `data class Dimensions(val width: Int)`;
    expect(find(code, 'Dimensions')?.kind).toBe('dataClass');
  });
});

// ── Computed property with get() ────────────────────────────────────────────

describe('Computed property', () => {
  it('val with get() = ... is indexed', () => {
    const code = `class Config {
    val ratio: Float
        get() = if (width > 0) height / width else 1f
}`;
    expect(find(code, 'ratio')?.kind).toBe('val');
  });
});

// ── val with = inside with() { block ────────────────────────────────────────

describe('val with block expression', () => {
  it('val = with(context) { ... } — brace on same line', () => {
    const code = `fun render() {
    val screenWidth = with(density) {
        containerSize.width.toDp()
    }
}`;
    expect(find(code, 'screenWidth')).toBeDefined();
  });
});

// ── const val with various modifiers ────────────────────────────────────────

describe('const val modifiers', () => {
  it('internal const val', () => {
    expect(find('internal const val DURATION_MS = 400', 'DURATION_MS')?.kind).toBe('val');
  });

  it('private const val', () => {
    expect(find('private const val THRESHOLD = 120f', 'THRESHOLD')?.kind).toBe('val');
  });

  it('bare const val', () => {
    expect(find('const val RATIO_W = .55f', 'RATIO_W')?.kind).toBe('val');
  });
});
