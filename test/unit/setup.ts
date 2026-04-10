import { beforeEach } from 'vitest';
import { clearContentCache } from '../../src/providers/FindUsagesEngine';

// The content cache in FindUsagesEngine is a module-level singleton.
// Clear it before each test to prevent stale entries from leaking across tests.
beforeEach(() => {
  clearContentCache();
});
