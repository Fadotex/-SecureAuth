import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { enableAuthenticator, setupAuthenticator, setupRequiredAuthenticator, verifyLoginCode, verifyRequiredAuthenticator } from '../services/hostelApi';
import PageBackLink from '../components/PageBackLink';

function TwoFactor({ user, challenge, mode, onVerified }) {
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [completedUser, setCompletedUser] = useState(null);
  const tokenRef = useRef(null);
  const isRequiredEnrollment = mode === 'enroll';
  const isSetup = mode === 'setup' || isRequiredEnrollment;
  const validCode = usingRecoveryCode && !isSetup ? /^[A-Za-z0-9_-]{16}$/.test(token) : /^\d{6}$/.test(token);

  async function handleSetup() {
    setError('');
    setMessage('');
    try {
      setSettingUp(true);
      const result = isRequiredEnrollment ? await setupRequiredAuthenticator(challenge) : await setupAuthenticator();
      setSecret(result.secret || '');
      setMessage('Setup key ready. Add it to your authenticator app, then verify a current code.');
      window.setTimeout(() => tokenRef.current?.focus(), 0);
    } catch (err) {
      setError(err.message || 'Unable to start authenticator setup.');
    } finally {
      setSettingUp(false);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setMessage('Setup key copied. Keep it private and remove it from your clipboard when finished.');
    } catch {
      setMessage('Clipboard access is unavailable. Select and copy the setup key manually.');
    }
  }

  async function handleVerify(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!validCode) {
      setError(usingRecoveryCode ? 'Enter the full 16-character unused recovery code.' : 'Enter all six digits from your authenticator app.');
      tokenRef.current?.focus();
      return;
    }

    try {
      setLoading(true);
      const result = isRequiredEnrollment
        ? await verifyRequiredAuthenticator(challenge, token)
        : isSetup ? await enableAuthenticator(token) : await verifyLoginCode(challenge, token);
      if (isRequiredEnrollment) {
        setRecoveryCodes(result.recoveryCodes || []);
        setCompletedUser(result.user);
        setMessage('Two-Factor Authentication (2FA) is enabled. Save these single-use recovery codes somewhere private before continuing.');
        return;
      }
      setMessage(isSetup ? 'Authenticator verified. Two-Factor Authentication (2FA) is enabled.' : 'Code verified. Signing you in…');
      window.setTimeout(() => onVerified(isSetup ? { ...user, twoFactorEnabled: true } : result.user), 500);
    } catch (err) {
      setError(err.message || 'Unable to verify the code. Check your connection and try again.');
      setToken('');
      tokenRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  function handlePaste(event) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      event.preventDefault();
      setToken(pasted);
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <Link className="brand" to="/" aria-label="Hostel Management home"><span className="brand-mark">H</span><span>Hostel Management</span></Link>
        <PageBackLink to={isRequiredEnrollment ? '/login' : isSetup ? '/dashboard' : '/login'}>{isSetup ? (isRequiredEnrollment ? 'Back to sign in' : 'Back to account overview') : 'Back to sign in'}</PageBackLink>
      </header>
      <div className="auth-layout">
        <section className="auth-intro" aria-labelledby="two-factor-title">
          <span className="eyebrow">Two-Factor Authentication (2FA)</span>
          <h1 id="two-factor-title">{isSetup ? 'Set up Two-Factor Authentication (2FA).' : 'Verify your sign-in with 2FA.'}</h1>
          <p>{isSetup ? 'Your authenticator app creates a time-based code used in addition to your password.' : 'Enter the current six-digit code from your authenticator app to complete Two-Factor Authentication (2FA).'}</p>
          <div className="auth-assurance">
            <span className="assurance-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
            <span>{isSetup ? 'Your setup key is shown only during enrollment. Store it in your authenticator app, not in notes or messages.' : `Verification for ${user.email || 'your hostel account'}.`}</span>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="form-heading">
          <div className="auth-card-heading">
            <h2 id="form-heading">{isSetup ? 'Connect authenticator' : 'Enter your code'}</h2>
            <p>{isSetup ? 'Complete the steps below to enable Two-Factor Authentication (2FA).' : 'The code refreshes regularly. Use the latest one shown in your app.'}</p>
          </div>

          {error && <p className="form-error" role="alert" id="otp-error">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          {recoveryCodes.length > 0 && (
            <div className="secret-block" aria-label="Single-use recovery codes">
              <div className="secret-header"><span className="secret-label">Recovery codes — shown once</span></div>
              <div className="recovery-code-list">{recoveryCodes.map((code) => <code className="secret-value" key={code}>{code}</code>)}</div>
              <button className="button button-primary auth-submit" type="button" onClick={() => onVerified(completedUser)}>I saved my recovery codes</button>
            </div>
          )}

          {isSetup && !secret && recoveryCodes.length === 0 ? (
            <>
              <ol className="setup-steps">
                <li className="setup-step"><span className="setup-step-number">1</span><span>Open Google Authenticator, Microsoft Authenticator, or another TOTP app.</span></li>
                <li className="setup-step"><span className="setup-step-number">2</span><span>Start adding an account and choose the option to enter a setup key manually.</span></li>
                <li className="setup-step"><span className="setup-step-number">3</span><span>Return here to enter the six-digit code from the app.</span></li>
              </ol>
              <button className="button button-primary auth-submit" type="button" onClick={handleSetup} disabled={settingUp}>{settingUp ? 'Preparing setup…' : 'Generate setup key'}</button>
            </>
          ) : !isSetup || (secret && recoveryCodes.length === 0) ? (
            <>
              {isSetup && (
                <>
                  <div className="secret-block">
                    <div className="secret-header"><span className="secret-label">Manual setup key</span><button className="copy-button" type="button" onClick={copySecret}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>Copy key</button></div>
                    <code className="secret-value">{secret}</code>
                  </div>
                  <ol className="setup-steps">
                    <li className="setup-step"><span className="setup-step-number">1</span><span>Add this key to your authenticator app as a time-based code.</span></li>
                    <li className="setup-step"><span className="setup-step-number">2</span><span>Enter the six-digit code currently shown to confirm the setup.</span></li>
                  </ol>
                </>
              )}

              <form className="form-stack" onSubmit={handleVerify}>
                <div className="form-group">
                  <label htmlFor="two-factor-code">{usingRecoveryCode ? 'Single-use recovery code' : 'Six-digit authentication code'}</label>
                  <input ref={tokenRef} className="form-control code-input" id="two-factor-code" name={usingRecoveryCode ? 'recovery-code' : 'one-time-code'} type="text" inputMode={usingRecoveryCode ? 'text' : 'numeric'} pattern={usingRecoveryCode ? '[A-Za-z0-9_-]{16}' : '[0-9]{6}'} maxLength={usingRecoveryCode ? 16 : 6} autoComplete={usingRecoveryCode ? 'off' : 'one-time-code'} autoFocus={!isSetup} required placeholder={usingRecoveryCode ? 'Enter recovery code' : '000000'} value={token} onPaste={usingRecoveryCode ? undefined : handlePaste} onChange={(event) => { setToken(usingRecoveryCode ? event.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) : event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'otp-error' : undefined} />
                </div>
                <button className="button button-primary auth-submit" type="submit" disabled={loading || !validCode}>{loading ? 'Checking code…' : isSetup ? 'Verify and enable' : 'Verify and sign in'}</button>
              </form>
              {!isSetup && <button className="copy-button" type="button" onClick={() => { setUsingRecoveryCode((value) => !value); setToken(''); setError(''); }}>{usingRecoveryCode ? 'Use authenticator code' : 'Use a recovery code'}</button>}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default TwoFactor;
