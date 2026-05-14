import { readFile, writeFile, unlink } from 'fs/promises';
import path from 'path';

const CRON_DIR    = '/etc/cron.d';
const LOG_DIR     = process.env.LOG_DIR    || '/var/log/wg-man';
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || '/var/lib/wg-man/scripts';

const SAFE_FIELD_RE = /^[\d*,\-\/]+$/;
const SPECIAL_RE    = /^@(reboot|hourly|daily|weekly|monthly|midnight|annually|yearly)$/;

export interface UserCronStatus {
  enabled:    boolean;
  schedule:   string | null;
  delay:      number;
  cronFile:   string;
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

function parseDelay(cmdPart: string): number {
  const m = cmdPart.match(/^sleep\s+(\d+)\s*&&/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseCronLine(content: string): { schedule: string | null; delay: number } {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    // @special root [sleep N &&] bash ...
    if (parts[0].startsWith('@') && parts.length >= 3) {
      return { schedule: parts[0], delay: parseDelay(parts.slice(2).join(' ')) };
    }
    // m h dom mon dow root [sleep N &&] bash ...
    if (parts.length >= 7) {
      return { schedule: parts.slice(0, 5).join(' '), delay: parseDelay(parts.slice(6).join(' ')) };
    }
  }
  return { schedule: null, delay: 0 };
}

export async function getScriptCronStatus(id: string): Promise<UserCronStatus> {
  const file = cronFile(id);
  try {
    const content = await readFile(file, 'utf8');
    const { schedule, delay } = parseCronLine(content);
    return { enabled: schedule !== null, schedule, delay, cronFile: file, scriptPath: scriptPath(id) };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { enabled: false, schedule: null, delay: 0, cronFile: file, scriptPath: scriptPath(id) };
    }
    throw err;
  }
}

export async function setScriptCron(
  id: string,
  schedule: string,
  delay: number = 0,
  logFile?: string,
): Promise<void> {
  const trimmed = schedule.trim();
  let safeSched: string;

  if (SPECIAL_RE.test(trimmed)) {
    safeSched = trimmed;
  } else {
    const fields = trimmed.split(/\s+/);
    if (fields.length !== 5 || fields.some((f) => !SAFE_FIELD_RE.test(f))) {
      throw new Error(
        'Invalid cron expression — use 5 fields (e.g. */5 * * * *) or a @special string (@reboot, @daily, @weekly, @monthly, @hourly)',
      );
    }
    safeSched = fields.join(' ');
  }

  const safeDelay = Math.max(0, Math.floor(delay));
  const sp  = scriptPath(id);
  const lf  = logFile || defaultLogFile(id);
  const cmd = safeDelay > 0
    ? `sleep ${safeDelay} && bash ${sp} >> ${lf} 2>&1`
    : `bash ${sp} >> ${lf} 2>&1`;

  const content = [
    `# wg-man user script ${id} — managed by wg-man app, do not edit manually`,
    `${safeSched} root ${cmd}`,
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
