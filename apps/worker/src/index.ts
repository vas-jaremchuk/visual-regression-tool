export { DiffContainer } from './diff-container';

export default {
  async fetch(): Promise<Response> {
    return new Response('Hello from the visual regression worker', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
} satisfies ExportedHandler;
