const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
let sessionToken = null;

export function setSessionToken(token) {
  sessionToken = token || null;
}

async function request(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch {
    throw new Error(`Cannot reach the SecureAuth API at ${API_URL}. Start the server from the server folder and check that server/.env has your Supabase project URL and server secret key.`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The SecureAuth API returned an unreadable response. Check that the server is running correctly.');
  }

  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

export async function registerUser(user) {
  return request('/api/register', {
    method: 'POST',
    body: JSON.stringify(user),
  });
}

export async function loginUser(credentials) {
  return request('/api/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export async function setup2FA() {
  return request('/api/2fa/setup', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function verify2FA(challenge, code) {
  return request('/api/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({
      token: challenge || sessionToken,
      code,
    }),
  });
}

export async function getAdminUsers() {
  return request('/api/admin/users');
}

export async function createInputer(inputer) {
  return request('/api/manager/inputers', { method: 'POST', body: JSON.stringify(inputer) });
}

export async function deleteInputer(id) {
  return request(`/api/admin/inputers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateUserRole(id, role) {
  return request(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH', body: JSON.stringify({ role }),
  });
}

export async function getHostelSummary() {
  return request('/api/hostel/summary');
}

export async function getHostelRooms() {
  return request('/api/hostel/rooms');
}

export async function createHostelRoom(room) {
  return request('/api/hostel/rooms', { method: 'POST', body: JSON.stringify(room) });
}

export async function getHostelResidents() {
  return request('/api/hostel/residents');
}

export async function createHostelResident(resident) {
  return request('/api/hostel/residents', { method: 'POST', body: JSON.stringify(resident) });
}

export { API_URL };
