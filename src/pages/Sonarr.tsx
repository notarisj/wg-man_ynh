import React from 'react';
import { Tv } from 'lucide-react';
import { ArrPlugin } from './ArrPlugin';
import { api, type ArrQueueItem } from '../lib/api';

export const Sonarr: React.FC = () => (
  <ArrPlugin
    plugin="sonarr"
    icon={<Tv size={20} />}
    label="Sonarr"
    fetchQueue={api.sonarr.queue}
    removeItem={api.sonarr.remove}
    rejectItem={(item: ArrQueueItem) =>
      api.sonarr.reject(item.id, {
        episodeId:    item.episodeId,
        seriesId:     item.seriesId,
        seasonNumber: item.episode?.seasonNumber,
      })
    }
  />
);
