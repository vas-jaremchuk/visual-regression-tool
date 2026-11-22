import { describe, expect, it } from 'vitest';
import { actionPattern, auditPageHref, dateRange, parseAuditFilters } from './audit-filters';

const PROJECT = '11111111-1111-4111-8111-111111111111';

describe('parseAuditFilters', () => {
  it('keeps valid filters and drops invalid ones', () => {
    expect(
      parseAuditFilters({
        project: PROJECT,
        actor: 'not-a-uuid',
        action: '  run. ',
        from: '2026-11-01',
        to: '2026-13-45',
        page: ['3', '4'],
      }),
    ).toEqual({
      project: PROJECT,
      actor: undefined,
      action: 'run.',
      from: '2026-11-01',
      to: undefined,
      page: 3,
    });
  });

  it('defaults to the first page without filters', () => {
    expect(parseAuditFilters({ action: '', page: 'x' })).toMatchObject({
      action: undefined,
      page: 1,
    });
    expect(parseAuditFilters({}).page).toBe(1);
  });
});

describe('actionPattern', () => {
  it('matches as a prefix and escapes LIKE wildcards', () => {
    expect(actionPattern('run.')).toBe('run.%');
    expect(actionPattern('a%b_c\\')).toBe('a\\%b\\_c\\\\%');
  });
});

describe('dateRange', () => {
  it('makes the end date inclusive', () => {
    expect(dateRange({ from: '2026-11-01', to: '2026-11-02' })).toEqual({
      gte: '2026-11-01T00:00:00.000Z',
      lt: '2026-11-03T00:00:00.000Z',
    });
    expect(dateRange({})).toEqual({ gte: undefined, lt: undefined });
  });
});

describe('auditPageHref', () => {
  it('keeps the filters and sets the page', () => {
    const filters = parseAuditFilters({ action: 'run.', actor: PROJECT, page: '2' });
    expect(auditPageHref('/admin/audit', filters, 3)).toBe(
      `/admin/audit?actor=${PROJECT}&action=run.&page=3`,
    );
    expect(auditPageHref('/admin/audit', parseAuditFilters({}), 1)).toBe('/admin/audit');
  });
});
