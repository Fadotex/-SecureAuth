import { useState } from 'react';
import { Link } from 'react-router-dom';
import { loginUser } from '../services/hostelApi';
import PageBackLink from '../components/PageBackLink';

function PasswordVisibilityIcon({ visible }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {visible ? <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.7" /></> : <><path d="M3 3l18 18" /><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a15 15 0 0 1-3.1 3.7M6.6 6.6C3.6 8.3 2 12 2 12s3.6 6 10 6a10 10 0 0 0 3.4-.6" /></>}
    </svg>
  );
}

function Login({ onLogin, onRegister, onForgotPassword }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email address and password to continue.');
      return;
    }

    try {
      setLoading(true);
      const result = await loginUser({ email: email.trim(), password });
      if (result.mfaEnrollmentRequired) {
        onLogin({ email: email.trim(), challengeToken: result.challengeToken, requiresMfaSetup: true });
        return;
      }
      if (result.twoFactorRequired) {
        onLogin({ email: email.trim(), challengeToken: result.challengeToken, requires2FA: true });
        return;
      }
      onLogin({ ...result.user, token: result.token });
    } catch (err) {
      setError(err.message || 'Unable to sign in. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <Link className="brand" to="/" aria-label="Hostel Management home"><span className="brand-mark">H</span><span>Hostel Management</span></Link>
        <PageBackLink to="/">Back to home</PageBackLink>
      </header>
      <div className="auth-layout">
        <section className="auth-intro" aria-labelledby="login-title">
          <span className="eyebrow">Welcome back</span>
          <h1 id="login-title">Sign in to your hostel portal.</h1>
          <p>Sign in with your email and password, then complete Two-Factor Authentication (2FA) with your authenticator app. Target hostel staff roles enroll 2FA on their first sign-in.</p>
          <div className="auth-assurance">
            <span className="assurance-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
            <span>Your password is verified by the hostel server. Credentials are not stored in this browser.</span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="form-heading">
          <div className="auth-card-heading">
            <h2 id="form-heading">Sign in</h2>
            <p>Enter the details associated with your account.</p>
          </div>
          {error && <p className="form-error" role="alert" id="login-error">{error}</p>}
          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="login-email">Email address</label>
              <input className="form-control" id="login-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck="false" required maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
            </div>
            <div className="form-group">
              <div className="form-label-row"><label htmlFor="login-password">Password</label><button className="button-text" type="button" onClick={onForgotPassword}>Forgot password?</button></div>
              <div className="password-wrap">
                <input className="form-control" id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={256} placeholder="Enter your password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'login-error' : undefined} />
                <button className="icon-button password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}><PasswordVisibilityIcon visible={showPassword} /></button>
              </div>
            </div>
            <button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Continue securely'}</button>
          </form>
          <p className="auth-switch"><span>New student resident?</span><button className="button-text" type="button" onClick={onRegister}>Register here</button></p>
        </section>
      </div>
    </main>
  );
}

export default Login;
