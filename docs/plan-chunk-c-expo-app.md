# Chunk C: Expo App — Settings Screen + Push Token Registration

## Context

We're implementing E2E push notifications. This chunk builds the Expo app UI: request notification permissions, register the push token with the server, and show a settings screen where the user can update their name (triggering a workflow enrollment). Completely independent from server code — just calls the APIs.

**Parallelism:** Fully independent. Can run in parallel with Chunks A and B.

## Codebase orientation

- **App root**: `apps/really-simple-app/`
- **App config**: `apps/really-simple-app/app.json` — Expo config, plugins array currently has `expo-router` and `expo-splash-screen`
- **Home screen**: `apps/really-simple-app/src/app/index.tsx` — currently the default Expo welcome screen. We'll replace this entirely.
- **Layout**: `apps/really-simple-app/src/app/_layout.tsx` — wraps with ThemeProvider and AppTabs
- **Tab navigation**: `apps/really-simple-app/src/components/app-tabs.tsx` — NativeTabs with "Home" and "Explore" tabs
- **Theme constants**: `apps/really-simple-app/src/constants/theme.ts` — exports `Colors`, `Spacing`, etc.
- **Themed components**: `apps/really-simple-app/src/components/themed-text.tsx`, `themed-view.tsx` — use these for consistent styling
- **Package**: `apps/really-simple-app/package.json` — already has `expo-device`, `expo-constants`. Missing `expo-notifications`.

## APIs the app will call

All requests include header `X-Customer-Id: <hardcoded-customer-uuid>`.

1. `POST /v1/users` — create user (on first launch)
   - Body: `{ "external_id": "<hardcoded>" }`
   - Returns 201 or 409 (already exists, which is fine)

2. `POST /v1/users/:external_id/push-tokens` — register device token
   - Body: `{ "token": "ExponentPushToken[...]" }`
   - Returns 201

3. `GET /v1/users/:external_id` — fetch user details
   - Returns `{ id, external_id, phone, gender, attributes, created_at }`

4. `PATCH /v1/users/:external_id` — update user attributes
   - Body: `{ "attributes": { "name": "new value" } }`
   - Returns 200

## Changes

### 1. Install expo-notifications

```
cd apps/really-simple-app && npx expo install expo-notifications
```

### 2. Add expo-notifications plugin to app.json

**File: `apps/really-simple-app/app.json`**

Add `"expo-notifications"` to the `plugins` array.

### 3. Replace home screen

**File: `apps/really-simple-app/src/app/index.tsx`**

Replace entirely with a settings screen:

```tsx
import { useState, useEffect } from 'react';
import { Platform, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Hardcoded for demo — replace with real values after seeding
const API_BASE_URL = 'https://YOUR_API_URL';
const CUSTOMER_ID = 'YOUR_CUSTOMER_UUID';
const EXTERNAL_ID = 'demo-user-1';

const headers = {
  'Content-Type': 'application/json',
  'X-Customer-Id': CUSTOMER_ID,
};

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    Alert.alert('Physical device required for push notifications');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    Alert.alert('Permission not granted for push notifications');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return tokenData.data;
}

type User = {
  id: string;
  external_id: string;
  phone: string | null;
  gender: string | null;
  attributes: Record<string, string | number | boolean>;
  created_at: string;
};

export default function SettingsScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function init() {
      // 1. Ensure user exists
      await fetch(`${API_BASE_URL}/v1/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ external_id: EXTERNAL_ID }),
      });

      // 2. Register push token
      const token = await registerForPushNotifications();
      if (token) {
        setPushToken(token);
        await fetch(`${API_BASE_URL}/v1/users/${EXTERNAL_ID}/push-tokens`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ token }),
        });
      }

      // 3. Fetch user details
      const res = await fetch(`${API_BASE_URL}/v1/users/${EXTERNAL_ID}`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        setName((data.attributes?.name as string) ?? '');
      }
    }

    init();
  }, []);

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`${API_BASE_URL}/v1/users/${EXTERNAL_ID}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ attributes: { name } }),
    });

    if (res.ok) {
      const data = await res.json();
      setUser((prev) => prev ? { ...prev, attributes: data.attributes } : prev);
      Alert.alert('Saved', 'Name updated — workflow enrollment triggered');
    }
    setSaving(false);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Settings</ThemedText>

        {pushToken && (
          <ThemedText type="small" numberOfLines={1}>
            Push token: {pushToken}
          </ThemedText>
        )}

        {user && (
          <>
            <ThemedText type="small">ID: {user.id}</ThemedText>
            <ThemedText type="small">External ID: {user.external_id}</ThemedText>

            <ThemedText type="subtitle" style={{ marginTop: Spacing.three }}>
              Name
            </ThemedText>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor="#999"
            />

            <Pressable
              style={[styles.button, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}>
              <ThemedText style={styles.buttonText}>
                {saving ? 'Saving...' : 'Save'}
              </ThemedText>
            </Pressable>

            {Object.keys(user.attributes).length > 0 && (
              <>
                <ThemedText type="subtitle" style={{ marginTop: Spacing.three }}>
                  Attributes
                </ThemedText>
                {Object.entries(user.attributes).map(([key, value]) => (
                  <ThemedText key={key} type="small">
                    {key}: {String(value)}
                  </ThemedText>
                ))}
              </>
            )}
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: Spacing.two,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#208AEF',
    padding: Spacing.two,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
```

Key details:
- `registerForPushNotifications` checks device, requests permissions, gets Expo push token
- On mount: ensures user exists (POST ignores 409), registers push token, fetches user details
- Save button PATCHes attributes which triggers `user_updated` workflow enrollment server-side
- Uses existing `ThemedText`/`ThemedView` components for consistency

### 4. Remove the explore tab (optional cleanup)

The "Explore" tab from the template isn't needed. If it feels cleaner, remove the explore trigger from `apps/really-simple-app/src/components/app-tabs.tsx` and delete `apps/really-simple-app/src/app/explore.tsx`. But this is optional — leaving it won't break anything.

## Verification

1. `cd apps/really-simple-app && npx expo start` — app launches without errors
2. On physical device in Expo Go: app requests notification permissions
3. Push token appears on screen
4. User details load and display
5. Changing name and saving shows success alert
