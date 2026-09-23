import { Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';

import { gateway } from './engine';

export function relayRunning() {
  return Platform.OS === 'android' ? BackgroundService.isRunning() : false;
}

export async function startRelay() {
  if (Platform.OS !== 'android') {
    gateway.run().catch(() => undefined);
    return;
  }
  if (BackgroundService.isRunning()) return;
  await BackgroundService.start(() => gateway.run(), {
    taskName: 'loomcare-gateway',
    taskTitle: 'LOOMCARE is keeping the pendant connected',
    taskDesc: 'Pendant alerts will reach your family through this phone.',
    taskIcon: { name: 'ic_launcher', type: 'mipmap' },
    color: '#164B42',
    linkingURI: 'loomcare://gateway',
    foregroundServiceType: ['connectedDevice'],
  });
}

export async function stopRelay() {
  gateway.stop();
  if (Platform.OS === 'android' && BackgroundService.isRunning()) await BackgroundService.stop();
}
