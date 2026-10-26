const API_URL = (
  import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? 'http://127.0.0.1:3001/api/v1' : '')
).replace(/\/+$/, '');

export async function apiRequest(path, options = {}) {
  if (!API_URL) {
    throw new Error('The API is not configured for this deployment. Set VITE_API_URL to the v1 API base URL.');
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    throw new Error(`Cannot reach the Hostel Management API at ${API_URL}. Start the API and check its database configuration.`);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf') || contentType.includes('text/csv')) return response;
  let data;
  try { data = await response.json(); } catch { throw new Error('The API returned an unreadable response.'); }
  if (!response.ok) throw new Error(data.error || data.message || 'Request failed.');
  return data;
}

const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
const normalizedUser = (user) => user ? { ...user, name: user.fullName } : user;

export function registerStudent(input) { return apiRequest('/auth/register', post(input)); }
export function verifyEmail(token) { return apiRequest('/auth/verify-email', post({ token })); }
export function getDevelopmentVerificationLink(email) {
  return apiRequest(`/auth/dev/email-verification-link?email=${encodeURIComponent(email)}`);
}
export function requestPasswordReset(email) { return apiRequest('/auth/forgot-password', post({ email })); }
export function resetPassword(input) { return apiRequest('/auth/reset-password', post(input)); }
export async function signIn(input) {
  const result = await apiRequest('/auth/login', post(input));
  return { ...result, challengeToken: result.challenge, user: normalizedUser(result.user) };
}
export const loginUser = signIn;
export async function verifyLoginCode(challenge, code) {
  const result = await apiRequest('/auth/login/2fa', post({ challenge, code }));
  return { ...result, user: normalizedUser(result.user) };
}
export function setupRequiredAuthenticator(challenge) { return apiRequest('/auth/2fa/enroll/setup', post({ challenge })); }
export async function verifyRequiredAuthenticator(challenge, code) {
  const result = await apiRequest('/auth/2fa/enroll/verify', post({ challenge, code }));
  return { ...result, user: normalizedUser(result.user) };
}
export function setupAuthenticator() { return apiRequest('/auth/2fa/setup', post({})); }
export function enableAuthenticator(code) { return apiRequest('/auth/2fa/enable', post({ code })); }
export function currentUser() { return apiRequest('/auth/me'); }
export async function refreshSession() {
  const result = await apiRequest('/auth/refresh', post({}));
  return { ...result, user: normalizedUser(result.user) };
}
  export async function changePassword(input) {
    return apiRequest('/auth/change-password', post(input));
  }
export function signOut() { return apiRequest('/auth/logout', post({})); }
export function getStudentDashboard() { return apiRequest('/student/dashboard'); }
export function getRoomTypes(semesterId) { return apiRequest(`/room-types${semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''}`); }
export function getRoomAvailability(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  return apiRequest(`/rooms/availability${query ? `?${query}` : ''}`);
}
export function getHostels() { return apiRequest('/hostels'); }
export function getBlocks() { return apiRequest('/blocks'); }
export function getFloors() { return apiRequest('/floors'); }
export function holdBed(input) { return apiRequest('/bookings/hold', post(input)); }
export function getMyBookings() { return apiRequest('/bookings/me'); }
export function cancelBooking(id) { return apiRequest(`/bookings/${encodeURIComponent(id)}/cancel`, post({})); }
export function checkInBooking(id) { return apiRequest(`/bookings/${encodeURIComponent(id)}/check-in`, post({})); }
export function checkOutBooking(id) { return apiRequest(`/bookings/${encodeURIComponent(id)}/check-out`, post({})); }
export function requestRoomChange(input) { return apiRequest('/room-change-requests', post(input)); }
export function decideRoomChange(id, decision) { return apiRequest(`/room-change-requests/${encodeURIComponent(id)}/decision`, post({ decision })); }
export function initializePayment(input) { return apiRequest('/payments/initialize', post(input)); }
export function getMyPayments() { return apiRequest('/payments/me'); }
export function downloadReceipt(id) { return apiRequest(`/payments/${encodeURIComponent(id)}/receipt`); }
export function createMaintenance(input) { return apiRequest('/maintenance', post(input)); }
export function getMaintenance() { return apiRequest('/maintenance'); }
export function updateMaintenance(id, input) { return apiRequest(`/maintenance/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export function getStudents(query = '') { return apiRequest(`/students${query ? `?q=${encodeURIComponent(query)}` : ''}`); }
export function createManualPayment(input) { return apiRequest('/payments/manual', post(input)); }
export function getVisitors() { return apiRequest('/visitors'); }
export function createVisitor(input) { return apiRequest('/visitors', post(input)); }
export function checkOutVisitor(id) { return apiRequest(`/visitors/${encodeURIComponent(id)}/check-out`, post({})); }
export function getNotices() { return apiRequest('/notices'); }
export function createNotice(input) { return apiRequest('/notices', post(input)); }
export function getSemesters() { return apiRequest('/semesters'); }
export function activateSemester(id) { return apiRequest(`/semesters/${encodeURIComponent(id)}/activate`, post({})); }
export function closeSemester(id) { return apiRequest(`/semesters/${encodeURIComponent(id)}/close`, post({})); }
export function getRoomChangeRequests() { return apiRequest('/room-change-requests'); }
export function getAdminReport(semesterId) { return apiRequest(`/admin/reports/summary${semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''}`); }
export function getAdminPayments(semesterId) { return apiRequest(`/admin/payments${semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''}`); }
export function getStaffAccounts() { return apiRequest('/admin/staff'); }
export const getAdminStaff = getStaffAccounts;
export function createStaff(input) { return apiRequest('/admin/staff', post(input)); }
export function createSecurity(input) { return apiRequest('/admin/security', post(input)); }
export function getAuditLogs() { return apiRequest('/admin/audit-logs'); }
export function createRoom(input) { return apiRequest('/rooms', post(input)); }
export function createHostel(input) { return apiRequest('/hostels', post(input)); }
export function createBlock(input) { return apiRequest('/blocks', post(input)); }
export function createFloor(input) { return apiRequest('/floors', post(input)); }
export function createSemester(input) { return apiRequest('/semesters', post(input)); }
export function createRoomType(input) { return apiRequest('/room-types', post(input)); }
export function updateRoomPrice(roomTypeId, semesterId, pricePesewas) {
  return apiRequest(`/room-types/${encodeURIComponent(roomTypeId)}/prices/${encodeURIComponent(semesterId)}`, { method: 'PUT', body: JSON.stringify({ pricePesewas }) });
}
export function holdRoom(input) { return apiRequest('/bookings/hold', post(input)); }
export function getAdminPaymentsCsv(semesterId) { return apiRequest(`/admin/reports/payments.csv${semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : ''}`); }
export function deactivateStaff(id) { return apiRequest(`/admin/staff/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export function getSettings() { return apiRequest('/admin/settings'); }
export function updateSetting(key, value) { return apiRequest(`/admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }); }
export function getAdminNotices() { return apiRequest('/notices'); }