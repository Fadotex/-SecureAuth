import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getDevelopmentVerificationLink, registerStudent } from '../services/hostelApi';
import PageBackLink from '../components/PageBackLink';

function EyeIcon({ visible }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {visible ? <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.7"/></> : <><path d="M3 3l18 18"/><path d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a15 15 0 0 1-3.1 3.7M6.6 6.6C3.6 8.3 2 12 2 12s3.6 6 10 6a10 10 0 0 0 3.4-.6"/></>}
    </svg>
  );
}

function Register({ onRegistered, onLogin }) {
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [gender, setGender] = useState('FEMALE');
  const [consent, setConsent] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [loadingVerification, setLoadingVerification] = useState(false);

  async function loadDevelopmentVerificationLink() {
    setVerificationError('');
    setLoadingVerification(true);
    try {
      const result = await getDevelopmentVerificationLink((verificationEmail || email).trim().toLowerCase());
      setVerificationUrl(result.url);
    } catch (err) {
      setVerificationError(err.message || 'No pending local verification link was found.');
    } finally {
      setLoadingVerification(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess(false);

    if (password.length < 12 || password.length > 128) {
      setError('Use a password between 12 and 128 characters.');
      return;
    }
    if (!consent) {
      setError('Please accept the privacy notice to create your resident account.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match. Check both fields and try again.');
      return;
    }

    try {
      setLoading(true);
      await registerStudent({
        studentId: studentId.trim(),
        fullName: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        guardianName: guardianName.trim() || undefined,
        guardianPhone: guardianPhone.trim() || undefined,
        gender,
        password,
        consent: true,
      });
      setVerificationEmail(email.trim().toLowerCase());
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Unable to create the account. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <Link className="brand" to="/" aria-label="Hostel Management home"><span className="brand-mark">H</span><span>Hostel Management</span></Link>
        <PageBackLink to="/login">Back to sign in</PageBackLink>
      </header>
      <div className="auth-layout register-layout">
        <section className="auth-intro" aria-labelledby="register-title">
          <span className="eyebrow">Create your account</span>
          <h1 id="register-title">Start with a secure sign-in.</h1>
          <p>Your account begins with password authentication. You can add an authenticator code after signing in.</p>
          <div className="auth-assurance">
            <span className="assurance-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4Z"/><path d="m9 12 2 2 4-4"/></svg></span>
            <span>Your password is transformed on the server before it is stored. It is not saved in the browser.</span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="form-heading">
          <div className="auth-card-heading">
            <h2 id="form-heading">Student registration</h2>
            <p>Your account is created with the Student role. Verify your email before signing in.</p>
          </div>
          {error && <p className="form-error" role="alert" id="register-error">{error}</p>}
          {success && <p className="form-success" role="status">Account created. Verify your email before signing in.</p>}
          {import.meta.env.DEV && (
            <section aria-label="Local email verification" className="form-stack">
              <p className="form-info">Local development only: retrieve the pending verification link for an existing account.</p>
              <div className="form-group">
                <label htmlFor="local-verification-email">Email address</label>
                <input
                  className="form-control"
                  id="local-verification-email"
                  type="email"
                  autoComplete="email"
                  value={verificationEmail || email}
                  onChange={(event) => { setVerificationEmail(event.target.value); setVerificationUrl(''); setVerificationError(''); }}
                />
              </div>
              <button className="button button-secondary" type="button" onClick={loadDevelopmentVerificationLink} disabled={loadingVerification || !(verificationEmail || email).trim()}>
                {loadingVerification ? 'Loading link…' : 'Get local verification link'}
              </button>
              {verificationError && <p className="form-error" role="alert">{verificationError}</p>}
              {verificationUrl && <p><a href={verificationUrl} rel="noreferrer">Verify this email</a></p>}
            </section>
          )}
          {!success ? (
            <form className="form-stack register-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="register-student-id">Student ID</label>
                <input className="form-control" id="register-student-id" required maxLength={40} autoComplete="off" placeholder="e.g. 202600123" value={studentId} onChange={(event) => { setStudentId(event.target.value); setError(''); }} />
              </div>
              <div className="form-group">
                <label htmlFor="register-name">Full name</label>
                <input className="form-control" id="register-name" name="name" type="text" autoComplete="name" required maxLength={100} placeholder="Your name" value={name} onChange={(event) => { setName(event.target.value); setError(''); }} />
              </div>
              <div className="form-group">
                <label htmlFor="register-email">Email address</label>
                <input className="form-control" id="register-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck="false" required maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} />
              </div>
              <div className="form-group">
                <label htmlFor="register-phone">Mobile money phone</label>
                <input className="form-control" id="register-phone" type="tel" required maxLength={32} autoComplete="tel" placeholder="024 000 0000" value={phone} onChange={(event) => { setPhone(event.target.value); setError(''); }} />
              </div>
              <div className="form-group">
                <label htmlFor="register-gender">Accommodation block</label>
                <select className="form-control" id="register-gender" required value={gender} onChange={(event) => setGender(event.target.value)}><option value="FEMALE">Female block preference</option><option value="MALE">Male block preference</option></select>
                <span className="form-helper">This saves a gender preference; a specific block is assigned separately.</span>
              </div>
              <div className="form-group">
                <label htmlFor="register-guardian">Guardian / emergency contact name</label>
                <input className="form-control" id="register-guardian" required minLength={2} maxLength={120} value={guardianName} onChange={(event) => setGuardianName(event.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="register-guardian-phone">Guardian / emergency contact phone</label>
                <input className="form-control" id="register-guardian-phone" type="tel" required minLength={7} maxLength={32} value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="register-password">Password</label>
                <div className="password-wrap">
                  <input className="form-control" id="register-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="password-requirement" placeholder="At least 12 characters" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} />
                  <button className="icon-button password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}><EyeIcon visible={showPassword} /></button>
                </div>
                <span className="form-helper" id="password-requirement">Use at least 12 characters.</span>
              </div>
              <div className="form-group">
                <label htmlFor="register-confirm">Confirm password</label>
                <div className="password-wrap">
                  <input className="form-control" id="register-confirm" name="confirmPassword" type={showConfirm ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} aria-invalid={Boolean(confirmPassword && confirmPassword !== password)} placeholder="Enter the password again" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }} />
                  <button className="icon-button password-toggle" type="button" onClick={() => setShowConfirm((value) => !value)} aria-label={showConfirm ? 'Hide confirmation' : 'Show confirmation'} aria-pressed={showConfirm}><EyeIcon visible={showConfirm} /></button>
                </div>
                {confirmPassword && confirmPassword !== password && <span className="form-helper" role="status">The passwords do not match yet.</span>}
              </div>
              <label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); setError(''); }} /><span>I consent to the hostel using my student and contact information to manage accommodation, fees and safety, as described in the privacy notice.</span></label>
              <button className="button button-primary auth-submit" type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
            </form>
          ) : (
            <button className="button button-primary auth-submit" type="button" onClick={onRegistered}>Continue to sign in</button>
          )}
          <p className="auth-switch"><span>Already have an account?</span><button className="button-text" type="button" onClick={onLogin}>Sign in</button></p>
        </section>
      </div>
    </main>
  );
}

export default Register;
