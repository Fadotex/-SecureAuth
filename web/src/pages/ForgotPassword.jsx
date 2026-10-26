import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../services/hostelApi';
import PageBackLink from '../components/PageBackLink';

function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (failure) {
      setError(failure.message || 'Unable to request a reset link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-topbar"><Link className="brand" to="/" aria-label="Hostel home"><span className="brand-mark">H</span><span>Hostel Management</span></Link><PageBackLink to="/login">Back to sign in</PageBackLink></header>
      <div className="auth-layout">
        <section className="auth-intro"><span className="eyebrow">Password reset</span><h1>Get back into your account.</h1><p>We’ll send a one-time reset link if an account matches the email address.</p></section>
        <section className="auth-card">
          <div className="auth-card-heading"><h2>Reset password</h2><p>Enter the email address used for your hostel account.</p></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {sent ? <p className="form-success" role="status">If that account exists, a reset link has been sent.</p> : <form className="form-stack" onSubmit={submit}><div className="form-group"><label htmlFor="reset-email">Email address</label><input className="form-control" id="reset-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div><button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button></form>}
        </section>
      </div>
    </main>
  );
}

export default ForgotPassword;