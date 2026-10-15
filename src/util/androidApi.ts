/**
 * G61: what the Android platform really declares, from `android.jar`.
 *
 * A member of a class whose ancestry leaves the corpus was never judged, since
 * the framework type might declare the same name and call it. On LaPresse that
 * kept ~20 dead methods of custom views and every service that also
 * implements `ComponentCallbacks2`. The bundled index
 * (`bundled/android-api-36.json`, built by `scripts/build-android-api-index.ts`)
 * says which names each public platform type declares, inherited ones
 * included.
 *
 * Only the platform: AndroidX and other libraries stay unknown, and an
 * unknown ancestor keeps the old, cautious answer.
 */

export interface AndroidApiIndex {
  level: string;
  names: string[];
  /** fqn -> [superclass, interfaces, indexes into `names`]. Nested types use dots. */
  types: Record<string, [string | null, string[], number[]]>;
}

export interface AndroidApi {
  /** Every method name this platform type declares or inherits, or undefined when unknown. */
  declared(fqn: string): ReadonlySet<string> | undefined;
  /** The platform type a bare supertype name designates from this file, or undefined. */
  resolve(bare: string, imports: readonly string[]): string | undefined;
}

export function androidApi(index: AndroidApiIndex): AndroidApi {
  const memo = new Map<string, Set<string> | null>();
  const declared = (fqn: string): Set<string> | null => {
    const known = memo.get(fqn);
    if (known !== undefined) return known;
    const t = index.types[fqn];
    if (!t) { memo.set(fqn, null); return null; }
    memo.set(fqn, null);   // a cycle reads as unknown rather than looping
    const [sup, ifs, own] = t;
    const out = new Set(own.map(i => index.names[i]));
    for (const parent of [...(sup ? [sup] : []), ...ifs]) {
      const inherited = declared(parent);
      if (inherited === null) return null;
      for (const n of inherited) out.add(n);
    }
    memo.set(fqn, out);
    return out;
  };
  return {
    declared: fqn => declared(fqn) ?? undefined,
    resolve(bare, imports) {
      if (bare.includes('.')) {
        if (index.types[bare]) return bare;
        // `View.OnClickListener` with `android.view.View` imported.
        const [outer, ...rest] = bare.split('.');
        const imported = imports.find(i => i.endsWith(`.${outer}`));
        const fqn = imported === undefined ? undefined : `${imported}.${rest.join('.')}`;
        return fqn !== undefined && index.types[fqn] ? fqn : undefined;
      }
      const imported = imports.find(i => i.endsWith(`.${bare}`));
      if (imported !== undefined) return index.types[imported] ? imported : undefined;
      const lang = `java.lang.${bare}`;
      return index.types[lang] ? lang : undefined;
    },
  };
}
