// Must be the first import in index.ts.
// Loads dotenv then applies any user overrides from DATA_DIR/server-config.json
// so that module-level constants in wg.ts read the correct values.
import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/wg-man';

const KEY_MAP: Record<string, string> = {
  configDir:       'WG_CONFIG_DIR',
  configPattern:   'WG_CONFIG_PATTERN',
  staticInterface: 'WG_STATIC_INTERFACE',
  checkIp:         'CHECK_IP',
  maxHandshakeAge: 'MAX_HANDSHAKE_AGE',
};

try {
  const raw = readFileSync(path.join(DATA_DIR, 'server-config.json'), 'utf8');
  const overrides = JSON.parse(raw) as Record<string, unknown>;
  for (const [field, envKey] of Object.entries(KEY_MAP)) {
    if (overrides[field] !== undefined) {
      process.env[envKey] = String(overrides[field]);
    }
  }
} catch {
  // no overrides file — .env values are used as-is
}
