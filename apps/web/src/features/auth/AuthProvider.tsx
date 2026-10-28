import type { SessionUser } from '@poi/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  signOut: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.get<SessionUser | null>('/auth/me'),
    retry: false,
    staleTime: 30_000,
  });

  const setUser = useCallback(
    (user: SessionUser | null) => {
      queryClient.setQueryData(queryKeys.session, user);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.session, null);
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: sessionQuery.data ?? null,
      loading: sessionQuery.isLoading,
      error: sessionQuery.error instanceof Error ? sessionQuery.error : null,
      refetch: () => {
        void sessionQuery.refetch();
      },
      signOut,
      setUser,
    }),
    [sessionQuery.data, sessionQuery.isLoading, sessionQuery.error, sessionQuery.refetch, signOut, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
