import { useQuery } from '@tanstack/react-query';

import { client } from '../../lib/api';
import type { UserColumn } from './utils';

export interface EventDefinition {
  id: string;
  name: string;
  source: 'customer_api' | 'posthog';
  enabledAsTrigger: boolean;
}

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

export function useEventDefinitions() {
  return useQuery({
    queryKey: ['event-definitions'],
    queryFn: async () => {
      const res = await client['event-definitions'].$get();
      const data = await res.json();
      return data.event_definitions as EventDefinition[];
    },
  });
}
