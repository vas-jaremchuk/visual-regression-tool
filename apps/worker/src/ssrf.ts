import {
  parseAllowHosts,
  type HostResolver,
  type SsrfGuardOptions,
  type WorkerEnv,
} from '@vrt/shared';

/**
 * DNS resolution for the SSRF guard (NFR-14). Workers have no resolver API, so A and AAAA
 * records come from Cloudflare's DNS-over-HTTPS JSON endpoint.
 */
const DOH_URL = 'https://cloudflare-dns.com/dns-query';

interface DohAnswer {
  Status: number;
  Answer?: { type: number; data: string }[];
}

export function dohResolver(fetchFn: typeof fetch = fetch): HostResolver {
  return async (hostname) => {
    const answers = await Promise.all(
      (['A', 'AAAA'] as const).map(async (type) => {
        const res = await fetchFn(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=${type}`, {
          headers: { accept: 'application/dns-json' },
        });
        if (!res.ok) throw new Error(`DNS lookup failed with HTTP ${res.status}`);
        const body = (await res.json()) as DohAnswer;
        // 1 = A, 28 = AAAA; CNAME answers (5) are followed by the resolver already.
        return (body.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
      }),
    );
    return answers.flat();
  };
}

export function ssrfOptions(config: Pick<WorkerEnv, 'SSRF_ALLOW_HOSTS'>): SsrfGuardOptions {
  return { resolve: dohResolver(), allowHosts: parseAllowHosts(config.SSRF_ALLOW_HOSTS) };
}
