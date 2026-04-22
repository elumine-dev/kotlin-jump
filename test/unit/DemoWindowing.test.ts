import { describe, it, expect } from 'vitest';

import {
  buildWindowFailureMessage,
  decideWindowResolution,
  type WindowProbeResult,
} from '../../scripts/demo/lib/windowing';

function probe(
  source: WindowProbeResult['source'],
  status: WindowProbeResult['status'],
  windowCount: number,
  ok: boolean = status === 'OK',
): WindowProbeResult {
  return {
    ok,
    source,
    status,
    windowCount,
    seen: `source=${source} status=${status} windows=${windowCount}`,
  };
}

describe('DemoWindowing - resolution decisions', () => {
  it('uses pid resolution when the pid-scoped probe finds the window', () => {
    const decision = decideWindowResolution({
      pidProbe: probe('pid', 'OK', 1),
    });

    expect(decision.ok).toBe(true);
    expect(decision.resolution).toBe('pid');
    expect(decision.positionMode).toBe('pid');
    expect(decision.summary).toContain('resolution=pid');
  });

  it('falls back to title resolution when pid misses but title finds the marker window', () => {
    const decision = decideWindowResolution({
      pidProbe:   probe('pid', 'EMPTY', 0, false),
      titleProbe: probe('title', 'OK', 1),
    });

    expect(decision.ok).toBe(true);
    expect(decision.resolution).toBe('title_fallback');
    expect(decision.positionMode).toBe('title');
    expect(decision.summary).toContain('resolution=title_fallback');
    expect(decision.summary).toContain('source=pid status=EMPTY windows=0');
    expect(decision.summary).toContain('source=title status=OK windows=1');
  });

  it('classifies zero windows everywhere as likely Accessibility denial', () => {
    const decision = decideWindowResolution({
      pidProbe:   probe('pid', 'EMPTY', 0, false),
      titleProbe: probe('title', 'MISS', 0, false),
    });

    expect(decision.ok).toBe(false);
    expect(decision.resolution).toBe('blocked_accessibility');
    expect(decision.likelyAccessibilityBlocked).toBe(true);
  });

  it('does not claim Accessibility denial when the pid process is gone', () => {
    const decision = decideWindowResolution({
      pidProbe:   probe('pid', 'NOPROC', 0, false),
      titleProbe: probe('title', 'MISS', 0, false),
    });

    expect(decision.ok).toBe(false);
    expect(decision.resolution).toBe('no_window');
    expect(decision.likelyAccessibilityBlocked).toBe(false);
  });

  it('does not claim Accessibility denial when osascript itself fails', () => {
    const decision = decideWindowResolution({
      pidProbe:   probe('pid', 'OSASCRIPT_ERROR', 0, false),
      titleProbe: probe('title', 'MISS', 0, false),
    });

    expect(decision.ok).toBe(false);
    expect(decision.resolution).toBe('no_window');
    expect(decision.likelyAccessibilityBlocked).toBe(false);
  });
});

describe('DemoWindowing - failure messages', () => {
  it('builds an Accessibility-specific remediation message', () => {
    const msg = buildWindowFailureMessage(decideWindowResolution({
      pidProbe:   probe('pid', 'EMPTY', 0, false),
      titleProbe: probe('title', 'MISS', 0, false),
    }));

    expect(msg).toContain('System Events');
    expect(msg).toContain('Accessibility');
    expect(msg).toContain('KJ_DEMO_ALLOW_WINDOW_FALLBACK');
  });

  it('builds a generic no-window remediation message', () => {
    const msg = buildWindowFailureMessage(decideWindowResolution({
      pidProbe:   probe('pid', 'NOPROC', 0, false),
      titleProbe: probe('title', 'MISS', 2, false),
    }));

    expect(msg).toContain('did not appear in time');
    expect(msg).toContain('kjdemo clean');
    expect(msg).not.toContain('Accessibility -> enable your terminal app');
  });
});
