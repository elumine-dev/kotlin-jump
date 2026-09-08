import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { rootNodes } from '../../src/ui/AndroidProjectViewProvider';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const root = vscode.Uri.parse('file:///work/project');

describe('Android project view roots (was: an "app (root)" pseudo-module globbed ** under the workspace and repeated every module\'s manifests and res)', () => {
  it('lists only the declared modules plus one Gradle Scripts node in a multi-module project', () => {
    const nodes = rootNodes(`include(":app")\ninclude(":feature:home", ":core:ui")`, root);
    expect(nodes.map(n => `${n.kind}:${n.label}`)).toEqual([
      'module:app', 'module:feature:home', 'module:core:ui', 'gradle:Gradle Scripts',
    ]);
    expect(nodes.some(n => n.label === 'app (root)')).toBe(false);
    expect(nodes[1]!.modulePath!.replace(/\\/g, '/')).toMatch(/\/work\/project\/feature\/home$/);
    expect(nodes[3]!.modulePath!.replace(/\\/g, '/')).toMatch(/\/work\/project$/);
  });

  it('keeps the workspace root as the single module when settings.gradle declares nothing, or is missing', () => {
    expect(rootNodes(`rootProject.name = "solo"`, root).map(n => n.label)).toEqual(['app (root)']);
    expect(rootNodes(undefined, root).map(n => n.label)).toEqual(['app (root)']);
  });
});
