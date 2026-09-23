import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, Card, Choice, Field, Muted, Notice, Pill, Row, Screen, Strong, Title } from '@/components/ui';
import { can, hhmm } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCare } from '@/lib/useCare';

export default function Reminders() {
  const { api } = useSession();
  const { data, error, refreshing, refresh } = useCare();
  const [picked, setDevice] = useState('');
  const [label, setLabel] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = can(data?.me.household_role, 'caregiver');
  const device = picked || data?.devices[0]?.id || '';

  const add = async () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return Alert.alert('Check the time', 'Use 24-hour HH:MM, for example 08:30 or 21:00.');
    setBusy(true);
    try {
      await api(`/api/devices/${device}/reminders`, { label, time });
      setLabel('');
      setTime('');
      refresh();
    } catch (e) {
      Alert.alert('Not saved', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, enabled: boolean) => api(`/api/reminders/${id}`, { enabled: !enabled }, 'PATCH').then(() => refresh()).catch((e: Error) => Alert.alert('Not changed', e.message));

  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Title sub="Daily, in India Standard Time. The pendant stores them, so they work offline.">Reminders</Title>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      <Notice>A button press records “reminder acknowledged”. It does not prove medicine was taken.</Notice>
      {editable && data?.devices.length ? (
        <Card>
          <Strong>Add a daily reminder</Strong>
          <Choice options={data.devices.map((d) => ({ value: d.id, label: d.name }))} value={device} onChange={setDevice} />
          <Field label="What is it for?" value={label} onChangeText={setLabel} placeholder="Evening tablets" maxLength={80} />
          <Field label="Time (24-hour HH:MM)" value={time} onChangeText={setTime} placeholder="21:00" keyboardType="numbers-and-punctuation" maxLength={5} />
          <Button label="Save reminder" onPress={add} busy={busy} disabled={!label.trim() || !time || !device} />
        </Card>
      ) : null}
      {data?.reminders.map((r) => (
        <Card key={r.id}>
          <Row>
            <Strong>{hhmm(r.minute)} · {r.label}</Strong>
            <Pill label={r.enabled ? 'Active' : 'Paused'} tone={r.enabled ? 'ok' : 'quiet'} />
          </Row>
          <Muted>{data.devices.find((d) => d.id === r.device_id)?.name ?? 'Parent'} · every day</Muted>
          {editable ? <Button kind="secondary" label={r.enabled ? 'Pause' : 'Resume'} onPress={() => toggle(r.id, !!r.enabled)} /> : null}
        </Card>
      ))}
      {data && !data.reminders.length ? <Muted>No reminders yet. Up to eight per pendant.</Muted> : null}
    </Screen>
  );
}
