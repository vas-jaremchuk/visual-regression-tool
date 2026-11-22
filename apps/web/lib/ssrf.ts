import 'server-only';
import { lookup } from 'node:dns/promises';
import { parseAllowHosts, type SsrfGuardOptions } from '@vrt/shared';
import { serverEnv } from './env';

async function resolveHost(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true });
  return addresses.map((entry) => entry.address);
}

/** SSRF guard options for fetches the web server makes itself (NFR-14). */
export function webSsrfOptions(): SsrfGuardOptions {
  return { resolve: resolveHost, allowHosts: parseAllowHosts(serverEnv().SSRF_ALLOW_HOSTS) };
}
