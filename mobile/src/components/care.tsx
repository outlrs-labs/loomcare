import { Alert, View } from 'react-native';

import type { CareEvent, CareState } from '@/lib/api';
import { eventLabel, isUrgent, needsAck, when } from '@/lib/format';
import { Button, Card, Muted, Pill, Row, Strong } from './ui';

export function acknowledge(api: <T>(path: string, body?: unknown) => Promise<T>, event: CareEvent, done: () => void) {
  const send = (note: string) => api(`/api/events/${event.id}/ack`, { note }).then(done).catch((e: Error) => Alert.alert('Not recorded', e.message));
  Alert.alert('Acknowledge alert', 'This stops alerting the next contact. Please make sure someone checks on them.', [
    { text: 'I called them', onPress: () => send('Caregiver called the parent.') },
    { text: 'Someone is going', onPress: () => send('Caregiver arranged for someone to check in person.') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export function EventRow({ event, data, onAck }: { event: CareEvent; data: CareState; onAck?: (event: CareEvent) => void }) {
  const parent = data.devices.find((d) => d.id === event.device_id)?.name ?? 'Parent';
  const tone = isUrgent(event) ? 'alert' : ['missed', 'escalated', 'open'].includes(event.status) ? 'warn' : event.status === 'awaiting' ? 'quiet' : 'ok';
  return (
    <Card tone={isUrgent(event) ? 'alert' : undefined}>
      <Row>
        <Strong>{eventLabel(event)} · {parent}</Strong>
        <Pill label={event.status.replace('_', ' ')} tone={tone} />
      </Row>
      <Muted>{event.kind === 'reminder' ? event.note : event.status === 'acknowledged' ? 'Response recorded' : event.note || 'Recorded by LOOMCARE'}</Muted>
      <Muted>{when(event.received_at)}{event.occurred_at && Math.abs(event.received_at - event.occurred_at) > 60 ? ` · happened ${when(event.occurred_at)}` : ''}</Muted>
      {onAck && needsAck(event) ? (
        <View>
          <Button kind={isUrgent(event) ? 'danger' : 'secondary'} label="Acknowledge" onPress={() => onAck(event)} />
        </View>
      ) : null}
    </Card>
  );
}
