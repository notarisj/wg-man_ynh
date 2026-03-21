import { readFile } from 'fs/promises';

export interface SystemMetrics {
  cpuPercent: number;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
}

let _prevCpu: { idle: number; total: number } | null = null;

export async function getSystemMetrics(): Promise<SystemMetrics | null> {
  try {
    const [cpu, mem] = await Promise.all([readCpu(), readMem()]);
    return { ...cpu, ...mem };
  } catch {
    return null;
  }
}

async function readCpu(): Promise<{ cpuPercent: number }> {
  const raw = await readFile('/proc/stat', 'utf8');
  const line = raw.split('\n')[0]; // first line: "cpu  user nice system idle iowait irq softirq steal ..."
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + (parts[4] ?? 0); // idle + iowait
  const total = parts.reduce((a, b) => a + b, 0);

  if (!_prevCpu) {
    _prevCpu = { idle, total };
    return { cpuPercent: 0 };
  }

  const idleDiff = idle - _prevCpu.idle;
  const totalDiff = total - _prevCpu.total;
  _prevCpu = { idle, total };

  const pct = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
  return { cpuPercent: Math.max(0, Math.min(100, pct)) };
}

async function readMem(): Promise<{ ramPercent: number; ramUsedMb: number; ramTotalMb: number }> {
  const raw = await readFile('/proc/meminfo', 'utf8');
  const get = (key: string): number => {
    const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1], 10) : 0;
  };
  const total = get('MemTotal');
  const available = get('MemAvailable');
  const used = total - available;
  return {
    ramTotalMb: Math.round(total / 1024),
    ramUsedMb: Math.round(used / 1024),
    ramPercent: total > 0 ? Math.round((used / total) * 100) : 0,
  };
}
