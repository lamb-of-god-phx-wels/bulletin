import type { BulletinApi } from './shared/types';

declare global {
  interface Window { bulletin?: BulletinApi & { getPrintJob(): Promise<unknown>; printReady(): void } }
}
export {};
