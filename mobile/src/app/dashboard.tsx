import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  apiRequest,
  changePassword,
  createInputer,
  createRoom,
  currentUser,
  deactivateInputer,
  getApiStatus,
  getAuditLogs,
  getFloors,
  getInputers,
  getRoomTypes,
  getSystemUsers,
  getStudentDashboard,
  restoreNativeSession,
  signOut,
  type Role,
  type User,
} from '@/services/api';

const roleDetails: Record<Role, { title: string; summary: string }> = {
  STUDENT: { title: 'Student portal', summary: 'View your accommodation, notices, and maintenance requests.' },
  INPUTER: { title: 'Inputer portal', summary: 'Enter and update permitted room inventory records.' },
  MANAGER: { title: 'Manager portal', summary: 'Support hostel operations and create Inputer accounts.' },
  ADMIN: { title: 'Admin portal', summary: 'Oversee operations and deactivate Inputer accounts.' },
  ADMINISTRATOR: { title: 'Administrator portal', summary: 'Manage roles, audit access, security and recovery.' },
};

type SelectItem = { id: string; name: string; block?: { name: string; hostel: { name: string } } };

export default function DashboardScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [studentDashboard, setStudentDashboard] = useState<Awaited<ReturnType<typeof getStudentDashboard>> | null>(null);
  const [floors, setFloors] = useState<SelectItem[]>([]);
  const [roomTypes, setRoomTypes] = useState<{ id: string; name: string; capacity: number }[]>([]);
  const [floorId, setFloorId] = useState('');
  const [roomTypeId, setRoomTypeId] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [inputers, setInputers] = useState<{ id: string; fullName: string; email: string }[]>([]);
  const [systemUsers, setSystemUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<{ id: string; action: string; createdAt: string; actor?: { email: string } }[]>([]);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadRoleData(role: Role) {
    const jobs: Promise<unknown>[] = [getApiStatus().then((health) => setStatus(`${health.status} · database ${health.database}`))];
    if (role === 'STUDENT') {
      jobs.push(getStudentDashboard().then(setStudentDashboard));
    } else {
      jobs.push(getFloors().then((result) => setFloors(result.floors)));
      jobs.push(getRoomTypes().then((result) => setRoomTypes(result.roomTypes)));
    }
    if (role === 'MANAGER' || role === 'ADMIN') {
      jobs.push(getInputers().then((result) => setInputers(result.users)));
    }
    if (role === 'ADMINISTRATOR') {
      jobs.push(getSystemUsers().then((result) => setSystemUsers(result.users)));
      jobs.push(getAuditLogs().then((result) => setAuditLogs(result.logs)));
    }
    const results = await Promise.allSettled(jobs);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) setError(failed.reason instanceof Error ? failed.reason.message : 'Some dashboard data could not be loaded.');
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await restoreNativeSession();
        const result = await currentUser();
        if (!active) return;
        const current = result.user;
        if (current.roleProfile !== 'TARGET' || !roleDetails[current.role]) {
          throw new Error('This mobile portal supports only explicitly assigned target-role accounts.');
        }
        setUser(current);
        setMustChangePassword(current.mustChangePassword);
        if (!current.mustChangePassword) await loadRoleData(current.role);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : 'Your session is unavailable. Sign in again.');
        router.replace('/');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function logout() {
    try {
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Server logout failed; local credentials have been cleared.');
    } finally {
      router.replace('/');
    }
  }

  async function saveRoom() {
    setBusy(true);
    setError('');
    try {
      await createRoom({ floorId, roomTypeId, roomNumber: roomNumber.trim() });
      setRoomNumber('');
      Alert.alert('Room record created', `Room ${roomNumber.trim()} was added.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Room record could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function createInputerAccount() {
    setBusy(true);
    setError('');
    try {
      await createInputer({ fullName: newName.trim(), email: newEmail.trim().toLowerCase(), temporaryPassword: newPassword });
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      const result = await getInputers();
      setInputers(result.users);
      Alert.alert('Inputer created', 'Deliver the temporary password through a separate secure channel.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Inputer account could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function removeInputer(id: string, email: string) {
    Alert.alert('Deactivate Inputer?', `Deactivate ${email} and revoke its sessions?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: async () => {
        try {
          await deactivateInputer(id);
          setInputers((rows) => rows.filter((row) => row.id !== id));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Inputer deactivation failed.');
        }
      } },
    ]);
  }

  async function updateRole(accountId: string, role: Role) {
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/system/users/${encodeURIComponent(accountId)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      const result = await getSystemUsers();
      setSystemUsers(result.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Role update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordChange() {
    setBusy(true);
    setError('');
    try {
      await changePassword({ currentPassword, password: nextPassword });
      await signOut();
      Alert.alert('Password changed', 'Your session was revoked. Sign in again with the new password.');
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password change failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <View style={styles.loading}><ActivityIndicator color="#83aaff" /><Text style={styles.body}>Restoring your secure session…</Text></View>;
  if (!user) return <View style={styles.loading}><Text style={styles.error}>{error || 'Sign in to continue.'}</Text></View>;
  const role = user.role;
  const details = roleDetails[role];

  if (role === 'STUDENT') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View><Text style={styles.kicker}>SECUREAUTH · STUDENT PORTAL</Text><Text style={styles.title}>{details.title}</Text></View>
          <Pressable onPress={() => void logout()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Sign out</Text></Pressable>
        </View>
        <Text style={styles.body}>{details.summary}</Text>
        <View style={styles.card}>
          <Text style={styles.label}>SIGNED IN AS</Text>
          <Text style={styles.cardTitle}>{user.fullName}</Text>
          <Text style={styles.body}>{user.email}</Text>
          <Text style={styles.role}>STUDENT</Text>
        </View>
        <View style={styles.card}><Text style={styles.label}>SYSTEM STATUS</Text><Text style={styles.body}>{status || 'Status unavailable.'}</Text></View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {mustChangePassword ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Change your password before continuing</Text>
            <TextInput style={styles.input} placeholder="Current password" secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} autoComplete="current-password" />
            <TextInput style={styles.input} placeholder="New password (12+ characters)" secureTextEntry value={nextPassword} onChangeText={setNextPassword} autoComplete="new-password" />
            <Pressable style={styles.primaryButton} onPress={() => void submitPasswordChange()} disabled={busy || nextPassword.length < 12 || !currentPassword}><Text style={styles.primaryText}>{busy ? 'Saving…' : 'Change password'}</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current accommodation</Text>
              {studentDashboard?.booking ? (
                <>
                  <Text style={styles.body}>Room {studentDashboard.booking.roomNumber} · {studentDashboard.booking.block} · Floor {studentDashboard.booking.floor}</Text>
                  <Text style={styles.body}>{studentDashboard.booking.roomType} · Bed {studentDashboard.booking.bed} · {studentDashboard.booking.status}</Text>
                  <Text style={styles.body}>Paid GHS {(studentDashboard.booking.totalPaidPesewas / 100).toFixed(2)} · Balance GHS {(studentDashboard.booking.balancePesewas / 100).toFixed(2)}</Text>
                </>
              ) : <Text style={styles.body}>No current booking was found.</Text>}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Notices</Text>
              {studentDashboard?.notices.length ? studentDashboard.notices.map((notice) => <View key={notice.id}><Text style={styles.link}>{notice.title}{notice.read ? ' · Read' : ''}</Text><Text style={styles.body}>{notice.body}</Text></View>) : <Text style={styles.body}>No notices are available.</Text>}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Maintenance requests</Text>
              {studentDashboard?.maintenance.length ? studentDashboard.maintenance.map((request) => <Text style={styles.body} key={request.id}>{request.room?.roomNumber || 'Room'} · {request.status}</Text>) : <Text style={styles.body}>No maintenance requests were found.</Text>}
            </View>
          </>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View><Text style={styles.kicker}>SECUREAUTH · MOBILE</Text><Text style={styles.title}>{details.title}</Text></View>
        <Pressable onPress={() => void logout()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Sign out</Text></Pressable>
      </View>
      <Text style={styles.body}>{details.summary}</Text>
      <View style={styles.card}>
        <Text style={styles.label}>SIGNED IN AS</Text>
        <Text style={styles.cardTitle}>{user.fullName}</Text>
        <Text style={styles.body}>{user.email}</Text>
        <Text style={styles.role}>{role}</Text>
      </View>
      <View style={styles.card}><Text style={styles.label}>SYSTEM STATUS</Text><Text style={styles.body}>{status || 'Status unavailable.'}</Text></View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      {mustChangePassword ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Change your temporary password</Text>
          <TextInput style={styles.input} placeholder="Current temporary password" secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} autoComplete="current-password" />
          <TextInput style={styles.input} placeholder="New password (12+ characters)" secureTextEntry value={nextPassword} onChangeText={setNextPassword} autoComplete="new-password" />
          <Pressable style={styles.primaryButton} onPress={() => void submitPasswordChange()} disabled={busy || nextPassword.length < 12 || !currentPassword}><Text style={styles.primaryText}>{busy ? 'Saving…' : 'Change password'}</Text></Pressable>
        </View>
      ) : (
        <>
          {role !== 'ADMINISTRATOR' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Room inventory</Text>
              <Text style={styles.body}>Choose an existing floor and room type, then create a room record.</Text>
              <TextInput style={styles.input} placeholder="Floor ID" value={floorId} onChangeText={setFloorId} autoCapitalize="none" />
              <Text style={styles.body}>{floors.map((floor) => `${floor.block?.hostel.name} · ${floor.block?.name} · ${floor.name} [${floor.id}]`).join('\n') || 'No floors configured yet.'}</Text>
              <TextInput style={styles.input} placeholder="Room type ID" value={roomTypeId} onChangeText={setRoomTypeId} autoCapitalize="none" />
              <Text style={styles.body}>{roomTypes.map((item) => `${item.name} (${item.capacity}) [${item.id}]`).join('\n') || 'No room types configured yet.'}</Text>
              <TextInput style={styles.input} placeholder="Room number" value={roomNumber} onChangeText={setRoomNumber} />
              <Pressable style={styles.primaryButton} onPress={() => void saveRoom()} disabled={busy || !floorId || !roomTypeId || !roomNumber.trim()}><Text style={styles.primaryText}>{busy ? 'Saving…' : 'Create room'}</Text></Pressable>
            </View>
          )}
          {role === 'MANAGER' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Create an Inputer</Text>
              <TextInput style={styles.input} placeholder="Full name" value={newName} onChangeText={setNewName} />
              <TextInput style={styles.input} placeholder="Email" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" />
              <TextInput style={styles.input} placeholder="Temporary password (12+ characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
              <Pressable style={styles.primaryButton} onPress={() => void createInputerAccount()} disabled={busy || newName.trim().length < 2 || !newEmail.includes('@') || newPassword.length < 12}><Text style={styles.primaryText}>{busy ? 'Creating…' : 'Add Inputer'}</Text></Pressable>
              {inputers.map((account) => <Text style={styles.body} key={account.id}>{account.fullName} · {account.email}</Text>)}
            </View>
          )}
          {role === 'ADMIN' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Inputer accounts</Text>
              {inputers.map((account) => <View style={styles.row} key={account.id}><Text style={styles.body}>{account.email}</Text><Pressable onPress={() => void removeInputer(account.id, account.email)}><Text style={styles.danger}>Deactivate</Text></Pressable></View>)}
            </View>
          )}
          {role === 'ADMINISTRATOR' && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>System users and role administration</Text>
                {systemUsers.map((account) => <View style={styles.userRow} key={account.id}>
                  <Text style={styles.body}>{account.email} · {account.role}{account.roleProfile === 'LEGACY' ? ' (legacy)' : ''}</Text>
                  {account.id !== user.id && account.roleProfile === 'TARGET' ? (
                    <View style={styles.roleChoices}>{(['INPUTER', 'MANAGER', 'ADMIN', 'ADMINISTRATOR'] as Role[]).filter((item) => item !== account.role).map((item) => <Pressable key={item} onPress={() => void updateRole(account.id, item)} disabled={busy}><Text style={styles.link}>{item}</Text></Pressable>)}</View>
                  ) : null}
                </View>)}
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Recent audit events</Text>
                {auditLogs.map((log) => <Text style={styles.body} key={log.id}>{new Date(log.createdAt).toLocaleString()} · {log.action} · {log.actor?.email || 'System'}</Text>)}
                {!auditLogs.length ? <Text style={styles.body}>No audit events returned.</Text> : null}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080d18' },
  content: { padding: 22, paddingTop: 58, paddingBottom: 48, width: '100%', maxWidth: 680, alignSelf: 'center', gap: 14 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#080d18' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  kicker: { color: '#85adff', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#f5f8ff', fontSize: 27, fontWeight: '800', marginTop: 6 },
  card: { backgroundColor: '#111b2d', borderColor: '#293954', borderWidth: 1, borderRadius: 16, padding: 18, gap: 11 },
  label: { color: '#85adff', fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: { color: '#f5f8ff', fontSize: 18, fontWeight: '700' },
  body: { color: '#a5b2c6', fontSize: 13, lineHeight: 20 },
  role: { color: '#dbe7ff', fontWeight: '800' },
  input: { color: '#fff', backgroundColor: '#0a1120', borderColor: '#344664', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 13 },
  primaryButton: { minHeight: 48, borderRadius: 11, backgroundColor: '#397cf4', alignItems: 'center', justifyContent: 'center', padding: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { borderColor: '#344664', borderWidth: 1, borderRadius: 10, padding: 10 },
  secondaryText: { color: '#dbe7ff', fontWeight: '700' },
  error: { color: '#ff9eaa', padding: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  userRow: { borderTopColor: '#293954', borderTopWidth: 1, paddingTop: 10, gap: 8 },
  roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  link: { color: '#91b6ff', fontWeight: '700' },
  danger: { color: '#ff9eaa', fontWeight: '700' },
});
