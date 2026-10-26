import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  apiRequest, getFloors, getRoomTypes, createRoom, changePassword,
  getHostels, getBlocks, getSemesters, createHostel, createBlock, createFloor, createSemester, createRoomType, activateSemester, closeSemester,
} from '../services/hostelApi';
import PageBackLink from '../components/PageBackLink';
import '../App.css';

const roles = {
  INPUTER: { title: 'Inputer portal', summary: 'Enter and update permitted room inventory records.' },
  MANAGER: { title: 'Manager portal', summary: 'Coordinate hostel operations and create Inputer accounts.' },
  ADMIN: { title: 'Admin portal', summary: 'Oversee operations and deactivate Inputer accounts.' },
  ADMINISTRATOR: { title: 'Administrator portal', summary: 'Manage system users, role assignments, security, audit, and recovery.' },
};

const targetRoles = ['INPUTER', 'MANAGER', 'ADMIN', 'ADMINISTRATOR'];
const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });

async function fetchRoomInventory() {
  const [floorResult, typeResult, roomResult] = await Promise.all([
    getFloors(),
    getRoomTypes(),
    apiRequest('/rooms/availability').catch((err) => {
      if (err.message.includes('No active semester')) return { rooms: [] };
      throw err;
    }),
  ]);
  return { floors: floorResult.floors || [], roomTypes: typeResult.roomTypes || [], rooms: roomResult.rooms || [] };
}

async function fetchHostelSetup() {
  const [hostelResult, blockResult, floorResult, semesterResult] = await Promise.all([getHostels(), getBlocks(), getFloors(), getSemesters()]);
  return {
    hostels: hostelResult.hostels || [],
    blocks: blockResult.blocks || [],
    floors: floorResult.floors || [],
    semesters: semesterResult.semesters || [],
  };
}

async function fetchInputerAccounts(administrator) {
  if (!administrator) {
    const result = await apiRequest('/admin/inputers');
    return { users: result.users || [], archive: [] };
  }
  const [all, archived] = await Promise.all([apiRequest('/system/users'), apiRequest('/system/inputer-archive')]);
  return { users: all.users || [], archive: archived.users || [] };
}

function RoomEntry({ canWrite }) {
  const [floors, setFloors] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [draft, setDraft] = useState({ floorId: '', roomTypeId: '', roomNumber: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError('');
    }
    try {
      const result = await fetchRoomInventory();
      setFloors(result.floors);
      setRoomTypes(result.roomTypes);
      setRooms(result.rooms);
    } catch (err) {
      setError(err.message || 'Unable to load room inventory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchRoomInventory()
      .then((result) => {
        if (!active) return;
        setFloors(result.floors);
        setRoomTypes(result.roomTypes);
        setRooms(result.rooms);
      })
      .catch((err) => { if (active) setError(err.message || 'Unable to load room inventory.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await createRoom({ ...draft, roomNumber: draft.roomNumber.trim() });
      setDraft((current) => ({ ...current, roomNumber: '' }));
      setMessage('Room record created.');
      await reload();
    } catch (err) {
      setError(err.message || 'Unable to create the room record.');
    }
  }

  async function changeStatus(room, status) {
    setError('');
    setMessage('');
    try {
      await apiRequest(`/rooms/${encodeURIComponent(room.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMessage(`Room ${room.roomNumber} status updated.`);
      await reload();
    } catch (err) {
      setError(err.message || 'Unable to update room status.');
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div><span className="eyebrow">Hostel records</span><h2>Room inventory</h2><p>Create a room record or update an existing room’s operational status.</p></div>
        <button className="button button-secondary" type="button" onClick={() => void reload()} disabled={loading}>Refresh</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      {canWrite && (
        <form className="form-stack admin-form" onSubmit={submit}>
          <div className="form-row">
            <div className="form-group"><label htmlFor="room-floor">Floor</label><select id="room-floor" value={draft.floorId} required onChange={(event) => setDraft({ ...draft, floorId: event.target.value })}><option value="">Select a floor</option>{floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.block?.hostel?.name} · {floor.block?.name} · {floor.name}</option>)}</select></div>
            <div className="form-group"><label htmlFor="room-type">Room type</label><select id="room-type" value={draft.roomTypeId} required onChange={(event) => setDraft({ ...draft, roomTypeId: event.target.value })}><option value="">Select a room type</option>{roomTypes.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.capacity} beds)</option>)}</select></div>
            <div className="form-group"><label htmlFor="room-number">Room number</label><input id="room-number" value={draft.roomNumber} required maxLength={30} onChange={(event) => setDraft({ ...draft, roomNumber: event.target.value })} /></div>
          </div>
          <button className="button button-primary" type="submit">Add room record</button>
        </form>
      )}
      {loading ? <p className="empty-state" role="status">Loading room inventory…</p> : rooms.length ? (
        <div className="table-wrap"><table><thead><tr><th>Room</th><th>Location</th><th>Type</th><th>Status</th>{canWrite && <th>Update status</th>}</tr></thead>
          <tbody>{rooms.map((room) => <tr key={room.id}><td>{room.roomNumber}</td><td>{room.hostel} · {room.block} · {room.floor}</td><td>{room.roomType}</td><td>{room.status}</td>{canWrite && <td><select aria-label={`Update ${room.roomNumber} status`} value={room.status} onChange={(event) => void changeStatus(room, event.target.value)}><option value="AVAILABLE">Available</option><option value="RESERVED">Reserved</option><option value="UNDER_MAINTENANCE">Under maintenance</option></select></td>}</tr>)}</tbody>
        </table></div>
      ) : <p className="empty-state">No room inventory is available yet.</p>}
    </section>
  );
}

function HostelSetup() {
  const [hostels, setHostels] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [floors, setFloors] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [hostelName, setHostelName] = useState('');
  const [blockDraft, setBlockDraft] = useState({ hostelId: '', name: '', gender: 'MIXED' });
  const [floorDraft, setFloorDraft] = useState({ blockId: '', name: '', sortOrder: '0' });
  const [semesterDraft, setSemesterDraft] = useState({ name: '', startsAt: '', endsAt: '' });
  const [roomTypeDraft, setRoomTypeDraft] = useState({ name: '', capacity: '1', semesterId: '', price: '' });
  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) { setBusy(true); setError(''); }
    try {
      const result = await fetchHostelSetup();
      setHostels(result.hostels);
      setBlocks(result.blocks);
      setFloors(result.floors);
      setSemesters(result.semesters);
    } catch (err) { setError(err.message || 'Unable to load hostel configuration.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let active = true;
    fetchHostelSetup()
      .then((result) => {
        if (!active) return;
        setHostels(result.hostels);
        setBlocks(result.blocks);
        setFloors(result.floors);
        setSemesters(result.semesters);
      })
      .catch((err) => { if (active) setError(err.message || 'Unable to load hostel configuration.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function save(action, success) {
    setError(''); setMessage(''); setBusy(true);
    try { await action(); setMessage(success); await reload(false); }
    catch (err) { setError(err.message || 'Unable to save hostel configuration.'); }
    finally { setBusy(false); }
  }
  return <section className="admin-section"><div className="admin-section-header"><div><span className="eyebrow">Hostel operations</span><h2>Hostel structure and semester setup</h2><p>Configure the hierarchy required for room inventory and bookings.</p></div><button className="button button-secondary" type="button" onClick={() => void reload()} disabled={busy}>Refresh</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    <div className="setup-grid">
      <form className="form-stack setup-card" onSubmit={(event) => { event.preventDefault(); void save(async () => { await createHostel({ name: hostelName.trim() }); setHostelName(''); }, 'Hostel created.'); }}><h3>Add hostel</h3><div className="form-group"><label htmlFor="new-hostel">Hostel name</label><input id="new-hostel" required minLength={2} maxLength={120} value={hostelName} onChange={(event) => setHostelName(event.target.value)} /></div><button className="button button-primary" disabled={busy}>Create hostel</button></form>
      <form className="form-stack setup-card" onSubmit={(event) => { event.preventDefault(); void save(async () => { await createBlock(blockDraft); setBlockDraft({ ...blockDraft, name: '' }); }, 'Block created.'); }}><h3>Add block</h3><div className="form-group"><label htmlFor="block-hostel">Hostel</label><select id="block-hostel" required value={blockDraft.hostelId} onChange={(event) => setBlockDraft({ ...blockDraft, hostelId: event.target.value })}><option value="">Choose hostel</option>{hostels.map((hostel) => <option key={hostel.id} value={hostel.id}>{hostel.name}</option>)}</select></div><div className="form-group"><label htmlFor="block-name">Block name</label><input id="block-name" required value={blockDraft.name} onChange={(event) => setBlockDraft({ ...blockDraft, name: event.target.value })} /></div><div className="form-group"><label htmlFor="block-gender">Resident group</label><select id="block-gender" value={blockDraft.gender} onChange={(event) => setBlockDraft({ ...blockDraft, gender: event.target.value })}><option value="MIXED">Mixed</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></div><button className="button button-primary" disabled={busy}>Create block</button></form>
      <form className="form-stack setup-card" onSubmit={(event) => { event.preventDefault(); void save(async () => { await createFloor({ ...floorDraft, sortOrder: Number(floorDraft.sortOrder) }); setFloorDraft({ ...floorDraft, name: '' }); }, 'Floor created.'); }}><h3>Add floor</h3><div className="form-group"><label htmlFor="floor-block">Block</label><select id="floor-block" required value={floorDraft.blockId} onChange={(event) => setFloorDraft({ ...floorDraft, blockId: event.target.value })}><option value="">Choose block</option>{blocks.map((block) => <option key={block.id} value={block.id}>{block.hostel?.name} · {block.name}</option>)}</select></div><div className="form-group"><label htmlFor="floor-name">Floor name</label><input id="floor-name" required value={floorDraft.name} onChange={(event) => setFloorDraft({ ...floorDraft, name: event.target.value })} /></div><button className="button button-primary" disabled={busy}>Create floor</button></form>
      <form className="form-stack setup-card" onSubmit={(event) => { event.preventDefault(); void save(async () => { await createSemester({ ...semesterDraft, startsAt: new Date(semesterDraft.startsAt).toISOString(), endsAt: new Date(semesterDraft.endsAt).toISOString() }); setSemesterDraft({ name: '', startsAt: '', endsAt: '' }); }, 'Semester created.'); }}><h3>Add semester</h3><div className="form-group"><label htmlFor="semester-name">Semester name</label><input id="semester-name" required value={semesterDraft.name} onChange={(event) => setSemesterDraft({ ...semesterDraft, name: event.target.value })} /></div><div className="form-row"><div className="form-group"><label htmlFor="semester-start">Starts</label><input id="semester-start" type="date" required value={semesterDraft.startsAt} onChange={(event) => setSemesterDraft({ ...semesterDraft, startsAt: event.target.value })} /></div><div className="form-group"><label htmlFor="semester-end">Ends</label><input id="semester-end" type="date" required value={semesterDraft.endsAt} onChange={(event) => setSemesterDraft({ ...semesterDraft, endsAt: event.target.value })} /></div></div><button className="button button-primary" disabled={busy}>Create semester</button></form>
      <form className="form-stack setup-card" onSubmit={(event) => { event.preventDefault(); void save(async () => { await createRoomType({ ...roomTypeDraft, capacity: Number(roomTypeDraft.capacity), semesterId: roomTypeDraft.semesterId, pricePesewas: Math.round(Number(roomTypeDraft.price) * 100) }); setRoomTypeDraft({ ...roomTypeDraft, name: '', price: '' }); }, 'Room type created.'); }}><h3>Add room type</h3><div className="form-group"><label htmlFor="type-name">Room type name</label><input id="type-name" required value={roomTypeDraft.name} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, name: event.target.value })} /></div><div className="form-row"><div className="form-group"><label htmlFor="type-capacity">Capacity</label><input id="type-capacity" type="number" min="1" max="20" required value={roomTypeDraft.capacity} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, capacity: event.target.value })} /></div><div className="form-group"><label htmlFor="type-price">Price (GHS)</label><input id="type-price" type="number" min="0.01" step="0.01" required value={roomTypeDraft.price} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, price: event.target.value })} /></div></div><div className="form-group"><label htmlFor="type-semester">Semester</label><select id="type-semester" required value={roomTypeDraft.semesterId} onChange={(event) => setRoomTypeDraft({ ...roomTypeDraft, semesterId: event.target.value })}><option value="">Choose semester</option>{semesters.map((semester) => <option key={semester.id} value={semester.id}>{semester.name}</option>)}</select></div><button className="button button-primary" disabled={busy}>Create room type</button></form>
    </div>
    <div className="table-wrap"><table><thead><tr><th>Semester</th><th>Dates</th><th>Status</th><th>Action</th></tr></thead><tbody>{semesters.map((semester) => <tr key={semester.id}><td>{semester.name}</td><td>{new Date(semester.startsAt).toLocaleDateString()} – {new Date(semester.endsAt).toLocaleDateString()}</td><td>{semester.status}</td><td>{semester.status !== 'ACTIVE' && semester.status !== 'CLOSED' && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void save(() => activateSemester(semester.id), 'Semester activated.')}>Activate</button>}{semester.status === 'ACTIVE' && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void save(() => closeSemester(semester.id), 'Semester closed.')}>Close</button>}</td></tr>)}{!semesters.length && <tr><td colSpan="4">No semesters configured.</td></tr>}</tbody></table></div>
    <p className="empty-state">{floors.length} floor(s) configured. Use the room inventory panel to add rooms to these floors.</p>
  </section>;
}

function InputerForm({ systemAdmin = false }) {
  const [draft, setDraft] = useState({ fullName: '', email: '', temporaryPassword: '', role: 'INPUTER' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const { role, ...account } = draft;
      await apiRequest(systemAdmin ? '/system/users' : '/admin/inputers', post(systemAdmin ? { ...account, role } : account));
      setDraft({ fullName: '', email: '', temporaryPassword: '', role: 'INPUTER' });
      setMessage(`${systemAdmin ? role : 'Inputer'} account created. Deliver its temporary password through a secure channel.`);
    } catch (err) { setError(err.message || 'Unable to create the Inputer account.'); }
    finally { setBusy(false); }
  }
  return <section className="admin-section"><div className="admin-section-header"><div><span className="eyebrow">{systemAdmin ? 'System administration' : 'Team'}</span><h2>{systemAdmin ? 'Create a system account' : 'Add an Inputer'}</h2>  <p>New accounts must change their temporary password and enroll Two-Factor Authentication (2FA) at first sign-in.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    <form className="form-stack admin-form" onSubmit={submit}><div className="form-row">
      <div className="form-group"><label htmlFor="inputer-name">Full name</label><input id="inputer-name" required minLength={2} maxLength={120} value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></div>
      <div className="form-group"><label htmlFor="inputer-email">Email</label><input id="inputer-email" type="email" required value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></div>
      <div className="form-group"><label htmlFor="inputer-password">Temporary password</label><input id="inputer-password" type="password" minLength={12} maxLength={128} required value={draft.temporaryPassword} onChange={(event) => setDraft({ ...draft, temporaryPassword: event.target.value })} /></div>
      {systemAdmin && <div className="form-group"><label htmlFor="account-role">Role</label><select id="account-role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })}>{targetRoles.map((role) => <option key={role}>{role}</option>)}</select></div>}
    </div><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : systemAdmin ? 'Create system account' : 'Create Inputer account'}</button></form>
  </section>;
}

function InputerAccounts({ administrator, actorId }) {
  const [users, setUsers] = useState([]);
  const [archive, setArchive] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(true);
  async function reload() {
    setBusy(true); setError('');
    try {
      const result = await fetchInputerAccounts(administrator);
      setUsers(result.users);
      setArchive(result.archive);
    } catch (err) { setError(err.message || 'Unable to load Inputer accounts.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    fetchInputerAccounts(administrator)
      .then((result) => {
        if (!active) return;
        setUsers(result.users);
        setArchive(result.archive);
      })
      .catch((err) => { if (active) setError(err.message || 'Unable to load Inputer accounts.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [administrator]);
  async function deactivate(user) {
    if (!window.confirm(`Deactivate Inputer account ${user.fullName} (${user.email})?`)) return;
    try {
      await apiRequest(`/admin/inputers/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      setMessage('Inputer account deactivated and active sessions revoked.');
      await reload();
    } catch (err) { setError(err.message || 'Unable to deactivate the Inputer account.'); }
  }
  async function changeRole(user, role) {
    if (user.roleProfile !== 'TARGET' && !window.confirm(`Explicitly map legacy ${user.role} to ${role}? This revokes sessions and requires a password change plus Two-Factor Authentication (2FA) enrollment.`)) {
      await reload();
      return;
    }
    try {
      await apiRequest(`/system/users/${encodeURIComponent(user.id)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      setMessage(`Role updated for ${user.email}. Their current sessions were revoked.`);
      await reload();
    } catch (err) { setError(err.message || 'Unable to change this user role.'); }
  }
  async function mapStudent(user) {
    if (!window.confirm(`Map ${user.email} from legacy STUDENT to the STUDENT portal only? This preserves the STUDENT role, revokes existing sessions, and requires a password change.`)) return;
    try {
      await apiRequest(`/system/users/${encodeURIComponent(user.id)}/map-student`, post({}));
      setMessage(`Mapped ${user.email} to the STUDENT portal. Their existing sessions were revoked.`);
      await reload();
    } catch (err) { setError(err.message || 'Unable to map this student account.'); }
  }
  async function restore(user) {
    try {
      await apiRequest(`/system/inputer-archive/${encodeURIComponent(user.id)}/restore`, post({}));
      setMessage(`Restored ${user.email}.`); await reload();
    } catch (err) { setError(err.message || 'Unable to restore this account.'); }
  }
  return <section className="admin-section"><div className="admin-section-header"><div><span className="eyebrow">{administrator ? 'System administration' : 'Operational administration'}</span><h2>{administrator ? 'User and recovery controls' : 'Inputer accounts'}</h2><p>{administrator ? 'Role changes, deactivated Inputer recovery, and account security state.' : 'Deactivate Inputer accounts only. Account history remains archived.'}</p></div><button className="button button-secondary" type="button" onClick={() => void reload()} disabled={busy}>Refresh</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {busy ? <p className="empty-state" role="status">Loading accounts…</p> : <div className="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Active</th><th>Two-Factor Authentication (2FA)</th><th>Actions</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}><td>{user.fullName}<span className="user-email">{user.email}</span></td><td>{administrator ? user.roleProfile === 'TARGET' ? <select aria-label={`Role for ${user.email}`} disabled={user.id === actorId} value={user.role} onChange={(event) => void changeRole(user, event.target.value)}>{targetRoles.map((role) => <option key={role}>{role}</option>)}</select> : user.role === 'STUDENT' ? <div><span>LEGACY STUDENT · unmapped</span><button className="button button-secondary" type="button" disabled={user.id === actorId || !user.isActive} onClick={() => void mapStudent(user)}>Map to STUDENT portal</button></div> : <div><span>LEGACY {user.role} · unmapped</span><select aria-label={`Map legacy ${user.role} account ${user.email}`} disabled={user.id === actorId} defaultValue="" onChange={(event) => { if (event.target.value) void changeRole(user, event.target.value); }}><option value="">Map only after review</option>{targetRoles.map((role) => <option key={role}>{role}</option>)}</select></div> : user.role}</td><td>{user.isActive ? 'Active' : 'Deactivated'}</td><td>{user.twoFactorEnabled ? 'Enabled' : 'Not enrolled'}</td><td>{user.roleProfile === 'TARGET' && user.role === 'INPUTER' && user.isActive && <button className="button button-secondary" type="button" onClick={() => void deactivate(user)}>Deactivate</button>}</td></tr>)}
      {!users.length && <tr><td colSpan="5">No accounts found.</td></tr>}
    </tbody></table></div>}
    {administrator && <div className="archive-list"><h3>Deleted Inputer archive</h3>{archive.length ? archive.map((user) => <div className="archive-row" key={user.id}><span>{user.fullName} · {user.email}</span><button className="button button-secondary" type="button" onClick={() => void restore(user)}>Restore</button></div>) : <p className="empty-state">No deactivated Inputer accounts.</p>}</div>}
  </section>;
}

function AuditPanel() {
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest('/admin/audit-logs').then((result) => setLogs(result.logs || [])).catch((err) => setError(err.message || 'Unable to load audit events.'));
  }, []);
  return <section className="admin-section"><div className="admin-section-header"><div><span className="eyebrow">Administrator-only</span><h2>Security audit trail</h2><p>Recent security-sensitive events. This API-backed log has no external tamper-evident anchor.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {logs.length ? <div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Record</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.action}</td><td>{log.actor?.fullName || 'System'}<span className="user-email">{log.actor?.email || ''}</span></td><td>{log.entityType}{log.entityId ? ` · ${log.entityId}` : ''}</td></tr>)}</tbody></table></div> : !error && <p className="empty-state">No audit events have been recorded.</p>}
  </section>;
}

export function SystemStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiRequest('/health').then(setStatus).catch((err) => setError(err.message || 'Status check failed.'));
  }, []);
  return <section className="admin-section"><span className="eyebrow">Operations</span><h2>System status</h2>
    {error ? <p className="form-error" role="alert">API/database status unavailable: {error}</p> : status ? <p className="form-success" role="status">API: {status.status}. Database: {status.database}.</p> : <p role="status">Checking API and database…</p>}
    <p>Backup/restore status: not currently recorded by the application. Do not treat this as confirmation of a recent backup or tested restore.</p>
  </section>;
}

export default function RoleDashboard({ user, role, onLogout }) {
  const details = roles[role];
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  if (!details || user.role !== role || user.roleProfile !== 'TARGET') return <main className="auth-shell"><section className="auth-card"><h1>Portal unavailable</h1><p>This account does not have access to this role portal.</p><PageBackLink to="/dashboard">Return to your dashboard</PageBackLink></section></main>;
  const isAdmin = role === 'ADMIN';
  const isAdministrator = role === 'ADMINISTRATOR';
  const canWriteRooms = role !== 'INPUTER' || user.role === 'INPUTER';
  return <div className="dashboard-page">
    <header className="dashboard-topbar"><Link className="brand" to="/dashboard"><span className="brand-mark">H</span><span>Hostel Management</span></Link><nav className="role-nav" aria-label={`${role} portal navigation`}><Link to={`/dashboard/${role.toLowerCase()}`}>Dashboard</Link>{role === 'INPUTER' && <a href="#room-inventory">Room records</a>}{role !== 'INPUTER' && <a href="#hostel-setup">Hostel setup</a>}{role === 'MANAGER' && <a href="#create-inputer">Add Inputer</a>}{isAdmin && <a href="#system-users">Inputer accounts</a>}{isAdministrator && <a href="#system-users">System administration</a>}<Link to="/status">System status</Link></nav><div className="dashboard-user"><div className="dashboard-user-meta"><strong>{user.fullName || user.name}</strong><span>{user.email}</span></div><button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button></div></header>
    <main className="dashboard">{!user.mustChangePassword && <><div className="dashboard-heading"><span className="eyebrow">{role} · Secure portal</span><h1>{details.title}</h1><p>{details.summary}</p><div className="hostel-account-line">Signed in as <strong>{user.fullName || user.name}</strong><span className="role-chip">{role}</span></div></div>
      <SystemStatus />
      {role !== 'INPUTER' && <div id="hostel-setup"><HostelSetup /></div>}
      <div id="room-inventory"><RoomEntry canWrite={canWriteRooms} /></div>
      {role === 'MANAGER' && <div id="create-inputer"><InputerForm /></div>}
      {isAdministrator && <div id="create-user"><InputerForm systemAdmin /></div>}
      {(isAdmin || isAdministrator) && <div id="system-users"><InputerAccounts administrator={isAdministrator} actorId={user.id} /></div>}
      {isAdministrator && <AuditPanel />}
      {isAdministrator && <section className="admin-section"><span className="eyebrow">Security controls</span><h2>Administrator-only controls</h2><p>The system menu provides user-role mapping, audit review, and deleted-Inputer recovery. Runtime security settings remain deployment-managed; backup and restore actions are not integrated in this MVP.</p></section>}
    </>}</main>
    {user.mustChangePassword && <div className="password-lock-backdrop"><section className="password-lock" role="dialog" aria-modal="true" aria-labelledby="required-password-title"><span className="eyebrow">First sign-in</span><h2 id="required-password-title">Change your temporary password</h2><p>Operations stay locked until you set a private password of at least 12 characters.</p>{passwordError && <p className="form-error" role="alert">{passwordError}</p>}{passwordMessage && <p className="form-success" role="status">{passwordMessage}</p>}<form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setPasswordError(''); setPasswordMessage(''); if (passwordDraft.password !== passwordDraft.confirmPassword) { setPasswordError('The new passwords do not match.'); return; } setChangingPassword(true); try { await changePassword({ currentPassword: passwordDraft.currentPassword, password: passwordDraft.password }); setPasswordMessage('Password changed. Sign in again to continue.'); window.setTimeout(onLogout, 1200); } catch (err) { setPasswordError(err.message || 'Unable to change your password.'); } finally { setChangingPassword(false); } }}><div className="form-group"><label htmlFor="current-password">Temporary password</label><input id="current-password" type="password" autoComplete="current-password" required value={passwordDraft.currentPassword} onChange={(event) => setPasswordDraft({ ...passwordDraft, currentPassword: event.target.value })} /></div><div className="form-group"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordDraft.password} onChange={(event) => setPasswordDraft({ ...passwordDraft, password: event.target.value })} /></div><div className="form-group"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={passwordDraft.confirmPassword} onChange={(event) => setPasswordDraft({ ...passwordDraft, confirmPassword: event.target.value })} /></div><button className="button button-primary" type="submit" disabled={changingPassword}>{changingPassword ? 'Changing password…' : 'Set new password'}</button><button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button></form></section></div>}
  </div>;
}
