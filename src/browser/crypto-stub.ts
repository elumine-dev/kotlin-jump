const notSupported = () => { throw new Error('crypto not supported in browser'); };
// createHash/randomBytes are synchronous APIs. Web Crypto's equivalents
// (crypto.subtle.digest, crypto.getRandomValues) have no synchronous form,
// so a drop-in stub isn't possible without making every caller async.
export const createHash  = notSupported;
export const randomBytes = notSupported;
// randomUUID has a real, synchronous Web Crypto equivalent. No caller in
// this repo uses it today, but it costs nothing to make it actually work.
export const randomUUID = (): string => globalThis.crypto.randomUUID();
