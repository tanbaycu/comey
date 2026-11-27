declare module 'node:crypto' {
  export interface Hmac {
    update(data: string | Uint8Array): this;
    digest(encoding: 'hex'): string;
  }
  export function createHmac(algorithm: string, key: string | Uint8Array): Hmac;
}

interface Buffer extends Uint8Array {
  equals(otherBuffer: Uint8Array): boolean;
}
