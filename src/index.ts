/**
 * src/index.ts
 * 
 * Main entry point for browser bundle.
 * Exports Neon Client (@neondatabase/neon-js) and Better Auth UI (@neondatabase/auth-ui).
 */

import { neon, createNeonClient } from './lib/neonClient';
import {
  BetterAuthCard,
  BetterAuthUserHeader,
  mountBetterAuthUI,
  mountBetterAuthUserHeader
} from './lib/authUI';
import * as AuthUI from '@neondatabase/auth-ui';
import * as Blob from './lib/blob';
import * as Realtime from './lib/realtimeClient';

export {
  neon,
  createNeonClient,
  BetterAuthCard,
  BetterAuthUserHeader,
  mountBetterAuthUI,
  mountBetterAuthUserHeader,
  AuthUI,
  Blob,
  Realtime
};

// Global browser window bindings
if (typeof window !== 'undefined') {
  const win = window as any;
  win.neon = neon;
  win.createNeonClient = createNeonClient;
  win.NeonAuthUI = {
    BetterAuthCard,
    BetterAuthUserHeader,
    mountBetterAuthUI,
    mountBetterAuthUserHeader,
    ...AuthUI
  };
  win.mountBetterAuthUI = mountBetterAuthUI;
  win.mountBetterAuthUserHeader = mountBetterAuthUserHeader;
  win.VercelBlob = Blob;
  win.NeonRealtime = Realtime;
}

export default neon;
