import 'server-only';
import { parseEnv, webEnv, type WebEnv } from '@vrt/shared';

let cached: WebEnv | undefined;

/** The validated web env (03 §2). Throws naming every missing or invalid variable. */
export function serverEnv(): WebEnv {
  cached ??= parseEnv(webEnv, process.env, 'web');
  return cached;
}
