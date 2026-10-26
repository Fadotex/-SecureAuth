import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { setNativeSession, setupRequiredAuthenticator, verifyLoginCode, verifyRequiredAuthenticator } from '@/services/api';

export default function TwoFactorScreen() {
  const params = useLocalSearchParams<{ email?: string; challenge?: string; mode?: string }>();
  const mode = params.mode === 'setup' ? 'setup' : 'verify';
  const challenge = typeof params.challenge === 'string' ? params.challenge : null;
  const email = typeof params.email === 'string' ? params.email : '';
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleStartSetup = async () => {
    try {
      setLoading(true);
      if (!challenge) throw new Error('The Two-Factor Authentication (2FA) enrollment challenge is missing. Sign in again.');
      const result = await setupRequiredAuthenticator(challenge);
      setSecret(result.secret);
    } catch (error) {
      Alert.alert('Setup failed', error instanceof Error ? error.message : 'Could not start setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    const cleanCode = code.replace(/\D/g, '').slice(0, 6);
    if (cleanCode.length !== 6) {
      Alert.alert('Invalid code', 'Enter the six-digit code from your authenticator app.');
      return;
    }
    try {
      setLoading(true);
      if (mode === 'setup') {
        if (!challenge) throw new Error('The Two-Factor Authentication (2FA) enrollment challenge is missing. Sign in again.');
        const result = await verifyRequiredAuthenticator(challenge, cleanCode);
        await setNativeSession(result.accessToken, result.refreshToken);
        setRecoveryCodes(result.recoveryCodes);
      } else {
        if (!challenge) throw new Error('The sign-in challenge is missing. Sign in again.');
        const result = await verifyLoginCode(challenge, cleanCode);
        await setNativeSession(result.accessToken, result.refreshToken);
        router.replace('/dashboard' as Href);
      }
    } catch (error) {
      Alert.alert('Verification failed', error instanceof Error ? error.message : 'Could not verify the code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}><Text style={styles.brandLetter}>H</Text></View>
        <Text style={styles.kicker}>HOSTEL MANAGEMENT</Text>
        <Text style={styles.title}>{mode === 'setup' ? 'Set up Two-Factor Authentication (2FA)' : 'Verify your sign-in with Two-Factor Authentication (2FA)'}</Text>
        <Text style={styles.subtitle}>
          {mode === 'setup'
            ? 'Set up Two-Factor Authentication (2FA) by connecting an authenticator app, then confirm its current code.'
            : 'Enter the current code from your authenticator app to complete Two-Factor Authentication (2FA).'}
        </Text>
        {email ? <Text style={styles.email}>{email}</Text> : null}

        {recoveryCodes.length > 0 ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Save your single-use recovery codes</Text>
            <Text style={styles.panelBody}>These single-use recovery codes are part of your secure 2FA recovery. They are shown only once; store them in a private password manager before continuing.</Text>
            {recoveryCodes.map((recoveryCode) => <Text key={recoveryCode} selectable style={styles.secret}>{recoveryCode}</Text>)}
            <Pressable style={styles.button} onPress={() => router.replace('/dashboard' as Href)}>
              <Text style={styles.buttonText}>I saved the recovery codes</Text>
            </Pressable>
          </View>
        ) : mode === 'setup' && !secret ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Set up an authenticator</Text>
            <Text style={styles.panelBody}>Use an authenticator app for Two-Factor Authentication (2FA). Confirm a current code to enable it.</Text>
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={handleStartSetup} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Generate setup secret</Text>}
            </Pressable>
          </View>
        ) : (
          <View style={styles.panel}>
            {mode === 'setup' && (
              <>
                <Text style={styles.fieldLabel}>Authenticator secret</Text>
                <Text selectable style={styles.secret}>{secret}</Text>
                <Text style={styles.panelBody}>Add this secret manually in your authenticator app. Keep it private.</Text>
              </>
            )}
            <Text style={styles.fieldLabel}>{mode === 'setup' ? 'Confirm setup code' : 'Six-digit code'}</Text>
            <TextInput
              style={styles.input}
              placeholder="000000"
              placeholderTextColor="#74829a"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              editable={!loading}
              autoFocus
              autoComplete="one-time-code"
            />
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={handleVerify} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === 'setup' ? 'Enable 2FA' : 'Verify and sign in'}</Text>}
            </Pressable>
          </View>
        )}

        <Pressable style={styles.backButton} onPress={() => router.back()} disabled={loading}>
          <Text style={styles.backText}>{mode === 'setup' ? 'Back to dashboard' : 'Back to sign in'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080d18' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48, width: '100%', maxWidth: 520, alignSelf: 'center' },
  brandMark: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#397cf4', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  brandLetter: { color: '#fff', fontSize: 26, fontWeight: '800' },
  kicker: { color: '#85adff', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
  title: { color: '#f5f8ff', fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: '#a5b2c6', fontSize: 15, lineHeight: 23, marginTop: 10, marginBottom: 24 },
  email: { color: '#85adff', fontSize: 13, marginBottom: 18 },
  panel: { backgroundColor: '#111b2d', borderColor: '#293954', borderWidth: 1, borderRadius: 18, padding: 22 },
  panelTitle: { color: '#f5f8ff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  panelBody: { color: '#9eacc2', fontSize: 13, lineHeight: 20, marginTop: 12, marginBottom: 18 },
  fieldLabel: { color: '#dbe4f2', fontSize: 13, fontWeight: '600', marginBottom: 9, marginTop: 14 },
  secret: { color: '#dbe7ff', backgroundColor: '#0a1120', borderRadius: 10, padding: 13, fontSize: 14, letterSpacing: 1.2 },
  input: { height: 58, borderRadius: 12, borderWidth: 1, borderColor: '#344664', backgroundColor: '#0a1120', color: '#fff', textAlign: 'center', fontSize: 24, fontWeight: '700', letterSpacing: 8, marginBottom: 18 },
  button: { minHeight: 52, borderRadius: 12, backgroundColor: '#397cf4', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  pressed: { opacity: 0.78 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  backButton: { alignItems: 'center', paddingVertical: 22 },
  backText: { color: '#91b6ff', fontSize: 14, fontWeight: '600' },
});
