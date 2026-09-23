import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Index() {
  const { ready, mode, token } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }
  if (mode === 'gateway') return <Redirect href="/gateway" />;
  if (mode === 'family') return <Redirect href={token ? '/(family)' : '/sign-in'} />;
  return <Redirect href="/welcome" />;
}
