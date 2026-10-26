import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { changePassword, getStudentDashboard } from '../services/hostelApi';
import '../App.css';

export default function StudentDashboard({ user, onLogout }) {
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    let active = true;
    getStudentDashboard()
      .then((result) => { if (active) setDashboard(result); })
      .catch((cause) => { if (active) setError(cause.message || 'Unable to load your student portal.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submitPasswordChange(event) {
    event.preventDefault();
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword({ currentPassword, password: newPassword });
      await onLogout();
    } catch (cause) {
      setPasswordError(cause.message || 'Unable to change your password.');
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-topbar">
        <Link className="brand" to="/dashboard"><span className="brand-mark">H</span><span>Hostel Management</span></Link>
        <div className="dashboard-user">
          <div className="dashboard-user-meta"><strong>{user.fullName || user.name}</strong><span>{user.email}</span></div>
          <button className="button button-secondary" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <main className="dashboard">
        <div className="dashboard-heading">
          <span className="eyebrow">STUDENT · Secure portal</span>
          <h1>Student dashboard</h1>
          <p>Your accommodation, notices, and maintenance requests.</p>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {user.mustChangePassword && (
          <section className="admin-section">
            <h2>Change your password before continuing</h2>
            {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
            <form className="form-stack" onSubmit={submitPasswordChange}>
              <div className="form-group"><label htmlFor="student-current-password">Current password</label><input id="student-current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
              <div className="form-group"><label htmlFor="student-new-password">New password</label><input id="student-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
              <div className="form-group"><label htmlFor="student-confirm-password">Confirm new password</label><input id="student-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
              <button className="button button-primary" type="submit" disabled={changingPassword}>{changingPassword ? 'Changing password…' : 'Change password'}</button>
            </form>
          </section>
        )}
        {loading ? <p className="empty-state" role="status">Loading your student dashboard…</p> : (
          <>
            <section className="admin-section">
              <div className="admin-section-header"><div><span className="eyebrow">Accommodation</span><h2>Current booking</h2></div></div>
              {dashboard?.booking ? (
                <div className="hostel-account-line">
                  <span>Room {dashboard.booking.roomNumber} · {dashboard.booking.block} · {dashboard.booking.floor}</span>
                  <span>{dashboard.booking.roomType} · Bed {dashboard.booking.bed}</span>
                  <span>Status: {dashboard.booking.status}</span>
                  <span>Paid: GHS {(dashboard.booking.totalPaidPesewas / 100).toFixed(2)} · Balance: GHS {(dashboard.booking.balancePesewas / 100).toFixed(2)}</span>
                </div>
              ) : <p className="empty-state">No current-semester booking was found.</p>}
            </section>
            <section className="admin-section">
              <div className="admin-section-header"><div><span className="eyebrow">Hostel updates</span><h2>Notices</h2></div></div>
              {dashboard?.notices?.length ? dashboard.notices.map((notice) => (
                <article className="archive-row" key={notice.id}><div><h3>{notice.title}</h3><p>{notice.body}</p><small>{notice.publishedAt ? new Date(notice.publishedAt).toLocaleString() : ''}</small></div></article>
              )) : <p className="empty-state">No notices are available.</p>}
            </section>
            <section className="admin-section">
              <div className="admin-section-header"><div><span className="eyebrow">Resident support</span><h2>Maintenance requests</h2></div></div>
              {dashboard?.maintenance?.length ? dashboard.maintenance.map((request) => (
                <article className="archive-row" key={request.id}><div><strong>{request.title || request.description || 'Maintenance request'}</strong><p>{request.status} · {request.room?.roomNumber || 'Room not assigned'}</p></div></article>
              )) : <p className="empty-state">No maintenance requests were found.</p>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
