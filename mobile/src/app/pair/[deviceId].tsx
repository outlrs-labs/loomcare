import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Card, Choice, Muted, Notice, Screen, Strong, Title } from '@/components/ui';
import { pairingLink } from '@/lib/protocol';
import { useSession } from '@/lib/session';

export default function PairParentPhone() {
  const { deviceId } = useLocalSearchParams<{ deviceId: string }>();
  const { api, server } = useSession();
  const [kind, setKind] = useState<'phone' | 'hub'>('phone');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const result = await api<{ token: string }>(`/api/devices/${deviceId}/gateways`, { kind });
      setLink(pairingLink(server, result.token));
    } catch (e) {
      Alert.alert('Could not create a pairing code', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title sub="The parent’s phone (or a Home Hub) relays pendant alerts to the family. Add both for the best coverage.">Connect a gateway</Title>
      {!link ? (
        <Card>
          <Choice options={[{ value: 'phone', label: 'Parent’s phone' }, { value: 'hub', label: 'Home Hub' }]} value={kind} onChange={setKind} />
          <Muted>On the parent’s phone, install LOOMCARE, choose “This is my parent’s phone”, then scan the code you create here.</Muted>
          <Button label="Create pairing code" onPress={create} busy={busy} />
        </Card>
      ) : (
        <Card>
          <Strong>Scan this on the parent’s phone</Strong>
          <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#fff' }}>
            <QRCode value={link} size={240} />
          </View>
          <Notice tone="warn">This code works like a password for the pendant. Show it only to the phone being set up. Remove old gateways from the web app if a phone is lost.</Notice>
          <Button kind="secondary" label="Copy pairing link instead" onPress={async () => { await Clipboard.setStringAsync(link); Alert.alert('Copied', 'Paste it only on the parent’s phone.'); }} />
        </Card>
      )}
    </Screen>
  );
}
