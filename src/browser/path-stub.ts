export const sep = '/';

export function join(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/');
  return joined.endsWith('/') && joined.length > 1 ? joined.slice(0, -1) : joined || '/';
}

export function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : '/';
}

export function basename(p: string, ext?: string): string {
  const base = p.split('/').pop() ?? '';
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(p: string): string {
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx) : '';
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export function normalize(p: string): string {
  return p.replace(/\/+/g, '/');
}

export function relative(_from: string, to: string): string {
  return to;
}

export const posix = { join, dirname, basename, extname, resolve, isAbsolute, normalize, sep };
