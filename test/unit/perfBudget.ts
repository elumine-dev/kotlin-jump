import { expect } from 'vitest';

export interface BudgetOptions {
  /**
   * Run before each pass and left out of the measurement. Needed when the
   * workload feeds a counter that a later assertion checks: without it, three
   * passes would treble the count and break the very test being protected.
   */
  avant?: () => void;
  message?: string;
}

/**
 * Asserts a workload fits a budget, judging it by its FASTEST run.
 *
 * A first call carries the JIT warm up of everything it touches: measured on
 * the KJ027 workload, 28 ms cold against 7 ms warm on a calm machine, and
 * 108 ms against 17 ms on a busy one. These budgets exist to catch an
 * accidental blowup, so paying that warm up made the release pipeline flaky:
 * `.publish` runs the suite, and one publish stopped on 422 ms against a
 * 300 ms budget while the steady state cost is 5 ms.
 *
 * The retry only happens when the first run misses, so a calm machine pays
 * nothing: running every one of these workloads three times cost the suite
 * 13 percent. A real regression is slow in every run and still fails.
 */
export function expectFasterThan(
  budget: number,
  travail: () => void,
  options?: string | BudgetOptions,
): void {
  const opts: BudgetOptions = typeof options === 'string' ? { message: options } : options ?? {};
  let meilleur = Infinity;
  for (let passe = 0; passe < 3; passe++) {
    opts.avant?.();
    const debut = performance.now();
    travail();
    const ecoule = performance.now() - debut;
    if (ecoule < meilleur) meilleur = ecoule;
    if (meilleur < budget) break;
  }
  expect(meilleur, opts.message).toBeLessThan(budget);
}
