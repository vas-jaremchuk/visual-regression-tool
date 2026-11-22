import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';

/** Binding names in `wrangler.jsonc` are part of the contract (03 §3). */

const { rawConfig: config } = experimental_readRawConfig({
  config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url).href),
});

describe('wrangler.jsonc', () => {
  it('declares the Browser Rendering binding', () => {
    expect(config.browser?.binding).toBe('BROWSER');
  });

  it('declares the workflows', () => {
    const workflows = Object.fromEntries(
      (config.workflows ?? []).map((w) => [w.binding, w.class_name]),
    );
    expect(workflows).toEqual({
      CAPTURE_RUN: 'CaptureRunWorkflow',
      COMPARE_RUN: 'CompareWorkflow',
      SITEMAP_FETCH: 'SitemapWorkflow',
      DELETE_JOB: 'DeleteWorkflow',
      STORAGE_USAGE: 'StorageWorkflow',
    });
  });

  it('declares capture and diff queues with dead-letter queues', () => {
    const producers = Object.fromEntries(
      (config.queues?.producers ?? []).map((p) => [p.binding, p.queue]),
    );
    expect(producers).toEqual({ CAPTURE_QUEUE: 'vrt-capture', DIFF_QUEUE: 'vrt-diff' });
    const consumers = Object.fromEntries(
      (config.queues?.consumers ?? []).map((c) => [c.queue, c.dead_letter_queue]),
    );
    expect(consumers).toEqual({ 'vrt-capture': 'vrt-capture-dlq', 'vrt-diff': 'vrt-diff-dlq' });
  });

  it('declares the diff container with at least 1 GiB of memory', () => {
    expect(config.durable_objects?.bindings).toContainEqual({
      name: 'DIFF_CONTAINER',
      class_name: 'DiffContainer',
    });
    const container = config.containers?.find((c) => c.class_name === 'DiffContainer');
    expect(container?.instance_type).not.toMatch(/^(lite|dev)$/);
  });

  it('declares the ProjectLimiter Durable Object with a SQLite migration', () => {
    expect(config.durable_objects?.bindings).toContainEqual({
      name: 'PROJECT_LIMITER',
      class_name: 'ProjectLimiter',
    });
    const migrated = (config.migrations ?? []).flatMap((m) => m.new_sqlite_classes ?? []);
    expect(migrated).toContain('ProjectLimiter');
  });
});
