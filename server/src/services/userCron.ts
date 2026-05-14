import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';

const CRON_DIR   = '/etc/cron.d';
const LOG_DIR    = process.env.LOG_DIR || '/var/log/wg-man';
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || '/var/lib/wg-man/scripts';

const SAFE_FIELD_RE = /^[\d*,\-\/]+$/;

export interface UserCronStatus {
  enabled:   boolean;
  schedule:  string | null;
  cronFile:  string;
  scriptPath: string;
}

function cronFile(id: string): string {
  return path.join(CRON_DIR, `wg-man-script-${id}`);
}

function scriptPath(id: string): string {
  return path.join(SCRIPTS_DIR, `${id}.sh`);
}

function defaultLogFile(id: string): string {
  return path.join(LOG_DIR, `script-${id}.log`);
}

function parseSchedule(content: string): string | null {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 7) return parts.slice(0, 5).join(' ');
  }
  return null;
}

export async function getScriptCronStatus(id: string): Promise<UserCronStatus> {
  const file = cronFile(id);
  try {
    const content  = await readFile(file, 'utf8');
    const schedule = parseSchedule(content);
    return { enabled: schedule !== null, schedule, cronFile: file, scriptPath: scriptPath(id) };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { enabled: false, schedule: null, cronFile: file, scriptPath: scriptPath(id) };
    }
    throw err;
  }
}

export async function setScriptCron(id: string, schedule: string, logFile?: string): Promise<void> {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some((f) => !SAFE_FIELD_RE.test(f))) {
    throw new Error('Invalid cron expression — must be 5 fields using digits, *, , - /');
  }
  const safe    = fields.join(' ');
  const sp      = scriptPath(id);
  const lf      = logFile || defaultLogFile(id);
  const content = [
    `# wg-man user script ${id} — managed by wg-man app, do not edit manually`,
    `${safe} root bash ${sp} >> ${lf} 2>&1`,
    '',
  ].join('\n');
  await writeFile(cronFile(id), content, { mode: 0o644 });
}

export async function disableScriptCron(id: string): Promise<void> {
  try {
    await unlink(cronFile(id));
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}
