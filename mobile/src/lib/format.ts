import type { CareEvent, Device, Role } from './api';

const LABELS: Record<string, string> = {
  fall: 'Possible fall',
  sos: 'SOS pressed',
  checkin: 'Family check-in',
  reminder: 'Reminder',
  fall_cancelled: 'Fall warning cancelled',
  low_battery: 'Time to charge',
  disconnected: 'Pendant out of reach',
  device_fault: 'Pendant needs attention',
};

export const RANK: Record<Role, number> = { viewer: 0, caregiver: 1, owner: 2 };
export const can = (role: Role | null | undefined, min: Role) => RANK[role ?? 'viewer'] >= RANK[min];
export const eventLabel = (event: CareEvent) => LABELS[event.kind] ?? event.kind;
export type EventSeverity = 'informational' | 'warning' | 'critical';
export const eventSeverity = (event: CareEvent): EventSeverity => {
  if (['fall', 'sos'].includes(event.kind) && ['open', 'escalated', 'missed'].includes(event.status)) return 'critical';
  if (['low_battery', 'disconnected', 'device_fault'].includes(event.kind) && ['open', 'escalated', 'missed'].includes(event.status)) return 'warning';
  if (['checkin', 'reminder'].includes(event.kind) && event.status === 'missed') return 'warning';
  return 'informational';
};
export const isUrgent = (event: CareEvent) => eventSeverity(event) === 'critical';
export const needsAck = (event: CareEvent) => ['open', 'escalated', 'missed'].includes(event.status) && !['reminder', 'checkin', 'fall_cancelled'].includes(event.kind);
export const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function span(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function ago(epoch: number | null | undefined) {
  if (!epoch) return 'never';
  const seconds = Date.now() / 1000 - epoch;
  return seconds < 60 ? 'just now' : `${span(seconds)} ago`;
}

export function when(epoch: number) {
  return new Date(epoch * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function linkState(device: Device) {
  if (device.online) return 'Connected';
  if (device.silent_seconds != null) return `Silent ${span(device.silent_seconds)}`;
  return 'Not connected yet';
}
