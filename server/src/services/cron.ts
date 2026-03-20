import { readFile, writeFile, unlink } from 'fs/promises';

const CRON_FILE      = '/etc/cron.d/wg-man-monitor';
const MONITOR_SCRIPT = process.env.MONITOR_SCRIPT || '/usr/local/bin/vpn-monitor.sh';
const LOG_FILE       = process.env.LOG_FILE       || '/var/log/vpn-monitor.log';

// Whitelist: each cron field may only contain digits, *, comma, hyphen, slash
const SAFE_FIELD_RE = /^[\d*,\-\/]+$/;

export interface CronStatus {
  enabled:    boolean;
  schedule:   string | null;  // e.g. "*/5 * * * *"
  cronFile:   string;
  scriptPath: string;
  logFile:    string;
}

/** Extract the 5-field cron expression from the cron.d file content, or null if absent. */
function parseSchedule(content: string): string | null {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 7) return parts.slice(0, 5).join(' ');
  }
  return null;
}

export async function getCronStatus(): Promise<CronStatus> {
  try {
    const content  = await readFile(CRON_FILE, 'utf8');
    const schedule = parseSchedule(content);
    return { enabled: schedule !== null, schedule, cronFile: CRON_FILE, scriptPath: MONITOR_SCRIPT, logFile: LOG_FILE };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { enabled: false, schedule: null, cronFile: CRON_FILE, scriptPath: MONITOR_SCRIPT, logFile: LOG_FILE };
    }
    throw err;
  }
}

export async function setCron(schedule: string): Promise<void> {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some((f) => !SAFE_FIELD_RE.test(f))) {
    throw new Error('Invalid cron expression — must be 5 whitespace-separated fields using digits, *, , - /');
  }
  const safe    = fields.join(' ');
  const content = [
    '# wg-man auto-monitor — managed by wg-man app, do not edit manually',
    `${safe} root ${MONITOR_SCRIPT} >> ${LOG_FILE} 2>&1`,
    '', // trailing newline required by cron.d
  ].join('\n');
  await writeFile(CRON_FILE, content, { mode: 0o644 });
}

export async function disableCron(): Promise<void> {
  try {
    await unlink(CRON_FILE);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}
