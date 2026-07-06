const notSupported = () => { throw new Error('fs not supported in browser'); };
export const readFile    = notSupported;
export const writeFile   = notSupported;
export const readdir     = notSupported;
export const stat        = notSupported;
export const statSync    = notSupported;
export const readdirSync = notSupported;
export const mkdir       = notSupported;
export const existsSync  = () => false;
export const readFileSync  = notSupported;
export const mkdirSync     = notSupported;
export const writeFileSync = notSupported;
export const renameSync    = notSupported;
export const unlinkSync    = notSupported;
export const promises = {
  readFile:  () => Promise.reject(new Error('fs not supported in browser')),
  writeFile: () => Promise.reject(new Error('fs not supported in browser')),
  readdir:   () => Promise.reject(new Error('fs not supported in browser')),
  stat:      () => Promise.reject(new Error('fs not supported in browser')),
  mkdir:     () => Promise.reject(new Error('fs not supported in browser')),
};
