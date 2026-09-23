import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';

import { Button, Card, Choice, Muted, Notice, Pill, Row, Screen, Strong, Title } from '@/components/ui';
import type { Role } from '@/lib/api';
import { can } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCare } from '@/lib/useCare';

const HELP: Record<Role, string> = { owner: 'Parents, phones, members and settings', caregiver: 'Reminders, contacts and check-ins', viewer: 'Sees updates and can acknowledge alerts' };

export default function Circle() {
  const { api, signOut, setMode, server, pushStatus } = useSession();
  const { data, error, refreshing, refresh } = useCare();
  const [role, setRole] = useState<'caregiver' | 'viewer'>('caregiver');
  const [busy, setBusy] = useState(false);
  const owner = can(data?.me.household_role, 'owner');

  const invite = async () => {
    setBusy(true);
    try {
      const result = await api<{ code: string }>('/api/invites', { role });
      await Share.share({ message: `Join our family on LOOMCARE. Create an account in the LOOMCARE app and enter invite code ${result.code}. It works once and expires in 7 days.` });
      refresh();
    } catch (e) {
      Alert.alert('No invite created', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async (switchToGateway: boolean) => {
    await signOut();
    if (switchToGateway) {
      await setMode(null);
      router.replace('/welcome');
    } else router.replace('/sign-in');
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Title sub="Everyone who helps, each with the right access.">Care Circle</Title>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {data?.members.map((m) => (
        <Card key={m.id}>
          <Row>
            <Strong>{m.name}{m.id === data.me.id ? ' (you)' : ''}</Strong>
            <Pill label={m.household_role} tone={m.household_role === 'owner' ? 'ok' : 'quiet'} />
          </Row>
          <Muted>{m.email} · {HELP[m.household_role]}</Muted>
        </Card>
      ))}
      {owner ? (
        <Card>
          <Strong>Invite someone</Strong>
          <Choice options={[{ value: 'caregiver', label: 'Caregiver' }, { value: 'viewer', label: 'Viewer' }]} value={role} onChange={setRole} />
          <Muted>{HELP[role]}. They get alerts on their own phone.</Muted>
          <Button label="Create and share invite code" onPress={invite} busy={busy} />
        </Card>
      ) : null}
      <Card>
        <Strong>This phone</Strong>
        <Muted>Alerts: {pushStatus}</Muted>
        <Muted>Server: {server}</Muted>
        <Button kind="secondary" label="Sign out" onPress={() => leave(false)} />
        <Button kind="secondary" label="Use this phone as a parent’s phone instead" onPress={() => leave(true)} />
      </Card>
    </Screen>
  );
}
