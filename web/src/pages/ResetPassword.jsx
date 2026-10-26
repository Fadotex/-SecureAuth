import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resetPassword } from '../services/hostelApi';
import PageBackLink from '../components/PageBackLink';

function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (password !== confirm) return setError('The passwords do not match.');
    setLoading(true);
    setError('');
    try {
      await resetPassword({ token, password });
      setComplete(true);
    } catch (failure) {
      setError(failure.message || 'This reset link is invalid or expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell"><header className="auth-topbar"><Link className="brand" to="/" aria-label="Hostel home"><span className="brand-mark">H</span><span>Hostel Management</span></Link><PageBackLink to="/login">Back to sign in</PageBackLink></header><div className="auth-layout"><section className="auth-intro"><span className="eyebrow">Secure account recovery</span><h1>Choose a new password.</h1><p>Use at least 12 characters and avoid reusing a password from another service.</p></section><section className="auth-card"><div className="auth-card-heading"><h2>New password</h2><p>Your reset link can only be used once.</p></div>{error && <p className="form-error" role="alert">{error}</p>}{complete ? <><p className="form-success" role="status">Password updated. Sign in with your new password.</p><button className="button button-primary auth-submit" type="button" onClick={onDone}>Go to sign in</button></> : <form className="form-stack" onSubmit={submit}><div className="form-group"><label htmlFor="new-password">New password</label><input className="form-control" id="new-password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div><div className="form-group"><label htmlFor="confirm-password">Confirm new password</label><input className="form-control" id="confirm-password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div><button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button></form>}</section></div></main>
  );
}

export default ResetPassword;