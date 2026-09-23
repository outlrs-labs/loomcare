import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/components/ui';
import { SessionProvider } from '@/lib/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="pair/[deviceId]" options={{ headerShown: true, title: "Set up parent's phone", presentation: 'modal' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
