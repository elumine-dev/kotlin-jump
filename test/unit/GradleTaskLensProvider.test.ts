/**
 * GradleTaskLensProvider — détection des tasks + chemin Gradle
 *
 * Vecteurs :
 *   GT-1  Formes de déclaration : register, register<Type>, create, task
 *   GT-2  Lignes non-task (named, withType, appels quelconques) → rien
 *   GT-3  Déclaration en commentaire → ignorée
 *   GT-4  Noms avec tirets et underscores capturés entiers
 *   GT-5  gradleTaskPath : racine, module simple, module imbriqué
 *   GT-6  Provider : fichier non .gradle.kts → aucun lens
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import {
  findGradleTasks, gradleTaskPath, GradleTaskLensProvider,
} from '../../src/providers/GradleTaskLensProvider';

describe('GT-1 — formes de déclaration', () => {
  it.each([
    ['tasks.register("generateProtos") {', 'generateProtos'],
    ['tasks.register<Copy>("copyDocs") {', 'copyDocs'],
    ['tasks.create("legacy")', 'legacy'],
    ['task("oldStyle") {', 'oldStyle'],
    ['    tasks . register ( "spaced" )', 'spaced'],
  ])('%s → %s', (line, expected) => {
    const hits = findGradleTasks(line);
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe(expected);
  });
});

describe('GT-2 — non-déclarations', () => {
  it.each([
    'tasks.named("existing") { }',
    'tasks.withType<Test> { }',
    'register("notATask")',
    'val x = myTask("nope")',
    'tasks.register(taskName)',
  ])('%s → rien', (line) => {
    expect(findGradleTasks(line)).toHaveLength(0);
  });
});

describe('GT-3 — commentaires', () => {
  it('déclaration commentée → ignorée', () => {
    expect(findGradleTasks('// tasks.register("dead") {')).toHaveLength(0);
  });
});

describe('GT-4 — noms composés', () => {
  it('tirets et underscores entiers', () => {
    const hits = findGradleTasks('tasks.register("publish-to-maven_local")');
    expect(hits[0].name).toBe('publish-to-maven_local');
  });
});

describe('GT-5 — chemin Gradle', () => {
  it('racine → nom nu', () => {
    expect(gradleTaskPath('/proj', '/proj', 'build')).toBe('build');
  });
  it('module simple → :app:task', () => {
    expect(gradleTaskPath('/proj', '/proj/app', 'generateProtos')).toBe(':app:generateProtos');
  });
  it('module imbriqué → :core:data:task', () => {
    expect(gradleTaskPath('/proj', '/proj/core/data', 'lint')).toBe(':core:data:lint');
  });
});

describe('GT-6 — sélection de fichier', () => {
  function makeDoc(fsPath: string, lines: string[]): vscode.TextDocument {
    return {
      uri: { fsPath, toString: () => 'file://' + fsPath },
      lineCount: lines.length,
      lineAt: (n: number) => ({ text: lines[n] }),
    } as unknown as vscode.TextDocument;
  }

  it('build.gradle.kts → lens', () => {
    const p = new GradleTaskLensProvider();
    const lenses = p.provideCodeLenses(makeDoc('/proj/app/build.gradle.kts', ['tasks.register("a") {}']));
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.command).toBe('kotlin-jump.runGradleTask');
    expect(lenses[0].command?.arguments).toEqual(['a', '/proj/app/build.gradle.kts']);
  });

  it('fichier .kt ordinaire → rien', () => {
    const p = new GradleTaskLensProvider();
    expect(p.provideCodeLenses(makeDoc('/proj/Main.kt', ['tasks.register("a") {}']))).toHaveLength(0);
  });
});
