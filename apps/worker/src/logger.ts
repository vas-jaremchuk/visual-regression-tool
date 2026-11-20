/**
 * Structured JSON logger (06 §8). One JSON object per line so Workers Logs can index fields;
 * job code binds `projectId`, `runId|comparisonId`, `itemId` and `step` with `child`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export type LogSink = (level: LogLevel, line: string) => void;

const consoleSink: LogSink = (level, line) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

function serialise(value: unknown): unknown {
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function createLogger(base: LogFields = {}, sink: LogSink = consoleSink): Logger {
  const write = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const entry: LogFields = { level, msg, time: new Date().toISOString(), ...base };
    for (const [key, value] of Object.entries(fields)) entry[key] = serialise(value);
    sink(level, JSON.stringify(entry));
  };
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}
