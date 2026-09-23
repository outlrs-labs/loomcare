import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { CareState } from './api';
import { useSession } from './session';

export function useCare() {
  const { api } = useSession();
  const [data, setData] = useState<CareState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setRefreshing(true);
    try {
      setData(await api<CareState>('/api/state'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load updates.');
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]));

  return { data, error, refreshing, refresh };
}
