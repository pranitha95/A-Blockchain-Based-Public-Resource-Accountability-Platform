import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import type { MetaResponse } from '../../types';

interface MetaContextValue {
  meta: MetaResponse | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

const MetaContext = createContext<MetaContextValue | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => api.get<MetaResponse>('/meta'),
    staleTime: 60_000,
    retry: 1,
  });

  const value = useMemo<MetaContextValue>(
    () => ({
      meta: query.data ?? null,
      loading: query.isLoading,
      error: query.error instanceof Error ? query.error : null,
      refetch: () => {
        void query.refetch();
      },
    }),
    [query.data, query.isLoading, query.error, query.refetch],
  );

  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta(): MetaContextValue {
  const context = useContext(MetaContext);
  if (!context) throw new Error('useMeta must be used inside MetaProvider');
  return context;
}
