import React from 'react';
import { Film } from 'lucide-react';
import { ArrPlugin } from './ArrPlugin';
import { api, type ArrQueueItem } from '../lib/api';

export const Radarr: React.FC = () => (
  <ArrPlugin
    plugin="radarr"
    icon={<Film size={20} />}
    label="Radarr"
    fetchQueue={api.radarr.queue}
    removeItem={api.radarr.remove}
    rejectItem={(item: ArrQueueItem) =>
      api.radarr.reject(item.id, item.movieId!)
    }
  />
);
