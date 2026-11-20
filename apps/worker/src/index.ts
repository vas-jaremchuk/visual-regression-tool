import { getConfig, type Env } from './env';
import { handleQueue } from './queues/consumer';
import { handleRequest } from './router';

export { DiffContainer } from './containers/diff-container';
export { ProjectLimiter } from './limiter/project-limiter';
export { CaptureRunWorkflow, CompareWorkflow, SitemapWorkflow } from './workflows/stubs';

export default {
  fetch: (request, env) => handleRequest(request, env),
  async queue(batch, env) {
    await handleQueue(batch, env, getConfig(env));
  },
} satisfies ExportedHandler<Env>;
