import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Two hidden API stubs, `ScreenCapture.ScreenshotHardwareBuffer` and
 * `ScreenCaptureInternal.ScreenshotHardwareBuffer`, each declare
 * `getHardwareBuffer()`. Kotlin reads both as `buffer.hardwareBuffer`.
 *
 * Alone, the getter was safe: H9 reversed counts the bare `hardwareBuffer`.
 * Two bearers of the name sent it through the duplicates rule (KJ-036 for
 * members), which counted `getHardwareBuffer` and the accessors of a property,
 * never the bare spelling. The group read as "mentioned only where declared",
 * both getters were cut, and the app no longer compiled.
 */

const mod: any = await importOrNull('src/providers/unusedMembers');
const HIDDEN = '/w/hidden/src/main/java/android/window';
const APP = '/w/app/src/main/kotlin/li/app';

const stub = (cls: string) => `package android.window;\n\npublic class ${cls} {\n    public static class ScreenshotHardwareBuffer {\n        public Bitmap asBitmap() {\n            throw new RuntimeException();\n        }\n\n        public HardwareBuffer getHardwareBuffer() {\n            throw new RuntimeException();\n        }\n    }\n}\n`;

const found = (kotlin: string, xml?: string): string[] => {
  const sources = [
    { path: `${HIDDEN}/ScreenCapture.java`, text: stub('ScreenCapture') },
    { path: `${HIDDEN}/ScreenCaptureInternal.java`, text: stub('ScreenCaptureInternal') },
    { path: `${APP}/Compat.kt`, text: kotlin },
    ...(xml ? [{ path: '/w/app/src/main/res/layout/screen.xml', text: xml }] : []),
  ];
  return (mod.findUnusedMembers({ sources, testSourceSets: ['test/java', 'test/kotlin'], deadDeclarations: [] }) as any[])
    .map(m => `${m.container}.${m.name}`);
};

const reads = 'package li.app\n\nimport android.window.ScreenCapture\n\nobject Compat {\n    fun copy(b: ScreenCapture.ScreenshotHardwareBuffer) = b.asBitmap()?.also { b.hardwareBuffer.close() }\n}\n\nfun go() = Compat.copy(TODO())\n';

describe.skipIf(!mod)('homonymous Java getters read as a Kotlin property', () => {
  it('neither getter is reported', () => {
    expect(found(reads).filter(n => n.endsWith('getHardwareBuffer'))).toEqual([]);
  });

  it('control: never read, both are still reported', () => {
    const silent = reads.replace('b.asBitmap()?.also { b.hardwareBuffer.close() }', 'b.asBitmap()');
    expect(found(silent).filter(n => n.endsWith('getHardwareBuffer')).sort()).toEqual([
      'ScreenCapture.ScreenshotHardwareBuffer.getHardwareBuffer',
      'ScreenCaptureInternal.ScreenshotHardwareBuffer.getHardwareBuffer',
    ]);
  });

  it('a data binding read in XML keeps the group too', () => {
    const silent = reads.replace('b.asBitmap()?.also { b.hardwareBuffer.close() }', 'b.asBitmap()');
    const xml = '<layout><data><variable name="b" type="android.window.ScreenCapture.ScreenshotHardwareBuffer"/></data>\n<View android:tag="@{b.hardwareBuffer}"/></layout>\n';
    expect(found(silent, xml).filter(n => n.endsWith('getHardwareBuffer'))).toEqual([]);
  });
});
