import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, Card, Field, Muted, Notice, Screen, Title } from '@/components/ui';
import { savePairing } from '@/gateway/engine';
import { parsePairing } from '@/lib/protocol';
import { useSession } from '@/lib/session';

export default function GatewayPair() {
  const params = useLocalSearchParams<{ server?: string; token?: string }>();
  const { setMode } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState('');
  const handled = useRef(false);
  const fromLink = params.server && params.token ? parsePairing(`?server=${encodeURIComponent(params.server)}&token=${encodeURIComponent(params.token)}`) : null;

  const accept = async (pairing: { server: string; token: string } | null) => {
    if (!pairing) return Alert.alert('Not a LOOMCARE pairing code', 'Create a new code in the family app and try again.');
    await savePairing(pairing.server, pairing.token);
    await setMode('gateway');
    router.replace('/gateway');
  };

  return (
    <Screen>
      <Title sub="Links this phone to one pendant so its alerts reach the family.">Pair this phone</Title>
      {fromLink ? (
        <Card>
          <Muted>Pair with the LOOMCARE server at {fromLink.server}?</Muted>
          <Button label="Pair this phone" onPress={() => accept(fromLink)} />
        </Card>
      ) : null}
      <Card>
        <Muted>Ask a family member to open LOOMCARE → Family → “Set up parent’s phone”, then scan their code.</Muted>
        {scanning && permission?.granted ? (
          <View style={{ height: 320, borderRadius: 16, overflow: 'hidden' }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(result) => {
              if (handled.current) return;
              handled.current = true;
              setScanning(false);
              accept(parsePairing(result.data)).finally(() => (handled.current = false));
            }} />
          </View>
        ) : (
          <Button label="Scan pairing QR code" onPress={async () => { if (permission?.granted || (await requestPermission()).granted) setScanning(true); else Alert.alert('Camera needed', 'Allow camera access to scan the code, or paste the link below.'); }} />
        )}
      </Card>
      <Card>
        <Field label="Or paste the pairing link" value={pasted} onChangeText={setPasted} autoCapitalize="none" autoCorrect={false} placeholder="loomcare://gateway-pair?..." />
        <Button kind="secondary" label="Use pasted link" onPress={() => accept(parsePairing(pasted))} disabled={!pasted} />
      </Card>
      <Notice>The code works like a password. Only pair a phone that stays with your parent.</Notice>
    </Screen>
  );
}
