import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';

// Read-only audit that the VPN-bound apps cannot reach the internet outside the
// tunnel. The probes run as each app user, which wg-man's sandbox cannot do,
// so the root helper performs them (`wg-man-migrate check`).

const DATA_DIR = process.env.DATA_DIR || '/var/lib/wg-man';
const REPORT   = path.join(DATA_DIR, 'security-check.json');
const HELPER   = process.env.MIGRATE_HELPER || '/usr/local/sbin/wg-man-migrate';

export type SecurityCheck = { name: string; status: 'pass' | 'fail' | 'warn'; detail: string };

export type SecurityReport = {
  checkedAt: number;
  durationMs: number;
  ok: boolean;
  counts: { pass: number; fail: number; warn: number };
  host: { ip: string | null; mullvad: boolean; country: string | null };
  groups: { id: string; title: string; status: 'pass' | 'fail' | 'warn'; checks: SecurityCheck[] }[];
};

let inFlight: Promise<SecurityReport> | null = null;

export async function lastSecurityReport(): Promise<SecurityReport | null> {
  try {
    return JSON.parse(await readFile(REPORT, 'utf8')) as SecurityReport;
  } catch {
    return null;
  }
}

/** Run the audit (one at a time; concurrent callers share the result). */
export function runSecurityCheck(): Promise<SecurityReport> {
  inFlight ??= new Promise<SecurityReport>((resolve, reject) => {
    execFile('systemd-run', ['--wait', '--pipe', '--quiet', '--collect', `--unit=wg-man-check-${Date.now()}`,
      '/usr/bin/python3', '-I', HELPER, 'check'], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout, stderr) => {
      try {
        const out = JSON.parse(String(stdout).trim().split('\n').pop() ?? '');
        if (out.error) reject(new Error(out.error));
        else resolve(out as SecurityReport);
      } catch {
        reject(new Error(`Check failed: ${(String(stderr) || err?.message || 'no output').trim().slice(-300)}`));
      }
    });
  }).finally(() => { inFlight = null; });
  return inFlight;
}
