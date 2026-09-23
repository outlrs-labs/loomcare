import { router } from 'expo-router';
import { Alert, Text } from 'react-native';

import { acknowledge, EventRow } from '@/components/care';
import { Button, Card, colors, Muted, Notice, Pill, Row, Screen, Strong, Title } from '@/components/ui';
import { ago, can, isUrgent, linkState, span } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCare } from '@/lib/useCare';

const KIND = { web: 'Browser', phone: 'Phone', hub: 'Home Hub' } as const;

export default function Family() {
  const { api, user, pushStatus } = useSession();
  const { data, error, refreshing, refresh } = useCare();
  const role = data?.me.household_role;
  const urgent = data?.events.filter(isUrgent) ?? [];

  const checkIn = async (id: string) => {
    try {
      await api(`/api/devices/${id}/checkin`, {});
      Alert.alert('Check-in sent', 'Their pendant will buzz. You will see the reply here within two minutes.');
      refresh();
    } catch (e) {
      Alert.alert('Not sent', e instanceof Error ? e.message : 'Try again.');
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Title sub="Your family’s care, in one calm place.">{`A little closer, ${user?.name.split(' ')[0] ?? ''}.`}</Title>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {urgent.map((event) => data && <EventRow key={event.id} event={event} data={data} onAck={(e) => acknowledge(api, e, refresh)} />)}
      {data && !data.devices.length ? (
        <Card>
          <Strong>No parents added yet</Strong>
          <Muted>{can(role, 'owner') ? 'Add a parent and their pendant from the LOOMCARE web app, then set up their phone here.' : 'The family owner has not added a parent yet.'}</Muted>
        </Card>
      ) : null}
      {data?.devices.map((device) => {
        const gateways = data.gateways.filter((g) => g.device_id === device.id);
        return (
          <Card key={device.id}>
            <Row>
              <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{device.name}</Text>
              <Pill label={linkState(device)} tone={device.online ? 'ok' : device.silent_seconds != null && device.silent_seconds >= device.offline_alert_seconds ? 'alert' : 'quiet'} />
            </Row>
            <Muted>Battery {device.battery == null ? 'unknown' : `${Math.round(device.battery)}%`} · heard {ago(device.last_seen)} · family alert after {span(device.offline_alert_seconds)} of silence</Muted>
            <Muted>{gateways.length ? gateways.map((g) => `${KIND[g.kind]}: ${g.online ? (g.connected ? 'relaying' : 'pendant not heard') : 'offline'}`).join(' · ') : 'No phone or Home Hub connected yet.'}</Muted>
            {device.sensor_ok === 0 ? <Notice tone="alert">Motion sensor fault: fall detection is unavailable.</Notice> : null}
            {can(role, 'caregiver') ? <Button label="Send a check-in" onPress={() => checkIn(device.id)} /> : null}
            {can(role, 'owner') ? <Button kind="secondary" label="Set up parent’s phone or Home Hub" onPress={() => router.push({ pathname: '/pair/[deviceId]', params: { deviceId: device.id } })} /> : null}
          </Card>
        );
      })}
      <Notice tone={pushStatus.startsWith('On') ? 'info' : 'warn'}>Alerts on this phone: {pushStatus}</Notice>
      <Muted>Connectivity is not proof of wellbeing. LOOMCARE does not dispatch emergency services.</Muted>
    </Screen>
  );
}
