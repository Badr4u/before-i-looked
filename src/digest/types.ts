// Plan morning-digest § 1. The contract every part of § 2 builds against: the reader fills it,
// the page, the JSON and the board only read it.

export type JobStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed.
export type RunLine = {
  at: string;
  job: string;
  status: JobStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times are the log's own strings, offset kept (styleguide).
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: JobStatus;
  lastError: string | null; // the most recent `error` for this job, even if a later run was ok
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job; the page and the JSON use this order as is
  counts: Record<JobStatus, number>; // lines per status, for the board
  badLines: number; // lines that did not parse; counted, never thrown
};

// null when runs/<night>.jsonl does not exist, or `night` is not YYYY-MM-DD (→ 404).
// An empty file is a Night with no rows ("nothing ran").
export type ReadNight = (runsDir: string, night: string) => Night | null;
