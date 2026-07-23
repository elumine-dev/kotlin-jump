import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { isInsideComment } from '../util/textUtils';

// Task declarations in Kotlin DSL build scripts:
//   tasks.register("name") / tasks.register<Type>("name")
//   tasks.create("name")   / task("name")
const TASK_DECL_RE = /\b(?:tasks\s*\.\s*(?:register|create)\s*(?:<[^>]*>)?|task)\s*\(\s*"([\w-]+)"/g;

export interface GradleTaskHit { name: string; column: number }

/** Scans one line for task declarations. Exported for tests. */
export function findGradleTasks(text: string): GradleTaskHit[] {
  const out: GradleTaskHit[] = [];
  TASK_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_DECL_RE.exec(text)) !== null) {
    if (isInsideComment(text, m.index)) continue;
    out.push({ name: m[1], column: m.index });
  }
  return out;
}

/**
 * Gradle path of a task declared in `buildFileDir`, relative to `rootDir`:
 *   root module        → "generateProtos"
 *   <root>/app         → ":app:generateProtos"
 *   <root>/core/data   → ":core:data:generateProtos"
 * Exported for tests.
 */
export function gradleTaskPath(rootDir: string, buildFileDir: string, task: string): string {
  const rel = path.relative(rootDir, buildFileDir);
  if (rel === '' || rel === '.') return task;
  return ':' + rel.split(path.sep).join(':') + ':' + task;
}

/** Walks up from the build file to the directory holding settings.gradle(.kts). */
function findGradleRoot(buildFileDir: string): string | null {
  let dir = buildFileDir;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'settings.gradle.kts'))
      || fs.existsSync(path.join(dir, 'settings.gradle'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * ▶ Run lens on task declarations in `build.gradle.kts`. Click runs the
 * task in the integrated terminal from the Gradle root, with the module
 * path resolved from the build file location (`:app:generateProtos`).
 * Desktop only: it spawns the Gradle wrapper.
 */
export class GradleTaskLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('gradleTaskLens', true)) return [];
    if (!document.uri.fsPath.endsWith('.gradle.kts')) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let ln = 0; ln < document.lineCount; ln++) {
      for (const hit of findGradleTasks(document.lineAt(ln).text)) {
        lenses.push(new vscode.CodeLens(new vscode.Range(ln, 0, ln, 0), {
          title: '▶ Run task',
          command: 'kotlin-jump.runGradleTask',
          arguments: [hit.name, document.uri.fsPath],
        }));
      }
    }
    return lenses;
  }
}

let gradleTerminal: vscode.Terminal | undefined;

/** Command handler: runs the clicked task in a reused integrated terminal. */
export function runGradleTask(taskName: string, buildFilePath: string): void {
  const buildFileDir = path.dirname(buildFilePath);
  const root = findGradleRoot(buildFileDir);
  if (!root) {
    vscode.window.showWarningMessage(
      `Kotlin Jump: no settings.gradle found above ${buildFileDir}`,
    );
    return;
  }
  const taskPath = gradleTaskPath(root, buildFileDir, taskName);
  const wrapper = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';

  if (!gradleTerminal || gradleTerminal.exitStatus !== undefined) {
    gradleTerminal = vscode.window.createTerminal({ name: 'Gradle', cwd: root });
  }
  gradleTerminal.show();
  gradleTerminal.sendText(`${wrapper} ${taskPath}`);
}
