import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { Night } from '../src/digest/types.js';

// Fixtures go in a temp dir. runs/ holds real nights and is never touched.
let runsDir = '';
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(
    join(runsDir, '2026-01-01.jsonl'),
    [
      '{"at":"2026-01-01T03:00:00+01:00","job":"sync","status":"retry","owner":null}',
      '{"at":"2026-01-01T02:00:00+01:00","job":"backup","status":"ok","owner":"ops"}',
      '{"at":"2026-01-01T03:05:00+01:00","job":"sync","status":"retry","owner":null,"error":"lock held"}',
      '{"at":"2026-01-01T03:07:00+01:00","job":"sync"',
      '{"at":"2026-01-01T03:10:00+01:00","job":"sync","status":"retry","owner":null}',
      '{"at":"2026-01-01T04:00:00+01:00","job":"report","status":"fail","owner":"mia","error":"timeout"}',
    ].join('\n') + '\n',
  );
  writeFileSync(join(runsDir, '2026-01-02.jsonl'), '');

  const config: RigConfig = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
  app = createApp(config);
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The one table row whose text mentions this job.
function rowFor(html: string, job: string): string {
  const row = html.match(/<tr[\s\S]*?<\/tr>/g)?.find((tr) => tr.includes(job));
  if (row === undefined) throw new Error(`no table row for ${job}`);
  return row;
}

describe('digest page', () => {
  it('renders one table sorted by job, with warn rows marked', async () => {
    const res = await app.request('/digest/2026-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(rowFor(html, 'sync')).toMatch(/class="[^"]*\bwarn\b/);
    expect(rowFor(html, 'report')).toMatch(/class="[^"]*\bwarn\b/);
    expect(rowFor(html, 'backup')).not.toMatch(/\bwarn\b/);
  });

  it('shows a null owner as an em dash', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    expect(rowFor(html, 'sync')).toContain('—');
  });

  it('says how many lines could not be read', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    expect(html).toContain('1 line could not be read');
  });

  it('renders an empty night as "nothing ran"', async () => {
    const res = await app.request('/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await app.request('/digest/2026-01-09');
    expect(res.status).toBe(404);
  });
});

describe('digest JSON', () => {
  it('returns the whole night, with the bad line counted', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    expect(res.status).toBe(200);
    const expected: Night = {
      night: '2026-01-01',
      rows: [
        {
          job: 'backup',
          owner: 'ops',
          runs: 1,
          retries: 0,
          fails: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-01-01T02:00:00+01:00',
          lastAt: '2026-01-01T02:00:00+01:00',
        },
        {
          job: 'report',
          owner: 'mia',
          runs: 1,
          retries: 0,
          fails: 1,
          lastStatus: 'fail',
          lastError: 'timeout',
          firstAt: '2026-01-01T04:00:00+01:00',
          lastAt: '2026-01-01T04:00:00+01:00',
        },
        {
          job: 'sync',
          owner: null,
          runs: 3,
          retries: 3,
          fails: 0,
          lastStatus: 'retry',
          lastError: 'lock held',
          firstAt: '2026-01-01T03:00:00+01:00',
          lastAt: '2026-01-01T03:10:00+01:00',
        },
      ],
      counts: { ok: 1, retry: 3, fail: 1 },
      badLines: 1,
    };
    expect(await res.json()).toEqual(expected);
  });

  it('returns an empty night with no rows', async () => {
    const res = await app.request('/api/digest/2026-01-02');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-01-02',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('returns 404 with an error for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-01-09');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night', night: '2026-01-09' });
  });
});

describe('digest page and JSON', () => {
  it('list the same jobs in the same order', async () => {
    const html = await (await app.request('/digest/2026-01-01')).text();
    const body = (await (await app.request('/api/digest/2026-01-01')).json()) as Night;
    const jobs = body.rows.map((row) => row.job);
    expect(jobs).toEqual(['backup', 'report', 'sync']);

    const positions = jobs.map((job) => html.indexOf(job));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
