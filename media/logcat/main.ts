// ──────────────────────────────────────────────────────────────────────────────
// Kotlin Jump — Logcat webview entry.
//
// Vanilla TS (no framework). Bundled by esbuild → dist/logcat/main.js.
// Mirrors the message contract in /src/logcat/messages.ts.
//
// Architecture:
//   - LogMirror (logMirror.ts) owns the ring-buffered rows + incremental filter —
//     zero DOM, testable on its own. See its header comment for why it exists:
//     the mirror buffer here used to be a plain Array evicted with .shift(),
//     which is O(n) per push under V8 once full — the same anti-pattern already
//     fixed once on the host side (LogcatRingBuffer.ts).
//   - Virtual scroller maintains a recycled DOM-node pool for the visible window.
//   - Events bubble through a single delegated listener on the viewport.
// ──────────────────────────────────────────────────────────────────────────────

import { LogMirror, ALL_LEVELS, type MirrorFilterState } from './logMirror';
import type { LogEntry, LogLevel, ResolvedFrame } from '../../src/logcat/messages';
import type { AdbDevice } from '../../src/android/AdbBinary';

declare const acquireVsCodeApi: () => { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const API_VERSION = 1;

// ── State ─────────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 16;

let bufferCap = 100_000;
const mirror = new LogMirror(bufferCap);

const selectedLevels = new Set<LogLevel>(ALL_LEVELS);
let tagFilter    = '';
let searchQuery  = '';
let followAppPid = true;
let softWrap     = false;
let paused       = false;
let autoScroll   = true;

// Precomputed once per filter edit, not per row — matches() in logMirror.ts reads
// this directly instead of recomputing selectedLevels.size/toLowerCase() per entry.
const filterState: MirrorFilterState = {
  levels:    selectedLevels,
  hasTag:    false,
  tagLow:    '',
  hasSearch: false,
  searchLow: '',
};

const renderedNodes = new Map<number, HTMLElement>(); // displayIdx → node
const nodePool: HTMLElement[] = [];

// ── DOM lookups ───────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const elList     = $<HTMLDivElement>('log-list');
const elViewport = $<HTMLDivElement>('log-viewport');
const elDevice   = $<HTMLSelectElement>('device-picker');
const elPackage  = $<HTMLInputElement>('package-input');
const elPackages = $<HTMLDataListElement>('package-list');
const elTag      = $<HTMLInputElement>('tag-input');
const elSearch   = $<HTMLInputElement>('search-input');
const elFollow   = $<HTMLInputElement>('follow-pid');
const elPause    = $<HTMLButtonElement>('btn-pause');
const elClear    = $<HTMLButtonElement>('btn-clear');
const elWrap     = $<HTMLButtonElement>('btn-wrap');
const elExport   = $<HTMLButtonElement>('btn-export');
const elChips    = $<HTMLDivElement>('level-chips');
const elBuffer   = $<HTMLSpanElement>('buffer-meter');
const elThrough  = $<HTMLSpanElement>('throughput');
const elStatus   = $<HTMLSpanElement>('status-pill');
const elBanner   = $<HTMLDivElement>('release-banner');
const elBannerX  = $<HTMLButtonElement>('banner-dismiss');
const elError    = $<HTMLDivElement>('stream-error');

// ── Boot ──────────────────────────────────────────────────────────────────────

renderLevelChips();
wireEvents();
post({ type: 'ready' });

// ── Outbound helpers ──────────────────────────────────────────────────────────

function post(msg: Record<string, unknown>): void {
  vscode.postMessage({ apiVersion: API_VERSION, ...msg });
}

// ── Inbound dispatch ──────────────────────────────────────────────────────────

window.addEventListener('message', ev => {
  const msg = ev.data;
  if (!msg || msg.apiVersion !== API_VERSION) return;

  switch (msg.type) {
    case 'init':
      followAppPid = msg.state.followAppPid;
      bufferCap    = msg.state.bufferCap;
      mirror.resizeCapacity(bufferCap, filterState);
      elFollow.checked = followAppPid;
      paused = msg.state.paused;
      updatePauseButton();
      break;

    case 'append':
      onAppend(msg.rows as LogEntry[]);
      break;

    case 'hydrate':
      onHydrate(msg.rows as LogEntry[]);
      break;

    case 'reset':
      onReset();
      break;

    case 'devices':
      onDevices(msg.devices as AdbDevice[]);
      break;

    case 'packages':
      onPackages(msg.packages as string[]);
      break;

    case 'state':
      // Keep the local mirror cap in sync with the host ring (the user can change
      // kotlinJump.logcat.bufferSize at runtime). Without this, the webview keeps
      // evicting at the OLD cap even after the host resized.
      if (typeof msg.bufferCap === 'number' && msg.bufferCap > 0 && msg.bufferCap !== bufferCap) {
        bufferCap = msg.bufferCap;
        mirror.resizeCapacity(bufferCap, filterState);
        invalidateAllRows();
        updateVirtualHeight();
        renderVisible();
      }
      elBuffer.textContent  = `${formatNum(msg.bufferUsed)} / ${formatNum(msg.bufferCap)}`;
      elThrough.textContent = `${msg.throughputPerSec}/s`;
      elStatus.textContent  = msg.paused ? 'paused' : 'streaming';
      break;

    case 'release-build-detected':
      elBanner.hidden = false;
      break;

    case 'stream-error':
      elError.hidden = false;
      elError.textContent = `Stream error: ${msg.message}`;
      break;

    case 'adb-missing':
      elError.hidden = false;
      elError.textContent = 'adb binary not found. Set kotlinJump.adbPath or add adb to PATH.';
      break;

    case '_demoFlash':
      flashRowForDemo(msg.seq);
      break;
  }
});

function flashRowForDemo(seq: number): void {
  // Locate the displayIndex of the entry with the requested seq, then briefly
  // toggle a `.demo-flash` class on the rendered row. The row may be off-screen
  // (virtual scroll); in that case the class is applied on next render.
  for (const [idx, node] of renderedNodes) {
    const entry = entryAt(idx);
    if (entry?.seq === seq) {
      node.classList.add('demo-flash');
      setTimeout(() => node.classList.remove('demo-flash'), 700);
      return;
    }
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents(): void {
  elDevice.addEventListener('change', () => {
    if (elDevice.value) post({ type: 'pickDevice', serial: elDevice.value });
  });

  elPackage.addEventListener('change', () => {
    post({ type: 'pickPackage', packageName: elPackage.value.trim() });
  });

  elTag.addEventListener('input', debounce(() => {
    tagFilter = elTag.value.trim();
    filterState.hasTag = tagFilter.length > 0;
    filterState.tagLow = tagFilter.toLowerCase();
    post({ type: 'setTagFilter', tag: tagFilter });
    rebuildFiltered();
  }, 120));

  elSearch.addEventListener('input', debounce(() => {
    searchQuery = elSearch.value.trim();
    filterState.hasSearch = searchQuery.length > 0;
    filterState.searchLow = searchQuery.toLowerCase();
    post({ type: 'setSearch', query: searchQuery });
    rebuildFiltered();
  }, 150));

  elFollow.addEventListener('change', () => {
    followAppPid = elFollow.checked;
    post({ type: 'setFollowAppPid', enabled: followAppPid });
  });

  elPause.addEventListener('click', () => {
    paused = !paused;
    post({ type: paused ? 'pause' : 'resume' });
    updatePauseButton();
  });

  elClear.addEventListener('click', () => {
    post({ type: 'clear' });
    onReset();
  });

  elWrap.addEventListener('click', () => {
    softWrap = !softWrap;
    elWrap.classList.toggle('active', softWrap);
    invalidateAllRows();
    // Force re-render: switching modes changes positioning strategy.
    elViewport.style.height = softWrap ? '' : `${displayCount() * ROW_HEIGHT}px`;
    renderVisible();
  });

  elExport.addEventListener('click', () => post({ type: 'export' }));

  elBannerX.addEventListener('click', () => { elBanner.hidden = true; });

  // Virtual scroller
  let ticking = false;
  elList.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const atBottom = (elList.scrollTop + elList.clientHeight) >= (elList.scrollHeight - 4);
      autoScroll = atBottom;
      renderVisible();
      ticking = false;
    });
  });

  // Stack-frame click (delegated)
  elViewport.addEventListener('click', ev => {
    const target = ev.target as HTMLElement;
    if (!target.classList.contains('frame') || target.classList.contains('obfuscated')) return;
    const uri  = target.dataset['uri'];
    const line = parseInt(target.dataset['line'] ?? '0', 10);
    if (!uri || !Number.isFinite(line)) return;
    post({ type: 'navigate', uri, line });
  });

  window.addEventListener('resize', renderVisible);
}

// ── Append / reset ────────────────────────────────────────────────────────────

function onAppend(rows: LogEntry[]): void {
  mirror.append(rows, filterState);
  invalidateAllRows();
  updateVirtualHeight();
  renderVisible();
  if (autoScroll) {
    elList.scrollTop = elList.scrollHeight;
  }
}

// Visibility resync — sent once when the panel becomes visible again after
// being hidden, replacing the mirror's contents wholesale from the host's
// (already-bounded) ring buffer. See LogcatViewProvider.resyncAfterVisible().
function onHydrate(rows: LogEntry[]): void {
  mirror.hydrate(rows, filterState);
  invalidateAllRows();
  updateVirtualHeight();
  renderVisible();
  if (autoScroll) {
    elList.scrollTop = elList.scrollHeight;
  }
}

function onReset(): void {
  mirror.reset();
  invalidateAllRows();
  updateVirtualHeight();
  renderVisible();
}

function onDevices(devices: AdbDevice[]): void {
  const previous = elDevice.value;
  elDevice.innerHTML = '';
  for (const d of devices) {
    if (d.state !== 'device') continue;
    const opt = document.createElement('option');
    opt.value = d.serial;
    opt.textContent = `${d.model ?? d.serial} (${d.serial})`;
    elDevice.appendChild(opt);
  }
  if (previous && Array.from(elDevice.options).some(o => o.value === previous)) {
    elDevice.value = previous;
  } else if (elDevice.options.length > 0) {
    elDevice.selectedIndex = 0;
    post({ type: 'pickDevice', serial: elDevice.value });
    post({ type: 'requestPackages', serial: elDevice.value });
  }
}

function onPackages(packages: string[]): void {
  elPackages.innerHTML = '';
  for (const pkg of packages) {
    const opt = document.createElement('option');
    opt.value = pkg;
    elPackages.appendChild(opt);
  }
}

// ── Filter ────────────────────────────────────────────────────────────────────

// Full rescan — called only on an actual filter change (level toggle, tag/search
// edit). The hot path (onAppend, ~60Hz while streaming) never calls this; it
// only scans the batch it receives (see LogMirror.append in logMirror.ts).
function rebuildFiltered(): void {
  mirror.rebuild(filterState);
  invalidateAllRows();
  updateVirtualHeight();
  renderVisible();
}

function displayCount(): number {
  return mirror.displayCount();
}
function entryAt(idx: number): LogEntry | undefined {
  return mirror.entryAt(idx);
}

// ── Virtual scroller ──────────────────────────────────────────────────────────

function updateVirtualHeight(): void {
  elViewport.style.height = `${displayCount() * ROW_HEIGHT}px`;
}

function invalidateAllRows(): void {
  for (const node of renderedNodes.values()) {
    node.style.transform = 'translateY(-9999px)';
    nodePool.push(node);
  }
  renderedNodes.clear();
}

function renderVisible(): void {
  const total = displayCount();
  if (total === 0) { invalidateAllRows(); return; }

  if (softWrap) {
    renderFlow(total);
    return;
  }

  // Soft-wrap toggle was disabled — restore the virtual scroller's geometry.
  if (elViewport.style.height === '') {
    updateVirtualHeight();
  }

  const scrollTop = elList.scrollTop;
  const viewH     = elList.clientHeight;
  if (!viewH) return;

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
  const endRow   = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + 8);

  for (const [idx, node] of renderedNodes) {
    if (idx < startRow || idx >= endRow) {
      node.style.transform = 'translateY(-9999px)';
      node.style.position  = 'absolute';
      nodePool.push(node);
      renderedNodes.delete(idx);
    }
  }

  for (let i = startRow; i < endRow; i++) {
    if (renderedNodes.has(i)) continue;
    const entry = entryAt(i);
    if (!entry) continue;

    const node = nodePool.pop() ?? document.createElement('div');
    node.className = `entry lvl-${entry.level}`;
    node.style.position  = 'absolute';
    node.style.transform = `translateY(${i * ROW_HEIGHT}px)`;
    node.innerHTML = renderEntryHtml(entry);

    if (!node.parentElement) elViewport.appendChild(node);
    renderedNodes.set(i, node);
  }
}

/**
 * Soft-wrap renders rows in document flow — heights are unpredictable when
 * messages span multiple wrapped lines, so the virtual scroller's `i * 16px`
 * positioning would overlap. We cap to the most recent FLOW_CAP entries to
 * keep DOM size bounded; older entries are still in the buffer (just not
 * rendered). Switching back to virtual restores full visibility.
 */
const FLOW_CAP = 2_000;
function renderFlow(total: number): void {
  // Drop the virtual scroll height so the flow container expands to its
  // natural content height.
  elViewport.style.height = '';

  // Recycle every absolutely-positioned row.
  for (const [, node] of renderedNodes) {
    node.style.transform = 'translateY(-9999px)';
    node.style.position  = 'absolute';
    if (node.parentElement) node.parentElement.removeChild(node);
    nodePool.push(node);
  }
  renderedNodes.clear();

  const start = Math.max(0, total - FLOW_CAP);
  for (let i = start; i < total; i++) {
    const entry = entryAt(i);
    if (!entry) continue;
    const node = nodePool.pop() ?? document.createElement('div');
    node.className = `entry lvl-${entry.level} soft-wrap`;
    node.style.position  = 'relative';
    node.style.transform = '';
    node.innerHTML = renderEntryHtml(entry);
    elViewport.appendChild(node);
    renderedNodes.set(i, node);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderEntryHtml(e: LogEntry): string {
  // Use the device-emitted timestamp string verbatim — this keeps the wall
  // clock the user sees identical to what shows in Android Studio's Logcat,
  // regardless of the host machine's timezone.
  const ts  = e.tsDisplay ?? formatTs(e.ts);
  const pid = String(e.pid);
  const tag = escapeHtml(e.tag);
  const msg = e.frames && e.frames.length > 0
    ? renderMessageWithFrames(e.message, e.frames)
    : escapeHtml(e.message);
  return `<span class="ts">${ts}</span>` +
         `<span class="pid">${pid}</span>` +
         `<span class="level">${e.level}</span>` +
         `<span class="tag">${tag}</span>` +
         `<span class="msg">${msg}</span>`;
}

function renderMessageWithFrames(message: string, frames: ResolvedFrame[]): string {
  let out  = '';
  let cursor = 0;
  const sorted = frames.slice().sort((a, b) => a.startCol - b.startCol);
  for (const f of sorted) {
    if (f.startCol < cursor) continue;
    out += escapeHtml(message.slice(cursor, f.startCol));
    const text = escapeHtml(message.slice(f.startCol, f.endCol));
    if (f.uri) {
      out += `<span class="frame" data-uri="${escapeAttr(f.uri)}" data-line="${f.line}" title="${escapeAttr(`${f.fqn}.${f.method}`)}">${text}</span>`;
    } else if (f.obfuscated) {
      out += `<span class="frame obfuscated" title="Obfuscated — R8 mapping not yet supported">${text}</span>`;
    } else {
      out += text;
    }
    cursor = f.endCol;
  }
  out += escapeHtml(message.slice(cursor));
  return out;
}

function renderLevelChips(): void {
  elChips.innerHTML = '';
  for (const lvl of ALL_LEVELS) {
    const chip = document.createElement('span');
    chip.className = `chip chip-${lvl}` + (selectedLevels.has(lvl) ? ' active' : '');
    chip.textContent = lvl;
    chip.title = levelName(lvl);
    chip.addEventListener('click', () => toggleLevel(lvl));
    elChips.appendChild(chip);
  }
}

function toggleLevel(lvl: LogLevel): void {
  if (selectedLevels.has(lvl)) {
    if (selectedLevels.size <= 1) return;
    selectedLevels.delete(lvl);
  } else {
    selectedLevels.add(lvl);
  }
  renderLevelChips();
  post({ type: 'setLevels', levels: Array.from(selectedLevels) });
  rebuildFiltered();
}

function levelName(lvl: LogLevel): string {
  return ({ V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warning', E: 'Error', F: 'Fatal' } as const)[lvl];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updatePauseButton(): void {
  elPause.textContent = paused ? '▶' : '⏸';
  elPause.classList.toggle('active', paused);
  elPause.title = paused ? 'Resume' : 'Pause';
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const xxx = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${xxx}`;
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]!);
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]!);
}
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
