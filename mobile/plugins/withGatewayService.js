const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';

module.exports = function withGatewayService(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK',
  ]);
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    const services = (application.service = application.service || []);
    const existing = services.find((service) => service.$['android:name'] === SERVICE);
    const attributes = { 'android:name': SERVICE, 'android:foregroundServiceType': 'connectedDevice', 'android:exported': 'false' };
    if (existing) Object.assign(existing.$, attributes);
    else services.push({ $: attributes });
    return mod;
  });
};
