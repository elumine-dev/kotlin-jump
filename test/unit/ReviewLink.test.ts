import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

import { getReviewUrl } from '../../src/util/reviewLink';

describe('getReviewUrl', () => {
  afterEach(() => {
    vscodeMock.env.uriScheme = 'vscode';
  });

  it('routes real VS Code to the Marketplace', () => {
    vscodeMock.env.uriScheme = 'vscode';
    expect(getReviewUrl()).toContain('marketplace.visualstudio.com');
  });

  it('routes VS Code Insiders to the Marketplace', () => {
    vscodeMock.env.uriScheme = 'vscode-insiders';
    expect(getReviewUrl()).toContain('marketplace.visualstudio.com');
  });

  it('routes VSCodium to Open VSX, not the Marketplace it can\'t use', () => {
    // Regression guard: "vscodium".startsWith("vscode") is true, so a
    // prefix check here would misroute this fork straight back to the
    // Marketplace it was built specifically to avoid.
    vscodeMock.env.uriScheme = 'vscodium';
    expect(getReviewUrl()).toContain('open-vsx.org');
  });

  it('routes Cursor and Windsurf to Open VSX', () => {
    vscodeMock.env.uriScheme = 'cursor';
    expect(getReviewUrl()).toContain('open-vsx.org');

    vscodeMock.env.uriScheme = 'windsurf';
    expect(getReviewUrl()).toContain('open-vsx.org');
  });
});
