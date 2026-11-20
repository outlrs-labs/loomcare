import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { colors } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function FamilyTabs() {
  const { token, ready } = useSession();
  if (ready && !token) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted, tabBarLabelStyle: { fontSize: 13, fontWeight: '600' }, tabBarIconStyle: { display: 'none' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="timeline" options={{ title: 'Activity' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="reminders" options={{ title: 'Reminders' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="circle" options={{ href: null }} />
    </Tabs>
  );
}
