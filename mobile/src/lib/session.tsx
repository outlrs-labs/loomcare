import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { request, type User } from './api';
import { preparePushToken } from './push';

export type Mode = 'family' | 'gateway';

interface Session {
  ready: boolean;
  mode: Mode | null;
  server: string;
  token: string | null;
  user: User | null;
  pushStatus: string;
  setMode(mode: Mode | null): Promise<void>;
  signIn(input: { server: string; email: string; password: string; name?: string; invite?: string }): Promise<void>;
  signOut(): Promise<void>;
  api<T>(path: string, body?: unknown, method?: string): Promise<T>;
}

const SessionContext = createContext<Session | null>(null);
const DEFAULT_SERVER = (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? '';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<Mode | null>(null);
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState('Not set up');

  const registerPush = useCallback(async (base: string, bearer: string) => {
    const result = await preparePushToken();
    if ('error' in result) {
      setPushStatus(result.error);
      return;
    }
    await request(base, '/api/push-tokens', { body: result, token: bearer });
    setPushToken(result.token);
    setPushStatus('On for this phone');
  }, []);

  useEffect(() => {
    (async () => {
      const [storedMode, storedServer, storedToken] = await Promise.all([AsyncStorage.getItem('loomcare.mode'), SecureStore.getItemAsync('loomcare.server'), SecureStore.getItemAsync('loomcare.token')]);
      setModeState(storedMode === 'family' || storedMode === 'gateway' ? storedMode : null);
      if (storedServer) setServer(storedServer);
      if (storedServer && storedToken) {
        try {
          const me = await request<{ user: User }>(storedServer, '/api/me', { token: storedToken });
          setToken(storedToken);
          setUser(me.user);
          registerPush(storedServer, storedToken).catch(() => setPushStatus('Could not register this phone for alerts.'));
        } catch (error) {
          if ((error as { status?: number }).status === 401) await SecureStore.deleteItemAsync('loomcare.token');
          else setToken(storedToken);
        }
      }
      setReady(true);
    })();
  }, [registerPush]);

  const setMode = useCallback(async (next: Mode | null) => {
    if (next) await AsyncStorage.setItem('loomcare.mode', next);
    else await AsyncStorage.removeItem('loomcare.mode');
    setModeState(next);
  }, []);

  const signIn = useCallback<Session['signIn']>(async ({ server: base, email, password, name, invite }) => {
    const clean = base.trim().replace(/\/$/, '');
    const result = await request<{ token: string; user: User }>(clean, name ? '/api/mobile/register' : '/api/mobile/login', {
      body: { email: email.trim(), password, device_name: Constants.deviceName ?? 'Phone', ...(name ? { name: name.trim(), ...(invite?.trim() ? { invite: invite.trim() } : {}) } : {}) },
    });
    await Promise.all([SecureStore.setItemAsync('loomcare.server', clean), SecureStore.setItemAsync('loomcare.token', result.token)]);
    setServer(clean);
    setToken(result.token);
    setUser(result.user);
    registerPush(clean, result.token).catch(() => setPushStatus('Could not register this phone for alerts.'));
  }, [registerPush]);

  const signOut = useCallback(async () => {
    if (token) await request(server, '/api/mobile/logout', { body: pushToken ? { push_token: pushToken } : {}, token }).catch(() => undefined);
    await SecureStore.deleteItemAsync('loomcare.token');
    setToken(null);
    setUser(null);
    setPushToken(null);
    setPushStatus('Not set up');
  }, [server, token, pushToken]);

  const api = useCallback(<T,>(path: string, body?: unknown, method?: string) => request<T>(server, path, { body, method, token }), [server, token]);

  const value = useMemo(() => ({ ready, mode, server, token, user, pushStatus, setMode, signIn, signOut, api }), [ready, mode, server, token, user, pushStatus, setMode, signIn, signOut, api]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
