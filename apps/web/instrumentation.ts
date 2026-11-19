/** Fails fast at boot when the web env is incomplete (03 §2). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { parseEnv, webEnv } = await import('@vrt/shared');
    parseEnv(webEnv, process.env, 'web');
  }
}
