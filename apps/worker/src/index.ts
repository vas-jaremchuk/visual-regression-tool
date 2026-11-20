import { getConfig, type Env } from './env';
import { handleQueue } from './queues/consumer';
import { handleRequest } from './router';

export { DiffContainer } from './containers/diff-container';
export { CaptureRunWorkflow, CompareWorkflow, SitemapWorkflow } from './workflows/stubs';

export default {
  fetch: (request, env) => handleRequest(request, env),
  async queue(batch, env) {
    getConfig(env);
    await handleQueue(batch);
  },
} satisfies ExportedHandler<Env>;
