export type Role = 'owner' | 'caregiver' | 'viewer';

export interface User {
  id: string;
  household_id: string | null;
  name: string;
  email: string;
  role: 'caregiver' | 'operator';
  household_role: Role | null;
  team_role: 'admin' | 'support' | null;
}

export interface Device {
  id: string;
  name: string;
  mode: 'simulator' | 'physical';
  online: boolean;
  battery: number | null;
  charging: number | null;
  last_seen: number | null;
  silent_seconds: number | null;
  offline_alert_seconds: number;
  escalation_seconds: number;
  sensor_ok: number | null;
  clock_ok: number | null;
  firmware: string;
}

export interface Gateway {
  id: string;
  device_id: string;
  name: string;
  kind: 'web' | 'phone' | 'hub';
  online: boolean;
  connected: number;
  last_seen: number | null;
}

export interface CareEvent {
  id: string;
  device_id: string;
  kind: string;
  status: string;
  note: string;
  received_at: number;
  occurred_at: number | null;
}

export interface Reminder {
  id: string;
  device_id: string;
  label: string;
  minute: number;
  enabled: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  household_role: Role;
  created_at: number;
}

export interface CareState {
  devices: Device[];
  gateways: Gateway[];
  events: CareEvent[];
  reminders: Reminder[];
  members: Member[];
  me: User;
  push_enabled: boolean;
  now: number;
}

export interface SyncResult {
  accepted: string[];
  reminders: { id: string; label: string; minute: number; enabled: number }[];
  commands: { id: string; event_id: string; expires_at: number }[];
  now: number;
  device: { id: string; name: string; mode: string };
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function request<T>(server: string, path: string, options: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(server.replace(/\/$/, '') + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error instanceof Error && error.name === 'AbortError' ? 'LOOMCARE did not respond. Try again.' : 'Cannot reach LOOMCARE. Check your internet connection.', 0);
  } finally {
    clearTimeout(timer);
  }
}
