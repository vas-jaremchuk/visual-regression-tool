import { containerEnv, parseEnv } from '@vrt/shared';
import { R2ObjectStore } from '@vrt/storage';
import { createDiffServer } from './server.ts';

const env = parseEnv(containerEnv, process.env, 'diff-container');

const server = createDiffServer({
  store: new R2ObjectStore({
    accountId: env.CF_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }),
  sharedSecret: env.DIFF_CONTAINER_SHARED_SECRET,
});

server.listen(env.PORT, () => {
  console.log(`diff-container listening on :${env.PORT}`);
});

// Containers are stopped with SIGTERM; finish in-flight diffs before exiting.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
