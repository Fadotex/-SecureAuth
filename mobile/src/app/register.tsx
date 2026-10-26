import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { registerAccount } from '@/services/api';
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

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('MALE');
  const [consent, setConsent] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const formScrollRef = useRef<ScrollView>(null);

  const handleRegister = async () => {
    if (!name || !email || !password || !confirmPassword) {
      Alert.alert(
        'Missing information',
        'Please complete all fields.'
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        'Password mismatch',
        'The passwords do not match.'
      );
      return;
    }

    try {
      setLoading(true);
      const result = await registerAccount({
        studentId: studentId.trim(),
        fullName: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        guardianName: guardianName.trim(),
        guardianPhone: guardianPhone.trim(),
        gender,
        password,
        consent: true,
      });
      Alert.alert('Account created', result.message || 'You can now sign in.', [
        { text: 'Continue to sign in', onPress: () => router.replace('/login') },
      ]);
    } catch (error) {
      Alert.alert('Registration failed', error instanceof Error ? error.message : 'Could not connect to the hostel server.');
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

        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.logo}>
          <Text style={styles.logoText}>S</Text>
        </View>

        <Text style={styles.title}>Create Account</Text>

        <Text style={styles.subtitle}>
          Create your hostel account
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Full Name</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your full name"
            placeholderTextColor="#888"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            editable={!loading}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Student ID</Text>
          <TextInput style={styles.input} placeholder="Student ID" placeholderTextColor="#888" value={studentId} onChangeText={setStudentId} autoCapitalize="none" editable={!loading} />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email</Text>

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
          <Text style={styles.label}>Phone</Text>
          <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor="#888" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!loading} />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Guardian name</Text>
          <TextInput style={styles.input} placeholder="Guardian name" placeholderTextColor="#888" value={guardianName} onChangeText={setGuardianName} autoCapitalize="words" editable={!loading} />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Guardian phone</Text>
          <TextInput style={styles.input} placeholder="Guardian phone" placeholderTextColor="#888" value={guardianPhone} onChangeText={setGuardianPhone} keyboardType="phone-pad" editable={!loading} />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Gender</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {(['MALE', 'FEMALE'] as const).map((value) => <Pressable key={value} onPress={() => setGender(value)} style={[styles.registerButton, { flex: 1, backgroundColor: gender === value ? '#1973c9' : '#7890a5' }]}><Text style={styles.registerButtonText}>{value}</Text></Pressable>)}
          </View>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>

          <TextInput
            style={styles.input}
            placeholder="Create a password"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
            onFocus={() => formScrollRef.current?.scrollToEnd({ animated: true })}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Confirm Password</Text>

          <TextInput
            style={styles.input}
            placeholder="Confirm your password"
            placeholderTextColor="#888"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            editable={!loading}
            onFocus={() => formScrollRef.current?.scrollToEnd({ animated: true })}
          />
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          onPress={() => setConsent((value) => !value)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }}
        >
          <Text style={styles.label}>{consent ? '☑' : '☐'} I consent to the use of this information for hostel management.</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.registerButton,
            pressed && styles.buttonPressed,
            loading && styles.buttonPressed,
          ]}
          onPress={handleRegister}
          disabled={loading || !consent}
        >
          {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.registerButtonText}>Create Account</Text>}
        </Pressable>

        <View style={styles.loginContainer}>
          <Text style={styles.loginText}>
            Already have an account?
          </Text>

          <Pressable onPress={() => router.back()} disabled={loading}>
            <Text style={styles.loginLink}> Sign In</Text>
          </Pressable>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5fafd',
  },

  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 44,
  },

  backButton: {
    position: 'absolute',
    top: 55,
    left: 28,
  },

  backText: {
    color: '#176eb7',
    fontSize: 16,
    fontWeight: '600',
  },

  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#1973c9',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },

  logoText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },

  title: {
    color: '#102a46',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },

  subtitle: {
    color: '#58748d',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 28,
  },

  inputContainer: {
    marginBottom: 14,
  },

  label: {
    color: '#173550',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 7,
  },

  input: {
    height: 52,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#bdd2e1',
    borderRadius: 14,
    paddingHorizontal: 16,
    color: '#173550',
    fontSize: 16,
  },

  registerButton: {
    height: 55,
    backgroundColor: '#1973c9',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  buttonPressed: {
    opacity: 0.7,
  },

  registerButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },

  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },

  loginText: {
    color: '#58748d',
    fontSize: 14,
  },

  loginLink: {
    color: '#176eb7',
    fontSize: 14,
    fontWeight: '700',
  },
});
