import React from 'react';
import { ArrPlugin } from './ArrPlugin';
import { api, type ArrQueueItem } from '../lib/api';

export const Sonarr: React.FC = () => (
  <ArrPlugin
    plugin="sonarr"
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
    searchReleases={(item: ArrQueueItem) =>
      api.sonarr.releases({
        episodeId:    item.episodeId,
        seriesId:     item.seriesId,
        seasonNumber: item.episode?.seasonNumber,
      })
    }
    grabRelease={api.sonarr.grab}
  />
);
