export type WindowProbeSource = 'pid' | 'title';
export type WindowProbeStatus = 'OK' | 'EMPTY' | 'NOPROC' | 'MISS' | 'OSASCRIPT_ERROR';
export type WindowResolution = 'pid' | 'title_fallback' | 'blocked_accessibility' | 'no_window';

export interface WindowProbeResult {
  ok:          boolean;
  source:      WindowProbeSource;
  status:      WindowProbeStatus;
  windowCount: number;
  seen:        string;
}

export interface WindowResolutionDecision {
  ok:                         boolean;
  resolution:                 WindowResolution;
  likelyAccessibilityBlocked: boolean;
  positionMode?:              WindowProbeSource;
  summary:                    string;
  pidProbe?:                  WindowProbeResult;
  titleProbe?:                WindowProbeResult;
}

export function decideWindowResolution(
  probes: { pidProbe?: WindowProbeResult; titleProbe?: WindowProbeResult; },
): WindowResolutionDecision {
  const { pidProbe, titleProbe } = probes;

  if (pidProbe?.ok) {
    return {
      ok:                         true,
      resolution:                 'pid',
      likelyAccessibilityBlocked: false,
      positionMode:               'pid',
      summary:                    `resolution=pid ${pidProbe.seen}`,
      pidProbe,
      titleProbe,
    };
  }

  if (titleProbe?.ok) {
    return {
      ok:                         true,
      resolution:                 'title_fallback',
      likelyAccessibilityBlocked: false,
      positionMode:               'title',
      summary:                    `resolution=title_fallback ${joinSeen(pidProbe, titleProbe)}`,
      pidProbe,
      titleProbe,
    };
  }

  const allProbes = [pidProbe, titleProbe].filter(Boolean) as WindowProbeResult[];
  const zeroWindowsEverywhere = allProbes.length > 0 && allProbes.every(p => p.windowCount === 0);
  const anyProbeError = allProbes.some(p => p.status === 'OSASCRIPT_ERROR');
  const pidMissingProcess = pidProbe?.status === 'NOPROC';
  const likelyAccessibilityBlocked = zeroWindowsEverywhere && !anyProbeError && !pidMissingProcess;

  return {
    ok:                         false,
    resolution:                 likelyAccessibilityBlocked ? 'blocked_accessibility' : 'no_window',
    likelyAccessibilityBlocked,
    summary:                    `resolution=${likelyAccessibilityBlocked ? 'blocked_accessibility' : 'no_window'} ${joinSeen(pidProbe, titleProbe)}`,
    pidProbe,
    titleProbe,
  };
}

export function buildWindowFailureMessage(
  decision: WindowResolutionDecision,
  opts: { allowFallbackEnvVar?: string; } = {},
): string {
  const allowFallbackEnvVar = opts.allowFallbackEnvVar ?? 'KJ_DEMO_ALLOW_WINDOW_FALLBACK';

  if (decision.likelyAccessibilityBlocked) {
    return (
      `VS Code recording window is not enumerable by System Events.\n` +
      `  ${decision.summary}\n` +
      `  Fix: System Settings -> Privacy & Security -> Accessibility -> enable your terminal app.\n` +
      `  Override for debugging only: set ${allowFallbackEnvVar}=1 to keep the old full-capture fallback.`
    );
  }

  return (
    `VS Code recording window did not appear in time.\n` +
    `  ${decision.summary}\n` +
    `  Remediation: close unused apps, run \`kjdemo clean\`, then retry.\n` +
    `  Override for debugging only: set ${allowFallbackEnvVar}=1 to keep the old full-capture fallback.`
  );
}

function joinSeen(pidProbe?: WindowProbeResult, titleProbe?: WindowProbeResult): string {
  const parts: string[] = [];
  if (pidProbe)   parts.push(pidProbe.seen);
  if (titleProbe) parts.push(titleProbe.seen);
  return parts.join('; ');
}
