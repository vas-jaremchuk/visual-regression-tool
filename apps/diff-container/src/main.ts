import { createDiffServer } from './server.ts';

const port = Number(process.env.PORT ?? 8080);

createDiffServer().listen(port, () => {
  console.log(`diff-container listening on :${port}`);
});
