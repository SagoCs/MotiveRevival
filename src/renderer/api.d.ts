import type { MrApi } from '../shared/types';

declare global {
  interface Window {
    mr: MrApi;
  }
}

export {};
