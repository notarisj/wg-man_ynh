import React from 'react';
import { ArrPlugin } from './ArrPlugin';
import { api, type ArrQueueItem } from '../lib/api';

export const Radarr: React.FC = () => (
  <ArrPlugin
    plugin="radarr"
    label="Radarr"
    fetchQueue={api.radarr.queue}
    removeItem={api.radarr.remove}
    rejectItem={(item: ArrQueueItem) =>
      api.radarr.reject(item.id, item.movieId!)
    }
    searchReleases={(item: ArrQueueItem) =>
      api.radarr.releases(item.movieId!)
    }
    grabRelease={api.radarr.grab}
  />
);
