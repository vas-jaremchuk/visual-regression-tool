import { Container } from '@cloudflare/containers';
import type { Env } from '../env';

/**
 * Durable Object fronting the `apps/diff-container` image (03 §3, ADR-2). The diff contract,
 * bearer auth and env forwarding are added with T14/T15.
 */
export class DiffContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '5m';
}
