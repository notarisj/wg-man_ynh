import { create } from 'zustand';
import { api } from '../lib/api';

export type PluginSafe = {
  enabled: boolean; host: string; port: number; https: boolean;
  hasPassword?: boolean; hasApiKey?: boolean; hasUsername?: boolean; username?: string;
};

interface PluginStore {
  plugins: Record<string, PluginSafe> | null;
  fetchPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set) => ({
  plugins: null,
  fetchPlugins: async () => {
    const res = await api.plugins.config();
    if (res.ok) set({ plugins: res.data });
  },
}));
