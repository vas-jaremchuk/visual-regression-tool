/**
 * Structured JSON logger (06 §8). One JSON object per line so Workers Logs can index fields;
 * job code binds `projectId`, `runId|comparisonId`, `itemId` and `step` with `child`. Secrets
 * are redacted before a line is written (NFR-12).
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

/** Field names whose values are never logged (NFR-12). */
const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|webhook|_enc$|^target$|credential/i;

const SECRET_TEXT: [RegExp, string][] = [
  // Credentials in a URL: https://user:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@'],
  // Slack incoming webhook URLs
  [/https:\/\/hooks\.slack\.com\/services\/[^\s"']+/gi, '[redacted]'],
  // Authorization header values
  [/\b(Basic|Bearer|VRT-HMAC)\s+[A-Za-z0-9+/=._:,-]+/g, '$1 [redacted]'],
];

/** Removes secrets that ended up in free text (an error message, a URL). */
export function redactText(text: string): string {
  return SECRET_TEXT.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

function serialise(value: unknown): unknown {
  if (value instanceof Error)
    return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

/** JSON.stringify replacer: drops secret fields and scrubs secrets from strings. */
function redact(this: unknown, key: string, value: unknown): unknown {
  if (key && SECRET_KEY.test(key) && value !== null && value !== undefined) return '[redacted]';
  if (value instanceof Error) return serialise(value);
  return typeof value === 'string' ? redactText(value) : value;
}

export function createLogger(base: LogFields = {}, sink: LogSink = consoleSink): Logger {
  const write = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    const entry: LogFields = { level, msg, time: new Date().toISOString(), ...base };
    for (const [key, value] of Object.entries(fields)) entry[key] = serialise(value);
    sink(level, JSON.stringify(entry, redact));
  };
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}
