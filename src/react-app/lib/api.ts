import { hc } from 'hono/client';
import { QueryClient } from '@tanstack/react-query';
import type { AppType } from '../../../server/functions/admin/index';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export const client = hc<AppType>(import.meta.env.VITE_API_URL || '');
