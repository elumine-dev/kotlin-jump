import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_REPOSITORIES, blankGradleComments, readRepositories } from '../../../src/upgrades/repositories';

/**
 * KJ-082, repositories: which Maven repositories a build declares, read from
 * its settings and build files.
 *
 * Guessing a repository from the group prefix (androidx goes to Google, the
 * rest to Central) misses JitPack, the JetBrains Compose dev repository and
 * any private Nexus, and would send a request to a host the build never
 * named. The reader walks `pluginManagement`, `dependencyResolutionManagement`,
 * `buildscript`, `allprojects`, `subprojects` and the top level `repositories`
 * blocks, in both DSLs, and keeps the declaration order. A `maven { }` block
 * with `credentials` is kept but marked private so it is never contacted; a
 * URL with `$` or without https is dropped. Nothing declared means Gradle's
 * own defaults for plugins (portal, Central, Google) and for the project
 * (Central, Google).
 */

const settings = (text: string) => [{ path: '/w/settings.gradle.kts', text, kind: 'settings' as const }];
const build = (text: string, file = '/w/build.gradle.kts') => [{ path: file, text, kind: 'build' as const }];
const kinds = (refs: readonly { kind: string }[]) => refs.map(r => r.kind);
const urls = (refs: readonly { url: string }[]) => refs.map(r => r.url);

describe('readRepositories, Kotlin DSL', () => {
  const text = `
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
        maven("https://a.example.com/m2/")
    }
}
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        maven(url = "https://b.example.com/m2")
        maven { url = uri("https://c.example.com/m2") }
        maven {
            url = "https://d.example.com/"
            content { includeGroup("com.example.kiosk") }
        }
    }
}
rootProject.name = "kiosk"
`;
  const repos = readRepositories(settings(text));

  it('reads pluginManagement into the plugin repositories, in declaration order, trailing slash removed', () => {
    expect(kinds(repos.plugins)).toEqual(['gradlePluginPortal', 'mavenCentral', 'google', 'custom']);
    expect(repos.plugins[3].url).toBe('https://a.example.com/m2');
  });

  it('reads dependencyResolutionManagement into the project repositories, every maven form included', () => {
    expect(kinds(repos.project)).toEqual(['mavenCentral', 'custom', 'custom', 'custom']);
    expect(urls(repos.project).slice(1)).toEqual(['https://b.example.com/m2', 'https://c.example.com/m2', 'https://d.example.com']);
  });

  it('gives the well known repositories their fixed URLs', () => {
    expect(repos.plugins[0].url).toBe('https://plugins.gradle.org/m2');
    expect(repos.plugins[1].url).toBe('https://repo1.maven.org/maven2');
    expect(repos.plugins[2].url).toBe('https://dl.google.com/dl/android/maven2');
  });
});

describe('readRepositories, Groovy DSL', () => {
  const text = `
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies { classpath 'com.android.tools.build:gradle:8.2.0' }
}
allprojects {
    repositories {
        maven { url 'https://jitpack.io' }
        maven { url "https://e.example.com/m2" }
        maven { setUrl("https://f.example.com") }
    }
}
`;
  const repos = readRepositories(build(text, '/w/build.gradle'));

  it('reads buildscript repositories as plugin repositories', () => {
    expect(kinds(repos.plugins)).toEqual(['google', 'mavenCentral']);
  });

  it('reads allprojects repositories as project repositories, single quoted URLs included', () => {
    // `'https://jitpack.io'` holds `//`: a comment stripper that knows only
    // double quotes would blank the rest of the line and lose the URL.
    expect(urls(repos.project)).toEqual(['https://jitpack.io', 'https://e.example.com/m2', 'https://f.example.com']);
  });
});

describe('readRepositories, what is kept out and what is marked', () => {
  it('marks a maven block with credentials as private, and keeps its URL', () => {
    const repos = readRepositories(settings(`
dependencyResolutionManagement {
    repositories {
        maven {
            url = uri("https://nexus.example.com/repository/maven-public")
            credentials { username = "u"; password = "p" }
        }
        mavenCentral()
    }
}`));
    expect(repos.project[0]).toEqual({ kind: 'custom', url: 'https://nexus.example.com/repository/maven-public', private: true });
    expect(repos.project[1].private).toBeUndefined();
  });

  it('drops a templated URL, a plain http URL, mavenLocal, jcenter and flatDir', () => {
    const repos = readRepositories(settings(`
dependencyResolutionManagement {
    repositories {
        maven("https://\${host}/m2")
        maven("http://insecure.example.com/m2")
        mavenLocal()
        jcenter()
        flatDir { dirs("libs") }
        google()
    }
}`));
    expect(kinds(repos.project)).toEqual(['google']);
  });

  it('ignores a commented out repository and a URL inside a comment', () => {
    const repos = readRepositories(settings(`
dependencyResolutionManagement {
    repositories {
        // mavenCentral()
        /* maven("https://old.example.com/m2") */
        google() // was maven("https://older.example.com")
    }
}`));
    expect(urls(repos.project)).toEqual(['https://dl.google.com/dl/android/maven2']);
  });

  it('deduplicates by URL and keeps the first position', () => {
    const repos = readRepositories(settings(`
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
        mavenCentral()
    }
}`));
    expect(kinds(repos.project)).toEqual(['mavenCentral', 'google']);
  });

  it('ignores a pluginManagement block in a build file and a publishing block anywhere', () => {
    const repos = readRepositories(build(`
pluginManagement { repositories { mavenCentral() } }
publishing { repositories { maven { url = uri("https://publish.example.com/m2") } } }
repositories { google() }
`));
    expect(repos.plugins).toEqual(DEFAULT_REPOSITORIES.plugins);
    expect(kinds(repos.project)).toEqual(['google']);
  });

  it('falls back to Gradle defaults for a set nothing declares', () => {
    expect(readRepositories([])).toEqual(DEFAULT_REPOSITORIES);
    expect(kinds(DEFAULT_REPOSITORIES.plugins)).toEqual(['gradlePluginPortal', 'mavenCentral', 'google']);
    expect(kinds(DEFAULT_REPOSITORIES.project)).toEqual(['mavenCentral', 'google']);
    const onlyPlugins = readRepositories(settings('pluginManagement { repositories { google() } }'));
    expect(kinds(onlyPlugins.plugins)).toEqual(['google']);
    expect(onlyPlugins.project).toEqual(DEFAULT_REPOSITORIES.project);
  });

  it('merges several files: settings first, then build files, without duplicates', () => {
    const repos = readRepositories([
      ...settings('dependencyResolutionManagement { repositories { mavenCentral() } }'),
      ...build('repositories { google(); mavenCentral() }'),
    ]);
    expect(kinds(repos.project)).toEqual(['mavenCentral', 'google']);
  });
});

describe('readRepositories on the demo fixture', () => {
  it('finds the portal, Central, Google and the JetBrains dev repository', () => {
    const file = path.join(__dirname, '../../kotlin-jump-demo/settings.gradle.kts');
    const repos = readRepositories([{ path: file, text: fs.readFileSync(file, 'utf8'), kind: 'settings' }]);
    expect(kinds(repos.plugins)).toEqual(['gradlePluginPortal', 'mavenCentral', 'google', 'custom']);
    expect(repos.plugins[3].url).toBe('https://maven.pkg.jetbrains.space/public/p/compose/dev');
    expect(kinds(repos.project)).toEqual(['mavenCentral', 'google', 'custom']);
  });
});

describe('blankGradleComments', () => {
  it('blanks line and block comments while keeping every offset and newline', () => {
    const text = 'a // x\nb /* y\nz */ c';
    const out = blankGradleComments(text);
    expect(out.length).toBe(text.length);
    expect(out.split('\n').length).toBe(text.split('\n').length);
    expect(out).toBe('a     \nb     \n     c');
  });

  it('leaves a double or single quoted string alone, slashes included', () => {
    const text = `maven { url 'https://jitpack.io' }; x("https://a.example.com") // c`;
    const out = blankGradleComments(text);
    expect(out.startsWith(`maven { url 'https://jitpack.io' }; x("https://a.example.com")`)).toBe(true);
    expect(out.endsWith('    ')).toBe(true);
  });
});
