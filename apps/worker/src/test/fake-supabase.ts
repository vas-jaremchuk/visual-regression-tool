import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';

/**
 * In-memory stand-in for the service-role Supabase client: the subset of the query builder the
 * worker uses (`select`/`update` with `eq`/`in` filters, `maybeSingle`, `rpc`). Rows are plain
 * objects; selects return whole rows.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = { data: unknown; error: { message: string } | null };

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  readonly rpcCalls: { name: string; args: unknown }[] = [];
  /** Makes the next query on `table` fail with this message. */
  failNext: { table: string; message: string } | null = null;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed))
      this.tables[table] = rows.map((r) => ({ ...r }));
  }

  get client(): SupabaseClient<Database> {
    return {
      from: (table: string) => this.from(table),
      rpc: async (name: string, args: unknown) => {
        this.rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient<Database>;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  row(table: string, id: string): Row {
    const row = this.rows(table).find((r) => r.id === id);
    if (!row) throw new Error(`no ${table} row ${id}`);
    return row;
  }

  private from(table: string) {
    const take = (): { message: string } | null => {
      if (this.failNext?.table !== table) return null;
      const error = { message: this.failNext.message };
      this.failNext = null;
      return error;
    };
    return {
      select: () =>
        this.builder((filters) => {
          const error = take();
          if (error) return { data: null, error };
          return {
            data: this.rows(table)
              .filter((r) => filters.every((f) => f(r)))
              .map((r) => ({ ...r })),
            error: null,
          };
        }),
      update: (patch: Row) => {
        let returning = false;
        const run = (filters: Filter[]): Result => {
          const error = take();
          if (error) return { data: null, error };
          const matched = this.rows(table).filter((r) => filters.every((f) => f(r)));
          for (const r of matched) Object.assign(r, patch);
          return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null };
        };
        const b = this.builder(run);
        return Object.assign(b, {
          select: () => {
            returning = true;
            return b;
          },
        });
      },
    };
  }

  private builder(run: (filters: Filter[]) => Result) {
    const filters: Filter[] = [];
    const b = {
      eq(col: string, value: unknown) {
        filters.push((r) => r[col] === value);
        return b;
      },
      in(col: string, values: unknown[]) {
        filters.push((r) => values.includes(r[col]));
        return b;
      },
      async maybeSingle() {
        const res = run(filters);
        if (res.error) return res;
        const rows = res.data as Row[];
        if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
      then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => unknown) {
        return Promise.resolve()
          .then(() => run(filters))
          .then(resolve, reject);
      },
    };
    return b;
  }
}
