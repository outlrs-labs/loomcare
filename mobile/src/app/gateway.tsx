import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Text } from 'react-native';

import { Button, Card, colors, Field, Muted, Notice, Pill, Row, Screen, Strong, Title } from '@/components/ui';
import { clearPairing, gateway, type GatewayStatus } from '@/gateway/engine';
import { startRelay, stopRelay } from '@/gateway/service';
import { ago } from '@/lib/format';
import { useSession } from '@/lib/session';

const PENDANT: Record<GatewayStatus['pendant'], [string, 'ok' | 'warn' | 'alert' | 'quiet']> = {
  idle: ['Not started', 'quiet'],
  'permission-needed': ['Bluetooth permission needed', 'alert'],
  'bluetooth-off': ['Bluetooth is off', 'alert'],
  searching: ['Looking for the pendant', 'warn'],
  connecting: ['Connecting', 'warn'],
  connected: ['Pendant connected', 'ok'],
};
const CLOUD: Record<GatewayStatus['cloud'], [string, 'ok' | 'warn' | 'alert' | 'quiet']> = {
  unpaired: ['Not paired', 'quiet'],
  connecting: ['Connecting', 'warn'],
  ok: ['Family connected', 'ok'],
  offline: ['No internet — alerts are queued', 'warn'],
  revoked: ['Pairing removed by family', 'alert'],
};

export default function GatewayHome() {
  const { setMode } = useSession();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = gateway.subscribe(setStatus);
    gateway.load().then((paired) => {
      if (paired) startRelay().catch(() => undefined);
    });
    return unsubscribe;
  }, []);

  if (status && !status.paired) {
    return (
      <Screen>
        <Title sub="This phone will quietly connect to the pendant and pass its alerts to the family.">Set up parent’s phone</Title>
        <Button label="Pair with the family" onPress={() => router.push('/gateway-pair')} />
        <Button kind="secondary" label="Back" onPress={async () => { await setMode(null); router.replace('/welcome'); }} />
      </Screen>
    );
  }

  const pairPendant = async () => {
    setBusy(true);
    try {
      await gateway.pairPendant(pin);
      await startRelay();
      setPin('');
    } catch (e) {
      Alert.alert('Pendant not paired', e instanceof Error ? e.message : 'Try again next to the pendant.');
    } finally {
      setBusy(false);
    }
  };

  const unpair = () => Alert.alert('Stop relaying?', 'The pendant will keep working on its own, but alerts will not reach the family through this phone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unpair this phone', style: 'destructive', onPress: async () => { await stopRelay(); await clearPairing(); await setMode(null); router.replace('/welcome'); } },
  ]);

  const [pendantLabel, pendantTone] = PENDANT[status?.pendant ?? 'idle'];
  const [cloudLabel, cloudTone] = CLOUD[status?.cloud ?? 'connecting'];
  return (
    <Screen>
      <Card tone="dark">
        <Text style={{ color: colors.white, fontSize: 26, fontWeight: '700' }}>{status?.parentName ? `Keeping ${status.parentName} connected` : 'LOOMCARE gateway'}</Text>
        <Text style={{ color: '#BDD1C4', fontSize: 15, lineHeight: 22 }}>Nothing to do here. Keep this phone charged, with Bluetooth on, near the pendant.</Text>
      </Card>
      <Card>
        <Row><Strong>Pendant</Strong><Pill label={pendantLabel} tone={pendantTone} /></Row>
        <Row><Strong>Family</Strong><Pill label={cloudLabel} tone={cloudTone} /></Row>
        <Muted>Last update sent {status?.lastSync ? ago(status.lastSync / 1000) : 'not yet'} · {status?.queued ?? 0} waiting to send{status?.battery != null ? ` · pendant battery ${status.battery}%` : ''}</Muted>
      </Card>
      {status?.pendant === 'permission-needed' || status?.pendant === 'bluetooth-off' ? <Notice tone="alert">Turn on Bluetooth and allow LOOMCARE to use it, otherwise alerts cannot reach the family.</Notice> : null}
      {status?.cloud === 'revoked' ? <Notice tone="alert">The family removed this phone. Ask them for a new pairing code.</Notice> : null}
      <Card>
        <Strong>First time with this pendant?</Strong>
        <Muted>Hold the phone next to the pendant. {Platform.OS === 'android' ? 'Enter the pendant’s 6-digit Bluetooth PIN chosen during setup.' : 'iPhone will ask for the 6-digit PIN chosen during setup.'}</Muted>
        {Platform.OS === 'android' ? <Field label="Pendant PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry /> : null}
        <Button label="Connect pendant" onPress={pairPendant} busy={busy} disabled={Platform.OS === 'android' && pin.length !== 6} />
      </Card>
      <Card>
        <Strong>Keep it reliable</Strong>
        <Muted>Phone makers like Xiaomi, Oppo, Vivo, Realme and Samsung may stop background apps. Allow LOOMCARE to run in the background and turn off battery optimisation for it.</Muted>
        <Button kind="secondary" label="Open app settings" onPress={() => Linking.openSettings()} />
        {Platform.OS === 'ios' ? <Muted>iPhone may pause LOOMCARE in the background. A Home Hub gives the most dependable coverage at home.</Muted> : null}
      </Card>
      <Button kind="secondary" label={status?.running ? 'Restart connection' : 'Start connection'} onPress={async () => { await stopRelay(); await startRelay(); }} />
      <Button kind="danger" label="Unpair this phone" onPress={unpair} />
    </Screen>
  );
}
