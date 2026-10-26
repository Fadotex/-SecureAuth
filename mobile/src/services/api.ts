import * as SecureStore from 'expo-secure-store';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:3001/api/v1').replace(/\/+$/, '');
const CLIENT_HEADER = 'expo-native';
const REFRESH_KEY = 'secureauth.refresh-token';
let accessToken: string | null = null;
let refreshToken: string | null = null;

export type Role = 'INPUTER' | 'MANAGER' | 'ADMIN' | 'ADMINISTRATOR' | 'STUDENT';
export type User = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  roleProfile: 'TARGET' | 'LEGACY';
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
};

type SessionResponse = { accessToken: string; refreshToken: string; user: User; mustChangePassword: boolean };
type LoginResponse = {
  user?: User;
  challenge?: string;
  twoFactorRequired?: boolean;
  mfaEnrollmentRequired?: boolean;
  accessToken?: string;
  refreshToken?: string;
  mustChangePassword?: boolean;
};

export async function setNativeSession(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearNativeSession() {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

async function readRefreshToken() {
  if (!refreshToken) refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  return refreshToken;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const fetchApi = () => fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Hostel-Client': CLIENT_HEADER,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  let response: Response;
  try {
    response = await fetchApi();
  } catch {
    throw new Error(`Cannot reach the Hostel Management API at ${API_URL}. Check the API server and network configuration.`);
  }
  if (response.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/login/2fa') {
    const storedRefreshToken = await readRefreshToken();
    if (storedRefreshToken) {
      try {
        const refreshed = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Hostel-Client': CLIENT_HEADER },
          body: JSON.stringify({ refreshToken: storedRefreshToken }),
        });
        if (refreshed.ok) {
          const session = await refreshed.json() as SessionResponse;
          await setNativeSession(session.accessToken, session.refreshToken);
          response = await fetchApi();
        } else {
          await clearNativeSession();
        }
      } catch {
        await clearNativeSession();
      }
    }
  }
  if (response.status === 204) return null as T;

  let data: { error?: string; message?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error('The Hostel Management API returned an unreadable response.');
  }
  if (!response.ok) throw new Error(data.error || data.message || `Request failed with status ${response.status}.`);
  return data as T;
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

export async function signIn(input: { email: string; password: string }) {
  return apiRequest<LoginResponse>('/auth/login', post(input));
}

export async function registerAccount(input: {
  studentId: string;
  fullName: string;
  email: string;
  phone: string;
  guardianName: string;
  guardianPhone: string;
  gender: 'MALE' | 'FEMALE';
  password: string;
  consent: true;
}) {
  return apiRequest<{ message: string }>('/auth/register', post(input));
}

export async function verifyLoginCode(challenge: string, code: string) {
  return apiRequest<SessionResponse>('/auth/login/2fa', post({ challenge, code }));
}

export async function setupRequiredAuthenticator(challenge: string) {
  return apiRequest<{ secret: string; otpauth: string }>('/auth/2fa/enroll/setup', post({ challenge }));
}

export async function verifyRequiredAuthenticator(challenge: string, code: string) {
  return apiRequest<SessionResponse & { recoveryCodes: string[] }>('/auth/2fa/enroll/verify', post({ challenge, code }));
}

export async function restoreNativeSession() {
  const storedRefreshToken = await readRefreshToken();
  if (!storedRefreshToken) return null;
  try {
    const result = await apiRequest<SessionResponse>('/auth/refresh', post({ refreshToken: storedRefreshToken }));
    await setNativeSession(result.accessToken, result.refreshToken);
    return result.user;
  } catch {
    await clearNativeSession();
    return null;
  }
}

export async function currentUser() {
  return apiRequest<{ user: User }>('/auth/me');
}

export async function changePassword(input: { currentPassword: string; password: string }) {
  return apiRequest<{ message: string }>('/auth/change-password', post(input));
}

export async function signOut() {
  const storedRefreshToken = await readRefreshToken();
  try {
    if (storedRefreshToken) await apiRequest('/auth/logout', post({ refreshToken: storedRefreshToken }));
  } finally {
    await clearNativeSession();
  }
}

export async function createRoom(input: { floorId: string; roomTypeId: string; roomNumber: string }) {
  return apiRequest<{ room: { id: string; roomNumber: string } }>('/rooms', post(input));
}

export async function getFloors() {
  return apiRequest<{ floors: { id: string; name: string; block: { name: string; hostel: { name: string } } }[] }>('/floors');
}

export async function getRoomTypes() {
  return apiRequest<{ roomTypes: { id: string; name: string; capacity: number }[] }>('/room-types');
}

export async function createInputer(input: { fullName: string; email: string; temporaryPassword: string }) {
  return apiRequest('/admin/inputers', post(input));
}

export async function getInputers() {
  return apiRequest<{ users: { id: string; email: string; fullName: string; role: Role; isActive: boolean }[] }>('/admin/inputers');
}

export async function deactivateInputer(id: string) {
  return apiRequest<void>(`/admin/inputers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getSystemUsers() {
  return apiRequest<{ users: (User & { isActive: boolean })[] }>('/system/users');
}

export async function getAuditLogs() {
  return apiRequest<{ logs: { id: string; action: string; entityType: string; createdAt: string; actor?: { email: string } }[] }>('/admin/audit-logs');
}

export async function getApiStatus() {
  return apiRequest<{ status: string; database: string }>('/health');
}

export async function getStudentDashboard() {
  return apiRequest<{
    semester: { name: string } | null;
    booking: {
      status: string;
      roomNumber: string;
      block: string;
      floor: string;
      roomType: string;
      bed: string;
      totalPaidPesewas: number;
      balancePesewas: number;
    } | null;
    maintenance: { id: string; status: string; room?: { roomNumber: string } | null }[];
    notices: { id: string; title: string; body: string; publishedAt: string; read: boolean }[];
  }>('/student/dashboard');
}

export function getApiUrl() {
  return API_URL;
}
