import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export async function preparePushToken(): Promise<{ token: string; platform: 'ios' | 'android' } | { error: string }> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('urgent', { name: 'Falls and SOS', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400], bypassDnd: true });
    await Notifications.setNotificationChannelAsync('default', { name: 'Care updates', importance: Notifications.AndroidImportance.DEFAULT });
  }
  if (!Device.isDevice) return { error: 'Push alerts need a physical phone.' };
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.status === 'granted' ? existing.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { error: 'Notifications are turned off for LOOMCARE.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { error: 'Push is not configured for this build yet (missing EAS project ID).' };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
  } catch {
    return { error: 'Could not register for push alerts on this phone.' };
  }
}
