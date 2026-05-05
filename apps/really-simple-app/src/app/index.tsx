import { useState, useEffect } from 'react';
import { Platform, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

const API_BASE_URL = 'https://zhnzcmvxqw2rnfe4jgnc2xs35a0mhndz.lambda-url.eu-north-1.on.aws';
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';
const EXTERNAL_ID = 'user_001';

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
      try {
        // 1. Ensure user exists
        const createRes = await fetch(`${API_BASE_URL}/v1/users`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ external_id: EXTERNAL_ID }),
        });
        console.log('Create user:', createRes.status, await createRes.text());

        // 2. Register push token
        const token = await registerForPushNotifications();
        if (token) {
          setPushToken(token);
          const tokenRes = await fetch(`${API_BASE_URL}/v1/users/${EXTERNAL_ID}/push-tokens`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ token }),
          });
          console.log('Register token:', tokenRes.status, await tokenRes.text());
        }

        // 3. Fetch user details
        const res = await fetch(`${API_BASE_URL}/v1/users/${EXTERNAL_ID}`, {
          headers,
        });
        const body = await res.text();
        console.log('Fetch user:', res.status, body);
        if (res.ok) {
          const data = JSON.parse(body);
          setUser(data);
          setName((data.attributes?.name as string) ?? '');
        }
      } catch (err) {
        console.error('init error:', err);
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
