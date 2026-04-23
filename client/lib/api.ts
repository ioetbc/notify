import { hc } from 'hono/client';
import { QueryClient } from '@tanstack/react-query';
import type { AppType } from '../../server/functions/admin/index';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

export const client = hc<AppType>(import.meta.env.VITE_API_URL || '', {
  headers: {
    'X-Customer-Id': CUSTOMER_ID,
  },
});
