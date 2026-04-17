const notSupported = () => { throw new Error('child_process not supported in browser'); };
export const spawn    = notSupported;
export const exec     = notSupported;
export const execFile = notSupported;
export const fork     = notSupported;
export const execSync = notSupported;
