/**
 * Plain descriptions for the most common Android permissions. Used by
 * `PermissionHoverProvider` to turn `Manifest.permission.CAMERA` or an
 * `"android.permission.CAMERA"` string into useful context on hover.
 *
 * Dictionary is intentionally static, same trade off as
 * `suppressDescriptions.ts`: rare permissions fall through to no hover.
 * Protection levels follow the platform docs:
 *   normal:    granted at install, no user prompt
 *   dangerous: requires a runtime request
 *   special:   granted via a dedicated system settings screen, not a dialog
 *   signature: only for apps signed with the platform key
 */
export interface PermissionDescription {
  description: string;
  protection: 'normal' | 'dangerous' | 'special' | 'signature';
  /** Deprecations and API level behavior changes worth knowing at a glance. */
  note?: string;
}

export const PERMISSION_DESCRIPTIONS: Record<string, PermissionDescription> = {
  // ── Camera and microphone ─────────────────────────────────────────────────
  CAMERA: {
    description: 'Allows the app to access the camera to take photos and record video.',
    protection: 'dangerous',
  },
  RECORD_AUDIO: {
    description: 'Allows the app to record audio with the microphone.',
    protection: 'dangerous',
  },

  // ── Location ──────────────────────────────────────────────────────────────
  ACCESS_FINE_LOCATION: {
    description: 'Allows the app to get the precise location of the device from GPS and network sources.',
    protection: 'dangerous',
  },
  ACCESS_COARSE_LOCATION: {
    description: 'Allows the app to get the approximate location of the device, about a city block.',
    protection: 'dangerous',
  },
  ACCESS_BACKGROUND_LOCATION: {
    description: 'Allows the app to access location while in the background.',
    protection: 'dangerous',
    note: 'API 30+: must be requested separately, after a foreground location grant.',
  },

  // ── Contacts, calendar, accounts ──────────────────────────────────────────
  READ_CONTACTS: {
    description: 'Allows the app to read the contacts stored on the device.',
    protection: 'dangerous',
  },
  WRITE_CONTACTS: {
    description: 'Allows the app to modify or delete contacts stored on the device.',
    protection: 'dangerous',
  },
  GET_ACCOUNTS: {
    description: 'Allows the app to list the accounts registered in the Account Manager.',
    protection: 'dangerous',
    note: 'API 26+: no longer required to list accounts owned by the calling app.',
  },
  READ_CALENDAR: {
    description: 'Allows the app to read calendar events and details.',
    protection: 'dangerous',
  },
  WRITE_CALENDAR: {
    description: 'Allows the app to add or modify calendar events.',
    protection: 'dangerous',
  },

  // ── Telephony and SMS ─────────────────────────────────────────────────────
  READ_PHONE_STATE: {
    description: 'Allows the app to read the phone state: network info, ongoing call status.',
    protection: 'dangerous',
  },
  READ_PHONE_NUMBERS: {
    description: 'Allows the app to read the phone numbers of the device.',
    protection: 'dangerous',
  },
  CALL_PHONE: {
    description: 'Allows the app to start a phone call without going through the Dialer UI.',
    protection: 'dangerous',
  },
  ANSWER_PHONE_CALLS: {
    description: 'Allows the app to answer an incoming phone call programmatically.',
    protection: 'dangerous',
  },
  READ_CALL_LOG: {
    description: 'Allows the app to read the call log of the device.',
    protection: 'dangerous',
  },
  WRITE_CALL_LOG: {
    description: 'Allows the app to modify the call log of the device.',
    protection: 'dangerous',
  },
  READ_SMS: {
    description: 'Allows the app to read SMS messages stored on the device.',
    protection: 'dangerous',
  },
  SEND_SMS: {
    description: 'Allows the app to send SMS messages, which may incur charges.',
    protection: 'dangerous',
  },
  RECEIVE_SMS: {
    description: 'Allows the app to receive and process incoming SMS messages.',
    protection: 'dangerous',
  },

  // ── Sensors and activity ──────────────────────────────────────────────────
  BODY_SENSORS: {
    description: 'Allows the app to access body sensor data such as heart rate.',
    protection: 'dangerous',
  },
  ACTIVITY_RECOGNITION: {
    description: 'Allows the app to recognize physical activity: walking, biking, in a vehicle.',
    protection: 'dangerous',
    note: 'API 29+. Before that, the AndroidX equivalent came from Google Play services.',
  },
  HIGH_SAMPLING_RATE_SENSORS: {
    description: 'Allows the app to sample motion sensors at rates above 200 Hz.',
    protection: 'normal',
    note: 'API 31+.',
  },

  // ── Storage and media ─────────────────────────────────────────────────────
  READ_EXTERNAL_STORAGE: {
    description: 'Allows the app to read from shared external storage.',
    protection: 'dangerous',
    note: 'API 33+: has no effect. Use READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, or READ_MEDIA_AUDIO.',
  },
  WRITE_EXTERNAL_STORAGE: {
    description: 'Allows the app to write to shared external storage.',
    protection: 'dangerous',
    note: 'API 30+: has no effect. Scoped storage applies; use MediaStore or SAF instead.',
  },
  MANAGE_EXTERNAL_STORAGE: {
    description: 'Grants broad access to all files in shared storage.',
    protection: 'special',
    note: 'Granted in system settings. Play Store restricts it to approved app categories.',
  },
  READ_MEDIA_IMAGES: {
    description: 'Allows the app to read image files from shared storage.',
    protection: 'dangerous',
    note: 'API 33+ replacement for READ_EXTERNAL_STORAGE.',
  },
  READ_MEDIA_VIDEO: {
    description: 'Allows the app to read video files from shared storage.',
    protection: 'dangerous',
    note: 'API 33+ replacement for READ_EXTERNAL_STORAGE.',
  },
  READ_MEDIA_AUDIO: {
    description: 'Allows the app to read audio files from shared storage.',
    protection: 'dangerous',
    note: 'API 33+ replacement for READ_EXTERNAL_STORAGE.',
  },
  READ_MEDIA_VISUAL_USER_SELECTED: {
    description: 'Allows the app to read only the photos and videos the user selected in the photo picker prompt.',
    protection: 'dangerous',
    note: 'API 34+. Granted alongside partial access to visual media.',
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  POST_NOTIFICATIONS: {
    description: 'Allows the app to post notifications.',
    protection: 'dangerous',
    note: 'API 33+. Earlier versions grant it implicitly.',
  },

  // ── Bluetooth and nearby devices ──────────────────────────────────────────
  BLUETOOTH: {
    description: 'Allows the app to connect to paired Bluetooth devices.',
    protection: 'normal',
    note: 'API 31+: superseded by BLUETOOTH_CONNECT and BLUETOOTH_SCAN.',
  },
  BLUETOOTH_ADMIN: {
    description: 'Allows the app to discover and pair Bluetooth devices.',
    protection: 'normal',
    note: 'API 31+: superseded by BLUETOOTH_CONNECT and BLUETOOTH_SCAN.',
  },
  BLUETOOTH_CONNECT: {
    description: 'Allows the app to connect to paired Bluetooth devices.',
    protection: 'dangerous',
    note: 'API 31+.',
  },
  BLUETOOTH_SCAN: {
    description: 'Allows the app to discover and pair nearby Bluetooth devices.',
    protection: 'dangerous',
    note: 'API 31+. Add neverForLocation if scan results are not used to derive location.',
  },
  BLUETOOTH_ADVERTISE: {
    description: 'Allows the app to advertise to nearby Bluetooth devices.',
    protection: 'dangerous',
    note: 'API 31+.',
  },
  NEARBY_WIFI_DEVICES: {
    description: 'Allows the app to interact with nearby devices over WiFi.',
    protection: 'dangerous',
    note: 'API 33+. Replaces location permissions for WiFi device discovery.',
  },
  NFC: {
    description: 'Allows the app to communicate over Near Field Communication.',
    protection: 'normal',
  },
  UWB_RANGING: {
    description: 'Allows the app to measure distance to nearby ultra wideband devices.',
    protection: 'dangerous',
    note: 'API 31+.',
  },

  // ── Network ───────────────────────────────────────────────────────────────
  INTERNET: {
    description: 'Allows the app to open network sockets.',
    protection: 'normal',
  },
  ACCESS_NETWORK_STATE: {
    description: 'Allows the app to read network connectivity information.',
    protection: 'normal',
  },
  ACCESS_WIFI_STATE: {
    description: 'Allows the app to read WiFi network information.',
    protection: 'normal',
  },
  CHANGE_WIFI_STATE: {
    description: 'Allows the app to connect to and disconnect from WiFi networks.',
    protection: 'normal',
  },
  CHANGE_NETWORK_STATE: {
    description: 'Allows the app to change network connectivity state.',
    protection: 'normal',
  },

  // ── Scheduling, services, system ──────────────────────────────────────────
  FOREGROUND_SERVICE: {
    description: 'Allows the app to run foreground services.',
    protection: 'normal',
    note: 'API 28+. Since API 34, also declare the typed FOREGROUND_SERVICE_* permission.',
  },
  FOREGROUND_SERVICE_LOCATION: {
    description: 'Allows a foreground service of type location.',
    protection: 'normal',
    note: 'API 34+.',
  },
  FOREGROUND_SERVICE_MEDIA_PLAYBACK: {
    description: 'Allows a foreground service of type mediaPlayback.',
    protection: 'normal',
    note: 'API 34+.',
  },
  FOREGROUND_SERVICE_DATA_SYNC: {
    description: 'Allows a foreground service of type dataSync.',
    protection: 'normal',
    note: 'API 34+.',
  },
  RECEIVE_BOOT_COMPLETED: {
    description: 'Allows the app to receive the broadcast sent after the system finishes booting.',
    protection: 'normal',
  },
  WAKE_LOCK: {
    description: 'Allows the app to keep the processor awake or the screen from dimming.',
    protection: 'normal',
  },
  VIBRATE: {
    description: 'Allows the app to control the vibrator.',
    protection: 'normal',
  },
  SET_ALARM: {
    description: 'Allows the app to set an alarm in the alarm clock app.',
    protection: 'normal',
  },
  SCHEDULE_EXACT_ALARM: {
    description: 'Allows the app to schedule exact alarms.',
    protection: 'special',
    note: 'API 31+. Granted in system settings; API 33+ may be pre granted for alarm apps.',
  },
  USE_EXACT_ALARM: {
    description: 'Allows exact alarms without a settings grant, for alarm and calendar apps only.',
    protection: 'normal',
    note: 'API 33+. Play Store restricts it to clock and calendar app categories.',
  },
  USE_FULL_SCREEN_INTENT: {
    description: 'Allows notifications to launch a full screen activity, like an incoming call screen.',
    protection: 'normal',
    note: 'API 34+: revocable by the Play Store for apps that are not calling or alarm apps.',
  },

  // ── Biometrics ────────────────────────────────────────────────────────────
  USE_BIOMETRIC: {
    description: 'Allows the app to use biometric hardware for authentication.',
    protection: 'normal',
    note: 'API 28+.',
  },
  USE_FINGERPRINT: {
    description: 'Allows the app to use the fingerprint sensor.',
    protection: 'normal',
    note: 'Deprecated since API 28. Use USE_BIOMETRIC.',
  },

  // ── Special app access ────────────────────────────────────────────────────
  SYSTEM_ALERT_WINDOW: {
    description: 'Allows the app to draw overlay windows on top of other apps.',
    protection: 'special',
    note: 'Granted in system settings, not via a runtime dialog.',
  },
  WRITE_SETTINGS: {
    description: 'Allows the app to modify system settings.',
    protection: 'special',
    note: 'Granted in system settings, not via a runtime dialog.',
  },
  PACKAGE_USAGE_STATS: {
    description: 'Allows the app to read usage statistics of other apps.',
    protection: 'special',
    note: 'Granted in system settings under Usage access.',
  },
  REQUEST_INSTALL_PACKAGES: {
    description: 'Allows the app to request installation of APK packages.',
    protection: 'special',
    note: 'Granted in system settings under Install unknown apps.',
  },
  QUERY_ALL_PACKAGES: {
    description: 'Allows the app to see all installed packages, bypassing package visibility filtering.',
    protection: 'normal',
    note: 'API 30+. Play Store requires a declared use case to keep it.',
  },
};

const PREFIX = 'android.permission.';

/** Accepts `CAMERA` or `android.permission.CAMERA`. */
export function lookupPermission(name: string): PermissionDescription | undefined {
  const key = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name;
  return PERMISSION_DESCRIPTIONS[key];
}
