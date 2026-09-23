import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button, Card, colors, Muted, Screen, Strong, Title } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Welcome() {
  const { setMode, token } = useSession();
  return (
    <Screen>
      <Card tone="dark">
        <Text style={{ color: '#BACC9A', fontWeight: '700', letterSpacing: 1.6, fontSize: 12 }}>LOOMCARE</Text>
        <Text style={{ color: colors.white, fontSize: 30, fontWeight: '700', letterSpacing: -1 }}>Independent lives. A closer connection.</Text>
        <Text style={{ color: '#BDD1C4', fontSize: 15, lineHeight: 22 }}>A simple pendant for your parents. Calm, timely updates for the family.</Text>
      </Card>
      <Title sub="You can change this later.">How will this phone be used?</Title>
      <Card>
        <Strong>I look after a parent</Strong>
        <Muted>See how your parents are, send check-ins, manage reminders, and get alerted if something happens.</Muted>
        <Button label="Use as family app" onPress={async () => { await setMode('family'); router.replace(token ? '/(family)' : '/sign-in'); }} />
      </Card>
      <Card>
        <Strong>This is my parent’s phone</Strong>
        <Muted>The phone quietly connects to the pendant and passes alerts to the family. Your parent doesn’t need to do anything.</Muted>
        <View style={{ gap: 8 }}>
          <Button kind="secondary" label="Set up as parent’s phone" onPress={async () => { await setMode('gateway'); router.replace('/gateway'); }} />
        </View>
      </Card>
      <Muted>LOOMCARE is not a medical device and does not call emergency services by itself.</Muted>
    </Screen>
  );
}
