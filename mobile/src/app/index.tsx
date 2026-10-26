import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { restoreNativeSession, setNativeSession, signIn } from '@/services/api';
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

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const formScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    restoreNativeSession()
      .then((user) => {
        if (active && user) router.replace('/dashboard' as Href);
      })
      .catch((error: unknown) => {
        if (active) Alert.alert('Session restore failed', error instanceof Error ? error.message : 'Sign in again.');
      })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert(
        'Missing information',
        'Please enter your email and password.'
      );
      return;
    }

    try {
      setLoading(true);

      const data = await signIn({
        email: email.trim().toLowerCase(), password,
      });

      if (data.mfaEnrollmentRequired && data.challenge) {
        router.push({
          pathname: '/two-factor',
          params: { email: email.trim().toLowerCase(), challenge: data.challenge, mode: 'setup' },
        });
        return;
      }

      if (data.twoFactorRequired) {
        router.push({
          pathname: '/two-factor',
          params: {
            email: email.trim().toLowerCase(),
            challenge: data.challenge,
            mode: 'verify',
          },
        });

        return;
      }

      if (!data.accessToken || !data.refreshToken || !data.user) throw new Error('The server did not return a native sign-in session.');
      await setNativeSession(data.accessToken, data.refreshToken);
      router.replace('/dashboard' as Href);
    } catch (error) {
      Alert.alert(
        'Login failed',
        error instanceof Error ? error.message : 'Could not connect to the hostel server.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={formScrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        <View style={styles.logo}>
          <Text style={styles.logoText}>H</Text>
        </View>

        <Text style={styles.title}>Welcome back</Text>

        <Text style={styles.subtitle}>
          Sign in to your hostel account
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email address</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#888"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordField}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter your password"
              placeholderTextColor="#8b98a1"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              editable={!loading}
              onFocus={() => formScrollRef.current?.scrollToEnd({ animated: true })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              accessibilityState={{ selected: showPassword }}
              style={styles.visibilityButton}
              onPress={() => setShowPassword((visible) => !visible)}
              disabled={loading}
            >
              <Text style={styles.visibilityText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.loginButton,
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}
          onPress={handleLogin}
          disabled={loading || restoring}
        >
          {loading || restoring ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.loginButtonText}>
              Sign In
            </Text>
          )}
        </Pressable>

        <View style={styles.registerContainer}>
          <Text style={styles.registerText}>
            {restoring ? 'Restoring secure session…' : "Don't have an account?"}
          </Text>

          <Pressable
            onPress={() => router.push('/register')}
            disabled={loading}
          >
            <Text style={styles.registerLink}>
              {' '}Create Account
            </Text>
          </Pressable>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f8f8',
  },

  content: {
    flexGrow: 1,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },

  logo: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: '#245d50',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },

  logoText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },

  title: {
    color: '#102a46',
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },

  subtitle: {
    color: '#58748d',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 28,
  },

  inputContainer: {
    marginBottom: 16,
  },

  label: {
    color: '#173550',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },

  input: {
    height: 50,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#c5d2d4',
    borderRadius: 8,
    paddingHorizontal: 16,
    color: '#173550',
    fontSize: 16,
  },

  passwordField: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c5d2d4',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },

  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 14,
    color: '#173550',
    fontSize: 15,
  },

  visibilityButton: {
    minWidth: 58,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },

  visibilityText: {
    color: '#245d50',
    fontSize: 13,
    fontWeight: '700',
  },

  loginButton: {
    height: 52,
    backgroundColor: '#245d50',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonPressed: {
    opacity: 0.7,
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },

  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 18,
  },

  registerText: {
    color: '#58748d',
    fontSize: 14,
  },

  registerLink: {
    color: '#245d50',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default LoginScreen;
