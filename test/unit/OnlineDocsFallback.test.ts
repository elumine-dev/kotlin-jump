import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  onlineDocsUrl, onlineDocsLocation, docsUri, parseDocsUri, OnlineDocsContentProvider, ONLINE_DOCS_SCHEME,
} from '../../src/providers/OnlineDocsFallback';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const originalGetConfiguration = vscode.workspace.getConfiguration;
function withSetting(enabled: boolean): void {
  (vscode.workspace as any).getConfiguration = () => ({
    get: (key: string, def: unknown) => key === 'fallbackToOnlineDocs' ? enabled : def,
    update: async () => {},
  });
}
afterEach(() => { (vscode.workspace as any).getConfiguration = originalGetConfiguration; });

describe('onlineDocsUrl', () => {
  it('maps stdlib types and functions to dokka slugs', () => {
    expect(onlineDocsUrl('kotlin.collections.HashMap')).toBe('https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.collections/-hash-map/');
    expect(onlineDocsUrl('kotlin.collections.listOf')).toBe('https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.collections/list-of/');
    expect(onlineDocsUrl('kotlin.String')).toBe('https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/-string/');
  });

  it('routes kotlinx libraries to their own dokka site, not the stdlib one', () => {
    expect(onlineDocsUrl('kotlinx.coroutines.flow.StateFlow'))
      .toBe('https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/-state-flow/');
    expect(onlineDocsUrl('kotlinx.serialization.Serializable'))
      .toBe('https://kotlinlang.org/api/kotlinx.serialization/kotlinx-serialization-core/kotlinx.serialization/-serializable/');
  });

  it('does not treat `kotlinx.foo` or `kotlinstuff` as `kotlin.*`', () => {
    expect(onlineDocsUrl('kotlinstuff.Foo')).toBeUndefined();
    expect(onlineDocsUrl('kotlinx.unknownlib.Foo')).toBeUndefined();
  });

  it('maps JDK classes to the modular javadoc, picking the module from the package', () => {
    expect(onlineDocsUrl('java.util.List')).toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/List.html');
    expect(onlineDocsUrl('java.sql.Connection')).toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Connection.html');
    expect(onlineDocsUrl('javax.swing.JFrame')).toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.desktop/javax/swing/JFrame.html');
    expect(onlineDocsUrl('java.util.concurrent.ConcurrentHashMap'))
      .toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/ConcurrentHashMap.html');
  });

  it('turns a Java static import into the class page plus an anchor', () => {
    expect(onlineDocsUrl('java.util.Collections.emptyList'))
      .toBe('https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Collections.html#emptyList');
  });

  it('refuses a lowercase Java name with no enclosing class to anchor to', () => {
    expect(onlineDocsUrl('java.util.list')).toBeUndefined();
  });

  it('maps android and androidx, types to a page and functions to the package summary', () => {
    expect(onlineDocsUrl('androidx.compose.runtime.Composable'))
      .toBe('https://developer.android.com/reference/kotlin/androidx/compose/runtime/Composable');
    expect(onlineDocsUrl('androidx.compose.runtime.remember'))
      .toBe('https://developer.android.com/reference/kotlin/androidx/compose/runtime/package-summary#remember');
    expect(onlineDocsUrl('android.content.Context'))
      .toBe('https://developer.android.com/reference/kotlin/android/content/Context');
    expect(onlineDocsUrl('com.google.android.material.snackbar.Snackbar'))
      .toBe('https://developer.android.com/reference/kotlin/com/google/android/material/snackbar/Snackbar');
  });

  it('returns undefined for packages without a known host and for bare names', () => {
    expect(onlineDocsUrl('com.squareup.okhttp3.OkHttpClient')).toBeUndefined();
    expect(onlineDocsUrl('Foo')).toBeUndefined();
    expect(onlineDocsUrl('com.example.')).toBeUndefined();
  });
});

describe('docsUri / parseDocsUri', () => {
  it('round-trips the fqn and url, with the fqn as the tab title segment', () => {
    const url = 'https://developer.android.com/reference/kotlin/androidx/compose/runtime/Composable';
    const uri = docsUri('androidx.compose.runtime.Composable', url);
    expect(uri.scheme).toBe(ONLINE_DOCS_SCHEME);
    expect(uri.path).toBe('/androidx.compose.runtime.Composable');
    const parsed = parseDocsUri({ path: uri.path, query: `url=${encodeURIComponent(url)}` });
    expect(parsed).toEqual({ fqn: 'androidx.compose.runtime.Composable', url });
  });

  it('rejects a non-https url smuggled into the query', () => {
    expect(parseDocsUri({ path: '/a.B', query: `url=${encodeURIComponent('javascript:alert(1)')}` })).toBeUndefined();
    expect(parseDocsUri({ path: '/a.B', query: 'url=%E0%A4%A' })).toBeUndefined();
    expect(parseDocsUri({ path: '/', query: 'url=https%3A%2F%2Fx' })).toBeUndefined();
  });
});

describe('OnlineDocsContentProvider', () => {
  it('renders the page without opening anything (VS Code resolves it for the Cmd+hover preview too), and opens the browser once the tab is shown', () => {
    const opened: string[] = [];
    const provider = new OnlineDocsContentProvider(async url => { opened.push(url); return true; });
    const url = 'https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.collections/-list/';
    const uri = { scheme: ONLINE_DOCS_SCHEME, path: '/kotlin.collections.List', query: `url=${encodeURIComponent(url)}` } as any;
    const text = provider.provideTextDocumentContent(uri);
    expect(opened).toEqual([]);
    expect(text).toContain('kotlin.collections.List');
    expect(text).toContain(url);
    provider.onActiveEditor({ document: { uri } } as any);
    expect(opened).toEqual([url]);
    provider.onActiveEditor({ document: { uri: { scheme: 'file', path: '/a.kt', query: '' } } } as any);
    expect(opened).toEqual([url]);
    provider.dispose();
  });

  it('does not open anything for a malformed link', () => {
    const opened: string[] = [];
    const provider = new OnlineDocsContentProvider(async url => { opened.push(url); return true; });
    provider.provideTextDocumentContent({ path: '/x', query: '' } as any);
    provider.onActiveEditor({ document: { uri: { scheme: ONLINE_DOCS_SCHEME, path: '/x', query: '' } } } as any);
    expect(opened).toEqual([]);
    provider.dispose();
  });
});

// ImportResolver caches per (uri, version), so each document variant below
// gets its own uri.
describe('onlineDocsLocation', () => {
  const DOC = `package com.example.ui

import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.*
import com.example.data.Repo

@Composable
fun Screen(flow: StateFlow<Int>, repo: Repo, list: List<Int>) {}
`;

  it('is a no-op while the setting is off (the default)', () => {
    withSetting(false);
    expect(onlineDocsLocation('Composable', mockDocument('file:///Screen.kt', DOC))).toBeNull();
  });

  it('follows an exact import', () => {
    withSetting(true);
    const loc = onlineDocsLocation('Composable', mockDocument('file:///Screen.kt', DOC));
    expect(loc?.uri.scheme).toBe(ONLINE_DOCS_SCHEME);
    expect(loc?.uri.toString()).toContain('androidx.compose.runtime.Composable');
  });

  it('follows a wildcard import the file declares', () => {
    withSetting(true);
    const loc = onlineDocsLocation('StateFlow', mockDocument('file:///Screen.kt', DOC));
    expect(loc?.uri.toString()).toContain(encodeURIComponent('kotlinx.coroutines.flow/-state-flow'));
  });

  it('ignores Kotlin default imports: `List` with no explicit import opens nothing rather than a guess', () => {
    withSetting(true);
    const noWildcard = mockDocument('file:///ScreenNoWildcard.kt', DOC.replace('import kotlinx.coroutines.flow.*\n', ''));
    expect(onlineDocsLocation('List', noWildcard)).toBeNull();
  });

  it('opens nothing for an explicit import into a package without a docs host, even with a wildcard around', () => {
    withSetting(true);
    expect(onlineDocsLocation('Repo', mockDocument('file:///Screen.kt', DOC))).toBeNull();
  });

  it('refuses to guess between two wildcard imports', () => {
    withSetting(true);
    const twoWildcards = mockDocument('file:///ScreenTwoWildcards.kt', DOC.replace('import com.example.data.Repo', 'import okhttp3.*'));
    expect(onlineDocsLocation('StateFlow', twoWildcards)).toBeNull();
    expect(onlineDocsLocation('OkHttpClient', twoWildcards)).toBeNull();
  });
});

describe('KotlinDefinitionProvider + fallbackToOnlineDocs', () => {
  const DOC = `package com.example.ui

import androidx.compose.runtime.Composable
import com.example.data.Pokemon

@Composable
fun PokemonCard(pokemon: Pokemon) {}
`;

  function provider(): KotlinDefinitionProvider {
    const index = new SymbolIndex();
    index.add(parse('file:///Pokemon.kt', 'package com.example.data\nclass Pokemon'));
    return new KotlinDefinitionProvider(index);
  }

  it('still returns null for an unresolved symbol when the setting is off', () => {
    withSetting(false);
    const doc = mockDocument('file:///PokemonCard.kt', DOC);
    expect(provider().provideDefinition(doc, positionOf(DOC, 'Composable', 2))).toBeNull();
  });

  it('returns the docs location for an unresolved, explicitly imported symbol when on', () => {
    withSetting(true);
    const doc = mockDocument('file:///PokemonCard.kt', DOC);
    const result = provider().provideDefinition(doc, positionOf(DOC, 'Composable', 2)) as vscode.Location;
    expect(result?.uri.scheme).toBe(ONLINE_DOCS_SCHEME);
  });

  it('never shadows a real workspace hit', () => {
    withSetting(true);
    const doc = mockDocument('file:///PokemonCard.kt', DOC);
    const result = provider().provideDefinition(doc, positionOf(DOC, 'Pokemon)')) as vscode.Location;
    expect(result?.uri.toString()).toBe('file:///Pokemon.kt');
  });
});
