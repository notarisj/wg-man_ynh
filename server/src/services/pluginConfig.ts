import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const DATA_DIR   = process.env.DATA_DIR || '/var/lib/wg-man';
const CONFIG_FILE = path.join(DATA_DIR, 'plugins.json');

export interface PluginConfig {
  enabled:   boolean;
  host:      string;
  port:      number;
  https:     boolean;
  username?: string; // qBittorrent
  password?: string; // qBittorrent
  apiKey?:   string; // Radarr / Sonarr
}

export interface PluginsConfig {
  qbittorrent: PluginConfig;
  radarr:      PluginConfig;
  sonarr:      PluginConfig;
}

const DEFAULTS: PluginsConfig = {
  qbittorrent: { enabled: false, host: 'localhost', port: 8080, https: false },
  radarr:      { enabled: false, host: 'localhost', port: 7878, https: false },
  sonarr:      { enabled: false, host: 'localhost', port: 8989, https: false },
};

export async function loadPluginsConfig(): Promise<PluginsConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    const saved = JSON.parse(raw) as Partial<PluginsConfig>;
    return {
      qbittorrent: { ...DEFAULTS.qbittorrent, ...saved.qbittorrent },
      radarr:      { ...DEFAULTS.radarr,      ...saved.radarr      },
      sonarr:      { ...DEFAULTS.sonarr,      ...saved.sonarr      },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function savePluginsConfig(config: PluginsConfig): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o640 });
}

/** Strip secrets for API responses — never send passwords/apiKeys to the browser */
export function sanitizeConfig(config: PluginsConfig): Record<string, unknown> {
  const mask = (cfg: PluginConfig) => ({
    enabled:     cfg.enabled,
    host:        cfg.host,
    port:        cfg.port,
    https:       cfg.https,
    hasPassword: !!cfg.password,
    hasApiKey:   !!cfg.apiKey,
    hasUsername: !!cfg.username,
    username:    cfg.username ?? '',
  });
  return {
    qbittorrent: mask(config.qbittorrent),
    radarr:      mask(config.radarr),
    sonarr:      mask(config.sonarr),
  };
}
