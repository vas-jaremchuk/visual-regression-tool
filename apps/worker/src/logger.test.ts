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
});
