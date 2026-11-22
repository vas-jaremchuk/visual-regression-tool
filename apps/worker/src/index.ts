import { getConfig, type Env } from './env';
import { handleQueue } from './queues/consumer';
import { handleRequest } from './router';

export { DiffContainer } from './containers/diff-container';
export { ProjectLimiter } from './limiter/project-limiter';
export { SitemapWorkflow } from './workflows/sitemap';
export { CaptureRunWorkflow } from './workflows/capture-run';
export { CompareWorkflow } from './workflows/compare';
export { DeleteWorkflow } from './workflows/delete';
export { StorageWorkflow } from './workflows/storage';

export default {
  fetch: (request, env) => handleRequest(request, env),
  async queue(batch, env) {
    await handleQueue(batch, env, getConfig(env));
  },
} satisfies ExportedHandler<Env>;
