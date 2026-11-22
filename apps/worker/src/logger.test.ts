import { describe, expect, it } from 'vitest';
import { createLogger, type LogLevel } from './logger';

describe('createLogger', () => {
  it('writes one JSON object per line with bound fields', () => {
    const lines: [LogLevel, string][] = [];
    const log = createLogger({ component: 'test' }, (level, line) => lines.push([level, line]));
    log
      .child({ projectId: 'p1', runId: 'r1' })
      .warn('slow page', { itemId: 'i1', step: 'capture' });

    expect(lines).toHaveLength(1);
    const [level, line] = lines[0]!;
    expect(level).toBe('warn');
    expect(JSON.parse(line)).toMatchObject({
      level: 'warn',
      msg: 'slow page',
      component: 'test',
      projectId: 'p1',
      runId: 'r1',
      itemId: 'i1',
      step: 'capture',
    });
  });

  it('serialises errors', () => {
    let out = '';
    createLogger({}, (_l, line) => (out = line)).error('boom', { error: new Error('bad') });
    expect(JSON.parse(out).error).toMatchObject({ name: 'Error', message: 'bad' });
  });

  it('redacts secret fields, nested ones included (NFR-12)', () => {
    let out = '';
    createLogger({}, (_l, line) => (out = line)).info('settings', {
      project: {
        basic_auth_user: 'u',
        basic_auth_pass_enc: 'v1:abc',
        basicAuth: { password: 'p' },
      },
      channel: { type: 'slack', target_enc: 'v1:def', webhookUrl: 'https://x.test/hook' },
      headers: { Authorization: 'Basic dTpw' },
      token: 'share-token',
      itemId: 'i1',
      r2_key: 'runs/a/desktop/home.png',
    });
    const entry = JSON.parse(out);
    expect(entry.project).toEqual({
      basic_auth_user: 'u',
      basic_auth_pass_enc: '[redacted]',
      basicAuth: { password: '[redacted]' },
    });
    expect(entry.channel).toEqual({
      type: 'slack',
      target_enc: '[redacted]',
      webhookUrl: '[redacted]',
    });
    expect(entry.headers).toEqual({ Authorization: '[redacted]' });
    expect(entry.token).toBe('[redacted]');
    expect(entry.itemId).toBe('i1');
    expect(entry.r2_key).toBe('runs/a/desktop/home.png');
  });

  it('scrubs credentials, webhook URLs and auth headers from messages and errors (NFR-12)', () => {
    let out = '';
    createLogger({}, (_l, line) => (out = line)).error('fetch https://user:hunter2@site.test/a', {
      err: new Error('POST https://hooks.slack.com/services/T0/B0/xyz failed; Bearer abc.def'),
    });
    expect(out).not.toMatch(/hunter2|T0\/B0\/xyz|abc\.def/);
    const entry = JSON.parse(out);
    expect(entry.msg).toBe('fetch https://[redacted]@site.test/a');
    expect(entry.err.message).toBe('POST [redacted] failed; Bearer [redacted]');
  });
});
