import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import TwoFactor from './pages/TwoFactor';
import RoleDashboard, { SystemStatus } from './pages/RoleDashboard';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import StudentDashboard from './pages/StudentDashboard';
import PageBackLink from './components/PageBackLink';
import { refreshSession, signOut, verifyEmail } from './services/hostelApi';
import {
  createInputer,
  createHostelResident,
  createHostelRoom,
  deleteInputer,
  getAdminUsers,
  getHostelResidents,
  getHostelRooms,
  getHostelSummary,
  updateUserRole,
} from './services/api';
import './App.css';

const targetRoles = new Set(['INPUTER', 'MANAGER', 'ADMIN', 'ADMINISTRATOR']);
const portalRoles = new Set([...targetRoles, 'STUDENT']);

function dashboardPath(user) {
  if (user?.roleProfile === 'TARGET' && user.role === 'STUDENT') return '/dashboard/student';
  return user?.roleProfile === 'TARGET' && targetRoles.has(user.role) ? `/dashboard/${user.role.toLowerCase()}` : '/dashboard';
}

function Icon({ name, size = 18 }) {
  const icon = {
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></>,
    key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
  }[name];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon}
    </svg>
  );
}

function Brand({ className = '' }) {
  return (
    <Link className={`brand ${className}`} to="/" aria-label="Hostel Management home">
      <span className="brand-mark">H</span>
      <span>Hostel Management</span>
    </Link>
  );
}

function Home({ onLogin, onRegister }) {
  return (
    <div className="site">
      <header className="site-header">
        <nav className="site-nav" aria-label="Main navigation">
          <Brand />
          <div className="site-nav-links">
            <a href="#security">Security</a>
            <a href="#features">Features</a>
            <a href="#about">About</a>
          </div>
          <div className="site-nav-actions">
            <button className="button button-secondary" type="button" onClick={onLogin}>Sign in</button>
            <button className="button button-primary" type="button" onClick={onRegister}>Get started</button>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow">Student accommodation, clearly managed</span>
            <h1 id="hero-title">Hostel management.<span>Made straightforward.</span></h1>
            <p className="hero-description">
              Find a room, manage semester payments, follow hostel notices, and get support from one resident workspace.
            </p>
            <div className="hero-actions">
              <button className="button button-primary" type="button" onClick={onRegister}>Create an account</button>
              <button className="button button-secondary" type="button" onClick={onLogin}>Sign in</button>
            </div>
            <ul className="hero-meta" aria-label="Available security features">
              <li><span className="meta-dot" aria-hidden="true" />Authenticator-based Two-Factor Authentication (2FA)</li>
              <li><span className="meta-dot" aria-hidden="true" />Four account roles</li>
            </ul>
          </div>

          <aside className="flow-panel" aria-label="Hostel services">
            <div className="flow-panel-head">
              <span className="flow-panel-title">Resident services</span>
              <span className="flow-panel-caption">One workspace</span>
            </div>
            <ol className="flow-list">
              <li className="flow-item">
                <span className="flow-number">01</span>
                <div><h2>Choose a room</h2><p>See available beds by room type and block.</p></div>
              </li>
              <li className="flow-item">
                <span className="flow-number">02</span>
                <div><h2>Pay securely</h2><p>Track semester fees and mobile-money payments.</p></div>
              </li>
              <li className="flow-item">
                <span className="flow-number">03</span>
                <div><h2>Stay informed</h2><p>Get notices and request help with your room.</p></div>
              </li>
            </ol>
          </aside>
        </section>

        <section className="section" id="security" aria-labelledby="security-title">
          <div className="container">
            <div className="section-heading">
              <span className="eyebrow">Hostel operations</span>
              <h2 id="security-title">Everything residents and staff need to keep things moving.</h2>
              <p>Room inventory, resident services and fee tracking stay connected to the selected semester.</p>
            </div>
            <div className="feature-grid" id="features">
              <article className="feature-card">
                <span className="feature-icon"><Icon name="key" /></span>
                <h3>Room availability</h3>
                <p>Browse rooms by capacity and see remaining beds before choosing.</p>
              </article>
              <article className="feature-card">
                <span className="feature-icon"><Icon name="lock" /></span>
                <h3>Mobile-money payments</h3>
                <p>Pay by MTN MoMo or Telecel Cash and keep a receipt for each confirmed payment.</p>
              </article>
              <article className="feature-card">
                <span className="feature-icon"><Icon name="users" /></span>
                <h3>Resident support</h3>
                <p>Read hostel notices, report maintenance issues and request a room transfer.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section" id="about" aria-labelledby="about-title">
          <div className="container about-layout">
            <div>
              <span className="eyebrow">Designed for daily operations</span>
              <div className="section-heading">
                <h2 id="about-title">Each role gets the tools it needs.</h2>
                <p>Residents manage their stay; staff handle front-desk work; administrators manage the hostel and its finances.</p>
              </div>
              <ul className="principle-list">
                <li><span>01</span><strong>Students find rooms and track fees.</strong></li>
                <li><span>02</span><strong>Staff search residents and record office payments.</strong></li>
                <li><span>03</span><strong>Security logs visitors and check-ins.</strong></li>
                <li><span>04</span><strong>Administrators manage rooms, staff and reports.</strong></li>
              </ul>
            </div>
            <aside className="about-note">
              <p>Private student and guardian details are restricted by role, while important account and payment actions are recorded for review.</p>
            </aside>
          </div>
        </section>

        <section className="container site-cta" aria-labelledby="cta-title">
          <div>
            <h2 id="cta-title">Ready to manage your hostel stay?</h2>
            <p>Sign in to view your accommodation or register as a student resident.</p>
          </div>
          <button className="button" type="button" onClick={onRegister}>Create an account</button>
        </section>
      </main>

      <footer className="container site-footer">
        <Brand />
        <p>Rooms, residents and hostel operations.</p>
        <small>Hostel Management · 2026</small>
      </footer>
    </div>
  );
}

export function LegacyDashboard({ user, onLogout, onEnable2FA }) {
  const [adminUsers, setAdminUsers] = useState(null);
  const [adminError, setAdminError] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [hasLoadedUsers, setHasLoadedUsers] = useState(false);
  const [inputerDraft, setInputerDraft] = useState({ name: '', email: '', password: '' });
  const [inputerMessage, setInputerMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const canManageTeam = ['manager', 'administrator'].includes(user.role);
  const canAdminister = ['admin', 'administrator'].includes(user.role);
  const canManageHostel = ['manager', 'admin', 'administrator'].includes(user.role);
  const [hostelSummary, setHostelSummary] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [residents, setResidents] = useState([]);
  const [hostelError, setHostelError] = useState('');
  const [hostelLoading, setHostelLoading] = useState(true);
  const [hostelRefresh, setHostelRefresh] = useState(0);
  const [roomDraft, setRoomDraft] = useState({ roomNumber: '', block: 'Block A', type: 'Single', rent: '', capacity: '1' });
  const [residentDraft, setResidentDraft] = useState({ name: '', studentId: '', roomId: 'unassigned', block: 'Block A', feeBalance: '' });

  useEffect(() => {
    let active = true;
    async function loadHostel() {
      setHostelLoading(true);
      setHostelError('');
      const results = await Promise.allSettled([
        getHostelRooms(),
        getHostelResidents(),
        canManageHostel ? getHostelSummary() : Promise.resolve(null),
      ]);
      if (!active) return;

      const errors = [];
      if (results[0].status === 'fulfilled') setRooms(results[0].value.rooms || []);
      else errors.push(results[0].reason.message || 'Could not load rooms.');
      if (results[1].status === 'fulfilled') setResidents(results[1].value.residents || []);
      else errors.push(results[1].reason.message || 'Could not load residents.');
      if (results[2].status === 'fulfilled') setHostelSummary(results[2].value?.summary || null);
      else errors.push(results[2].reason.message || 'Could not load the hostel summary.');

      setHostelError(errors.join(' '));
      setHostelLoading(false);
    }

    loadHostel();
    return () => { active = false; };
  }, [user.role, hostelRefresh, canManageHostel]);

  async function addRoom(event) {
    event.preventDefault();
    setHostelError('');
    try {
      const result = await createHostelRoom({
        roomNumber: roomDraft.roomNumber.trim(),
        block: roomDraft.block.trim(),
        type: roomDraft.type,
        rent: Number(roomDraft.rent),
        capacity: Number(roomDraft.capacity),
        occupied: 0,
        status: 'Available',
      });
      setRooms((current) => [result.room, ...current]);
      setRoomDraft({ roomNumber: '', block: 'Block A', type: 'Single', rent: '', capacity: '1' });
      setHostelSummary((current) => current ? {
        ...current,
        totalRooms: current.totalRooms + 1,
        availableRooms: current.availableRooms + 1,
        revenueTarget: current.revenueTarget + Number(result.room.rent || 0),
      } : current);
    } catch (error) {
      setHostelError(error.message || 'Could not add the room.');
    }
  }

  async function addResident(event) {
    event.preventDefault();
    setHostelError('');
    try {
      const result = await createHostelResident({
        ...residentDraft,
        name: residentDraft.name.trim(),
        studentId: residentDraft.studentId.trim(),
        feeBalance: Number(residentDraft.feeBalance || 0),
        status: 'Active',
      });
      setResidents((current) => [result.resident, ...current]);
      setResidentDraft({ name: '', studentId: '', roomId: 'unassigned', block: 'Block A', feeBalance: '' });
      setHostelSummary((current) => current ? {
        ...current,
        totalResidents: current.totalResidents + 1,
        outstandingFees: current.outstandingFees + Number(result.resident.feeBalance || 0),
      } : current);
    } catch (error) {
      setHostelError(error.message || 'Could not add the resident.');
    }
  }

  async function loadAdminUsers() {
    setAdminError('');
    setIsLoadingUsers(true);
    try {
      const result = await getAdminUsers();
      setAdminUsers(result.users);
      setHasLoadedUsers(true);
    } catch (error) {
      setAdminError(error.message || 'Unable to load user accounts.');
    } finally {
      setIsLoadingUsers(false);
    }
  }

  async function addInputer(event) {
    event.preventDefault();
    setAdminError('');
    setInputerMessage('');
    setIsCreating(true);
    try {
      const result = await createInputer(inputerDraft);
      setInputerDraft({ name: '', email: '', password: '' });
      setInputerMessage('Inputer account created. Share the temporary password securely.');
      if (adminUsers) setAdminUsers((current) => [...current, result.user]);
    } catch (error) {
      setAdminError(error.message || 'Unable to create inputer account.');
    } finally {
      setIsCreating(false);
    }
  }

  async function removeInputer(account) {
    if (!window.confirm(`Remove inputer account for ${account.name}?`)) return;
    setAdminError('');
    try {
      await deleteInputer(account.id);
      setAdminUsers((current) => current?.filter((entry) => entry.id !== account.id) || []);
    } catch (error) {
      setAdminError(error.message || 'Unable to remove inputer account.');
    }
  }

  async function changeRole(account, role) {
    setAdminError('');
    try {
      const result = await updateUserRole(account.id, role);
      setAdminUsers((current) => current?.map((entry) => entry.id === account.id ? result.user : entry) || []);
    } catch (error) {
      setAdminError(error.message || 'Unable to change account role.');
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-topbar">
        <Brand />
        <div className="dashboard-user">
          <div className="dashboard-user-meta"><strong>{user.name}</strong><span>{user.email}</span></div>
          <button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <main className="dashboard">
        <div className="dashboard-heading">
          <span className="eyebrow">Hostel operations</span>
          <h1>Hostel management</h1>
          <p>Manage room availability, resident details and occupancy from one workspace.</p>
          <div className="hostel-account-line">Signed in as <strong>{user.name}</strong><span className="role-chip">{user.role}</span></div>
        </div>

        {hostelError && <p className="form-error" role="alert">{hostelError}</p>}

        {canManageHostel && (
          <section className="hostel-stats" aria-label="Hostel summary">
            <article className="hostel-stat"><span>Total rooms</span><strong>{hostelSummary?.totalRooms ?? '—'}</strong></article>
            <article className="hostel-stat"><span>Occupied</span><strong>{hostelSummary?.occupiedRooms ?? '—'}</strong></article>
            <article className="hostel-stat"><span>Available</span><strong>{hostelSummary?.availableRooms ?? '—'}</strong></article>
            <article className="hostel-stat"><span>Residents</span><strong>{hostelSummary?.totalResidents ?? '—'}</strong></article>
            <article className="hostel-stat"><span>Outstanding fees</span><strong>GHS {hostelSummary?.outstandingFees ?? '—'}</strong></article>
          </section>
        )}

        <section className="admin-section hostel-section" aria-labelledby="rooms-heading">
          <div className="admin-section-header">
            <div><span className="eyebrow">Accommodation</span><h2 id="rooms-heading">Room inventory</h2><p>Availability, capacity and rent by room.</p></div>
            <button className="button button-secondary" type="button" onClick={() => setHostelRefresh((value) => value + 1)} disabled={hostelLoading}>{hostelLoading ? 'Loading…' : 'Refresh'}</button>
          </div>
          {canManageHostel && (
            <form className="hostel-form" onSubmit={addRoom}>
              <div className="form-group"><label htmlFor="room-number">Room number</label><input className="form-control" id="room-number" required maxLength={30} value={roomDraft.roomNumber} onChange={(event) => setRoomDraft({ ...roomDraft, roomNumber: event.target.value })} /></div>
              <div className="form-group"><label htmlFor="room-block">Block</label><input className="form-control" id="room-block" required maxLength={60} value={roomDraft.block} onChange={(event) => setRoomDraft({ ...roomDraft, block: event.target.value })} /></div>
              <div className="form-group"><label htmlFor="room-type">Room type</label><select className="form-control" id="room-type" value={roomDraft.type} onChange={(event) => setRoomDraft({ ...roomDraft, type: event.target.value })}><option>Single</option><option>2-in-1</option><option>3-in-1</option><option>4-in-1</option></select></div>
              <div className="form-group"><label htmlFor="room-rent">Rent (GHS)</label><input className="form-control" id="room-rent" type="number" min="0" step="0.01" required value={roomDraft.rent} onChange={(event) => setRoomDraft({ ...roomDraft, rent: event.target.value })} /></div>
              <div className="form-group"><label htmlFor="room-capacity">Capacity</label><input className="form-control" id="room-capacity" type="number" min="1" max="20" required value={roomDraft.capacity} onChange={(event) => setRoomDraft({ ...roomDraft, capacity: event.target.value })} /></div>
              <button className="button button-primary" type="submit">Add room</button>
            </form>
          )}
          {rooms.length ? (
            <div className="hostel-table-wrap"><table className="hostel-table"><thead><tr><th>Room</th><th>Type</th><th>Capacity</th><th>Rent</th><th>Status</th></tr></thead><tbody>{rooms.map((room) => (
              <tr key={room.id}><td>{room.roomNumber}<span className="user-email">{room.block}</span></td><td>{room.type}</td><td>{room.occupied}/{room.capacity}</td><td>GHS {Number(room.rent).toFixed(2)}</td><td><span className={`hostel-status ${room.status === 'Occupied' ? 'is-occupied' : ''}`}>{room.status}</span></td></tr>
            ))}</tbody></table></div>
          ) : <p className="empty-state">{hostelLoading ? 'Loading room inventory…' : 'No rooms are available yet.'}</p>}
        </section>

        <section className="admin-section hostel-section" aria-labelledby="residents-heading">
          <div className="admin-section-header">
            <div><span className="eyebrow">Resident register</span><h2 id="residents-heading">Current residents</h2><p>Resident identity, room assignment and fee balance.</p></div>
          </div>
          <form className="hostel-form resident-form" onSubmit={addResident}>
            <div className="form-group"><label htmlFor="resident-name">Full name</label><input className="form-control" id="resident-name" required maxLength={100} value={residentDraft.name} onChange={(event) => setResidentDraft({ ...residentDraft, name: event.target.value })} /></div>
            <div className="form-group"><label htmlFor="student-id">Student ID</label><input className="form-control" id="student-id" required maxLength={50} value={residentDraft.studentId} onChange={(event) => setResidentDraft({ ...residentDraft, studentId: event.target.value })} /></div>
            <div className="form-group"><label htmlFor="resident-room">Room assignment</label><select className="form-control" id="resident-room" value={residentDraft.roomId} onChange={(event) => {
              const room = rooms.find((entry) => entry.id === event.target.value);
              setResidentDraft({ ...residentDraft, roomId: event.target.value, block: room?.block || residentDraft.block });
            }}><option value="unassigned">Unassigned</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.block} · {room.roomNumber}</option>)}</select></div>
            <div className="form-group"><label htmlFor="resident-block">Block</label><input className="form-control" id="resident-block" required maxLength={60} value={residentDraft.block} onChange={(event) => setResidentDraft({ ...residentDraft, block: event.target.value })} /></div>
            <div className="form-group"><label htmlFor="fee-balance">Fee balance (GHS)</label><input className="form-control" id="fee-balance" type="number" min="0" step="0.01" value={residentDraft.feeBalance} onChange={(event) => setResidentDraft({ ...residentDraft, feeBalance: event.target.value })} /></div>
            <button className="button button-primary" type="submit">Add resident</button>
          </form>
          {residents.length ? (
            <div className="hostel-table-wrap"><table className="hostel-table"><thead><tr><th>Resident</th><th>Student ID</th><th>Room</th><th>Fee balance</th><th>Status</th></tr></thead><tbody>{residents.map((resident) => {
              const room = rooms.find((entry) => entry.id === resident.roomId);
              return <tr key={resident.id}><td>{resident.name}<span className="user-email">{resident.block}</span></td><td>{resident.studentId}</td><td>{room ? room.roomNumber : 'Unassigned'}</td><td>GHS {Number(resident.feeBalance).toFixed(2)}</td><td><span className="hostel-status">{resident.status}</span></td></tr>;
            })}</tbody></table></div>
          ) : <p className="empty-state">{hostelLoading ? 'Loading resident register…' : 'No residents are registered yet.'}</p>}
          <p className="hostel-data-note">Hostel room and resident data is currently held in server memory and resets when the API restarts.</p>
        </section>

        <section className="dashboard-overview" aria-label="Account security summary">
          <article className="overview-card">
            <div className="overview-card-top"><span>Account</span><span className="overview-card-icon"><Icon name="user" /></span></div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <span className="role-chip">{user.role || 'inputer'}</span>
          </article>
          <article className="overview-card">
            <div className="overview-card-top"><span>Password sign-in</span><span className="overview-card-icon"><Icon name="key" /></span></div>
            <h2>Enabled</h2>
            <p>Your account uses password authentication.</p>
            <div className="status-line"><span className="status-mark" aria-hidden="true" />Password sign-in available</div>
          </article>
          <article className="overview-card">
            <div className="overview-card-top"><span>Two-Factor Authentication (2FA)</span><span className="overview-card-icon"><Icon name="lock" /></span></div>
            <h2>{user.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</h2>
            <p>{user.twoFactorEnabled ? 'An authenticator code is required at sign-in.' : 'Add an authenticator code for another verification step.'}</p>
            {user.twoFactorEnabled ? (
              <div className="status-line"><span className="status-mark" aria-hidden="true" />Authenticator connected</div>
            ) : (
              <div className="dashboard-action"><button className="button button-secondary" type="button" onClick={onEnable2FA}>Set up authenticator</button></div>
            )}
          </article>
        </section>

        {canManageTeam && (
          <section className="admin-section" aria-labelledby="team-heading">
            <div className="admin-section-header">
              <div><span className="eyebrow">Team access</span><h2 id="team-heading">Add an inputer</h2><p>Create an account for a team member who enters data.</p></div>
            </div>
            <form className="inputer-form" onSubmit={addInputer}>
              <div className="form-group"><label htmlFor="inputer-name">Full name</label><input className="form-control" id="inputer-name" required maxLength={100} value={inputerDraft.name} onChange={(event) => setInputerDraft({ ...inputerDraft, name: event.target.value })} /></div>
              <div className="form-group"><label htmlFor="inputer-email">Email address</label><input className="form-control" id="inputer-email" required type="email" maxLength={254} value={inputerDraft.email} onChange={(event) => setInputerDraft({ ...inputerDraft, email: event.target.value })} /></div>
              <div className="form-group"><label htmlFor="inputer-password">Temporary password</label><input className="form-control" id="inputer-password" required type="password" minLength={8} maxLength={256} autoComplete="new-password" value={inputerDraft.password} onChange={(event) => setInputerDraft({ ...inputerDraft, password: event.target.value })} /></div>
              <button className="button button-primary" type="submit" disabled={isCreating}>{isCreating ? 'Creating…' : 'Create inputer'}</button>
            </form>
            {inputerMessage && <p className="form-success" role="status">{inputerMessage}</p>}
            {adminError && <p className="form-error" role="alert">{adminError}</p>}
          </section>
        )}

        {canAdminister && (
          <section className="admin-section" aria-labelledby="users-heading">
            <div className="admin-section-header">
              <div><span className="eyebrow">Administration</span><h2 id="users-heading">User accounts</h2><p>Manage roles and remove inputer accounts.</p></div>
              <button className="button button-secondary" type="button" onClick={loadAdminUsers} disabled={isLoadingUsers}>{isLoadingUsers ? 'Refreshing…' : 'Refresh list'}</button>
            </div>
            {adminError && !canManageTeam && <p className="form-error" role="alert">{adminError}</p>}
            {isLoadingUsers && !adminUsers ? <p className="empty-state" role="status">Loading accounts…</p> : adminUsers?.length ? (
              <div className="user-table-wrap">
                <table className="user-table">
                  <thead><tr><th scope="col">Account</th><th scope="col">Role</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{adminUsers.map((account) => (
                    <tr key={account.id}>
                      <td>{account.name}<span className="user-email">{account.email}</span></td>
                      <td>{user.role === 'administrator' ? (
                        <select aria-label={`Role for ${account.name}`} value={account.role} disabled={account.id === user.id} onChange={(event) => changeRole(account, event.target.value)}>
                          <option value="inputer">Inputer</option><option value="manager">Manager</option><option value="admin">Admin</option>
                        </select>
                      ) : <span className="role-chip">{account.role}</span>}</td>
                      <td>{account.role === 'inputer' && <button className="button button-danger" type="button" onClick={() => removeInputer(account)}>Remove</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="empty-state">{hasLoadedUsers ? 'No user accounts were returned.' : 'Refresh the list to view existing accounts.'}</p>}
          </section>
        )}
      </main>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [emailMessage, setEmailMessage] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    refreshSession()
      .then((result) => {
        if (active && result.user) setUser(result.user);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setSessionReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (location.pathname !== '/verify-email') return undefined;
    const verificationToken = new URLSearchParams(location.search).get('token');
    if (!verificationToken) {
      navigate('/email-verified', {
        replace: true,
        state: { message: 'This verification link is invalid or expired.' },
      });
      return undefined;
    }

    let active = true;
    verifyEmail(verificationToken)
      .then(() => {
        if (!active) return;
        setEmailMessage('Email verified. You can sign in now.');
        navigate('/login', { replace: true });
      })
      .catch((error) => {
        if (!active) return;
        navigate('/email-verified', {
          replace: true,
          state: { message: error.message || 'This verification link is invalid or expired.' },
        });
      });
    return () => { active = false; };
  }, [location.pathname, location.search, navigate]);

  function handleLogin(loginUser) {
    if (loginUser.requiresMfaSetup) {
      setUser({ email: loginUser.email, requiresMfaSetup: true });
      setChallenge(loginUser.challengeToken);
      navigate('/two-factor/enroll');
      return;
    }
    if (loginUser.requires2FA) {
      setUser({ email: loginUser.email, requires2FA: true });
      setChallenge(loginUser.challengeToken);
      navigate('/two-factor');
      return;
    }
    setUser(loginUser);
    navigate(dashboardPath(loginUser));
  }

  function handleVerified(verifiedUser) {
    setChallenge(null);
    setUser(verifiedUser);
    navigate(dashboardPath(verifiedUser));
  }

  function handleLogout() {
    void signOut().finally(() => {
      setUser(null);
      setChallenge(null);
      navigate('/login', { replace: true });
    });
  }

  return (
    <Routes>
      <Route path="/" element={<Home onLogin={() => navigate('/login')} onRegister={() => navigate('/register')} />} />
      <Route
        path="/login"
        element={<><Login onLogin={handleLogin} onRegister={() => navigate('/register')} onForgotPassword={() => navigate('/forgot-password')} />{emailMessage && <div className="auth-notice" role="status">{emailMessage}</div>}</>}
      />
      <Route path="/register" element={<Register onRegistered={() => navigate('/login')} onLogin={() => navigate('/login')} />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route
        path="/reset-password"
        element={<ResetPassword token={new URLSearchParams(location.search).get('token') || ''} onDone={() => navigate('/login', { replace: true })} />}
      />
      <Route
        path="/verify-email"
        element={<main className="auth-shell"><p className="form-info route-loading" role="status">Verifying your email…</p></main>}
      />
      <Route
        path="/email-verified"
        element={<main className="auth-shell"><section className="auth-card verification-result"><h1>{location.state?.message || emailMessage || 'Email verification is complete.'}</h1><PageBackLink to="/login">Back to sign in</PageBackLink></section></main>}
      />
      <Route
        path="/two-factor"
        element={sessionReady && user?.requires2FA && challenge
          ? <TwoFactor user={user} challenge={challenge} mode="verify" onVerified={handleVerified} />
          : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
      />
      <Route
        path="/two-factor/enroll"
        element={sessionReady && user?.requiresMfaSetup && challenge
          ? <TwoFactor user={user} challenge={challenge} mode="enroll" onVerified={handleVerified} />
          : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
      />
      <Route
        path="/two-factor/setup"
        element={sessionReady && user && !user.requires2FA
          ? <TwoFactor user={user} mode="setup" onVerified={handleVerified} />
          : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
      />
      <Route
        path="/dashboard"
        element={sessionReady && user && !user.requires2FA
          ? user.roleProfile === 'TARGET' && portalRoles.has(user.role)
            ? <Navigate to={dashboardPath(user)} replace />
            : <LegacyRoleNotice user={user} onLogout={handleLogout} />
          : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
      />
      <Route
        path="/dashboard/student"
        element={sessionReady && user && user.role === 'STUDENT' && user.roleProfile === 'TARGET' && !user.requires2FA
          ? <StudentDashboard user={user} onLogout={handleLogout} />
          : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
      />
      {['INPUTER', 'MANAGER', 'ADMIN', 'ADMINISTRATOR'].map((role) => (
        <Route
          key={role}
          path={`/dashboard/${role.toLowerCase()}`}
          element={sessionReady && user && !user.requires2FA && !user.requiresMfaSetup
            ? user.roleProfile === 'TARGET' && user.role === role
              ? <RoleDashboard user={user} role={role} onLogout={handleLogout} />
              : <Navigate to={dashboardPath(user)} replace />
            : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
        />
      ))}
      <Route path="/status" element={sessionReady && user && user.roleProfile === 'TARGET' && targetRoles.has(user.role)
        ? <SystemStatusPage user={user} onLogout={handleLogout} />
        : sessionReady ? <Navigate to="/login" replace /> : <SessionLoading />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LegacyRoleNotice({ user, onLogout }) {
  return <main className="auth-shell"><section className="auth-card"><span className="eyebrow">Legacy role retained</span><h1>Portal mapping required</h1><p>Your account still has the legacy role <strong>{user.role}</strong>. It has not been silently converted. An administrator must review and map this account before it can use a target-role portal.</p><button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button></section></main>;
}

function SystemStatusPage({ user, onLogout }) {
  return <div className="dashboard-page"><header className="dashboard-topbar"><Link className="brand" to="/dashboard"><span className="brand-mark">H</span><span>Hostel Management</span></Link><div className="dashboard-user"><div className="dashboard-user-meta"><strong>{user.fullName || user.name}</strong><span>{user.email}</span></div><button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button></div></header><main className="dashboard"><div className="dashboard-heading"><span className="eyebrow">Operations</span><h1>System status</h1><p>Live API and database connectivity, and truthful backup/restore status.</p></div><SystemStatus /></main></div>;
}

function SessionLoading() {
  return <main className="auth-shell"><p className="form-info route-loading" role="status">Checking your session…</p></main>;
}

export default App;
