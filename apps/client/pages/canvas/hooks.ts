import { useQuery } from '@tanstack/react-query';

import { client } from '../../lib/api';
import type { UserColumn } from './utils';

export function useUserColumns() {
  return useQuery({
    queryKey: ['user-columns'],
    queryFn: async () => {
      const res = await client['user-columns'].$get();
      const data = await res.json();
      return data.columns as UserColumn[];
    },
  });
}

export function useEventNames() {
  return useQuery({
    queryKey: ['event-names'],
    queryFn: async () => {
      const res = await client['event-names'].$get();
      const data = await res.json();
      return data.event_names as string[];
    },
  });
}
