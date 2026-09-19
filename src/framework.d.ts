import 'vinext/types';
import type { Env as AppEnv } from './env.ts';
declare global {
  namespace Cloudflare { interface Env extends AppEnv {} }
  interface SubtleCrypto {
    timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean;
  }
}
