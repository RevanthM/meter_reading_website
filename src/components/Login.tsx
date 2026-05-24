import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Lock,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  User,
  Mail,
  Phone,
  CheckCircle,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import LoginSplitArt from './LoginSplitArt';
import {
  anicaLogin,
  anicaRegister,
  anicaSendOtp,
  anicaValidateOtp,
  assertAnicaUserCanSignIn,
  enrichAnicaLoginProfile,
  envelopeErrorMessage,
  getAnicaLoginAppl,
  getAnicaLoginAppForOtp,
  getAnicaLoginDefaultRegisterRole,
  getAnicaLoginRole,
  getOrCreateClientFingerprint,
  getStoredDeviceId,
  isAnicaLoginSuccess,
  parseDeviceIdFromEntity,
  parseEntityJson,
  setStoredDeviceId,
  assertSuccess,
  type AnicaLoginSessionUser,
} from '../services/anicaLoginAuth';

type LoginSplitShellProps = {
  children: React.ReactNode;
  /** Narrow column (OTP, loading) */
  compact?: boolean;
};

function LoginBrandMark() {
  return (
    <div className="login-brand">
      <div className="login-brand__icon" aria-hidden>
        <img
          className="login-brand__icon-img"
          src={`${import.meta.env.BASE_URL}login-brand-icon.png`}
          width={1024}
          height={1024}
          alt=""
          decoding="async"
        />
      </div>
      <div className="login-brand__text">
        <div className="login-brand__wordmark">
          <span className="login-brand__meter">Analog Meter </span>
          <span className="login-brand__reading">Reading</span>
        </div>
        <p className="login-brand__tagline">Smart meter reading portal</p>
      </div>
    </div>
  );
}

function LoginSplitShell({ children, compact }: LoginSplitShellProps) {
  return (
    <div className="login-page login-page--split">
      <ThemeToggle variant="floating" />
      <aside className="login-split-art" aria-hidden>
        <LoginSplitArt />
      </aside>
      <div className="login-split-main">
        <div
          className={['login-split-main-inner', compact ? 'login-split-main-inner--compact' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

type LoginSsoRowProps = {
  onMicrosoft: () => void;
  ssoComingSoon: boolean;
};

function LoginSsoRow({ onMicrosoft, ssoComingSoon }: LoginSsoRowProps) {
  return (
    <div className="login-sso-after-form">
      <div className="login-divider" aria-hidden>
        <span>Or continue with</span>
      </div>
      <div className="login-sso-row">
        <button type="button" className="login-sso-btn login-sso-btn--full" onClick={onMicrosoft}>
          <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden>
            <path fill="#f25022" d="M1 1h9v9H1z" />
            <path fill="#00a4ef" d="M1 11h9v9H1z" />
            <path fill="#7fba00" d="M11 1h9v9h-9z" />
            <path fill="#ffb900" d="M11 11h9v9h-9z" />
          </svg>
          Continue with Microsoft
        </button>
      </div>
      {ssoComingSoon && (
        <p className="login-sso-notice login-sso-notice--below-sso" role="status">
          Microsoft SSO is not enabled in this environment yet.
        </p>
      )}
    </div>
  );
}

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    anicaLoginUser,
    isAuthorized,
    loading,
    completeAnicaLoginSession,
  } = useAuth();

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [ssoComingSoon, setSsoComingSoon] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [regUserId, setRegUserId] = useState('');
  const [regFirstName, setRegFirstName] = useState('');
  const [regLastName, setRegLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const pendingRegLoginRef = useRef<{ userId: string; password: string } | null>(null);
  const [registerOtpOpen, setRegisterOtpOpen] = useState(false);
  const [registerOtpCode, setRegisterOtpCode] = useState('');

  const clearPostRegisterOtp = () => {
    setRegisterOtpOpen(false);
    setRegisterOtpCode('');
    pendingRegLoginRef.current = null;
  };

  useEffect(() => {
    if (loading) return;
    if ((user || anicaLoginUser) && isAuthorized) {
      navigate('/', { replace: true });
    }
  }, [user, anicaLoginUser, isAuthorized, loading, navigate]);

  useEffect(() => {
    const openRegister =
      searchParams.get('register') === '1' || searchParams.get('mode') === 'register';
    if (!openRegister) return;
    setAuthMode('register');
    setAgreeTerms(false);
    setFormError(null);
    setSsoComingSoon(false);
    setRegisterSuccess(null);
    setRegisterOtpOpen(false);
    setRegisterOtpCode('');
    pendingRegLoginRef.current = null;
    const next = new URLSearchParams(searchParams);
    next.delete('register');
    next.delete('mode');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const dismissError = () => setFormError(null);

  const finishAnicaLogin = (profile: AnicaLoginSessionUser, loginUserId: string) => {
    const enriched = enrichAnicaLoginProfile(profile, loginUserId);
    assertAnicaUserCanSignIn(enriched, loginUserId);
    completeAnicaLoginSession(enriched);
  };

  const handleSsoClick = () => {
    setFormError(null);
    setSsoComingSoon(true);
  };

  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !password) return;

    setSubmitting(true);
    setFormError(null);
    setSsoComingSoon(false);
    try {
      const serverDevice = getStoredDeviceId();
      const deviceForRequest = serverDevice || getOrCreateClientFingerprint();
      const hadServerDevice = !!serverDevice;

      const env = await anicaLogin(userId.trim(), password, deviceForRequest);
      if (!isAnicaLoginSuccess(env)) {
        throw new Error(envelopeErrorMessage(env));
      }

      if (hadServerDevice) {
        const profile = parseEntityJson(env.entityJson) as AnicaLoginSessionUser | null;
        if (!profile || Object.keys(profile).length === 0) {
          throw new Error('Login succeeded but user profile was missing. Try signing in again after clearing saved device data.');
        }
        finishAnicaLogin(profile, userId.trim());
        navigate('/', { replace: true });
        return;
      }

      const send = await anicaSendOtp(userId.trim(), getAnicaLoginAppl(), getAnicaLoginRole());
      assertSuccess(send);
      setOtpSent(true);
      setStep('otp');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const send = await anicaSendOtp(userId.trim(), getAnicaLoginAppl(), getAnicaLoginRole());
      assertSuccess(send);
      setOtpSent(true);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not resend code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cred = pendingRegLoginRef.current;
    if (!cred) {
      setFormError('Verification session expired. Sign in with your user ID.');
      setRegisterOtpOpen(false);
      return;
    }
    if (registerOtpCode.replace(/\D/g, '').length < 6) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const val = await anicaValidateOtp(
        cred.userId,
        registerOtpCode.replace(/\D/g, ''),
        getAnicaLoginAppForOtp(),
      );
      assertSuccess(val);
      const deviceId = parseDeviceIdFromEntity(val.entityJson);
      if (!deviceId) {
        throw new Error('OTP verified but no device ID was returned.');
      }
      setStoredDeviceId(deviceId);

      clearPostRegisterOtp();
      setUserId(cred.userId);
      setRegisterSuccess(
        'Your account has been verified. An administrator must assign your portal role before you can sign in.',
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendRegisterOtp = async () => {
    const cred = pendingRegLoginRef.current;
    if (!cred) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const send = await anicaSendOtp(cred.userId, getAnicaLoginAppl(), getAnicaLoginRole());
      assertSuccess(send);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not resend code.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRegisterOtpModal = () => {
    clearPostRegisterOtp();
    setUserId(regUserId.trim());
    setAuthMode('signin');
    setFormError(null);
    setSsoComingSoon(false);
    setRegisterSuccess(null);
  };

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!otp.trim() || otp.replace(/\D/g, '').length < 6) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const val = await anicaValidateOtp(userId.trim(), otp.replace(/\D/g, ''), getAnicaLoginAppForOtp());
      assertSuccess(val);
      const deviceId = parseDeviceIdFromEntity(val.entityJson);
      if (!deviceId) {
        throw new Error('OTP verified but no device ID was returned.');
      }
      setStoredDeviceId(deviceId);

      const again = await anicaLogin(userId.trim(), password, deviceId);
      if (!isAnicaLoginSuccess(again)) {
        throw new Error(envelopeErrorMessage(again));
      }
      const profile = parseEntityJson(again.entityJson) as AnicaLoginSessionUser | null;
      if (!profile || Object.keys(profile).length === 0) {
        throw new Error('Login succeeded but user profile was missing.');
      }
      finishAnicaLogin(profile, userId.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setOtp('');
    setOtpSent(false);
    setFormError(null);
  };

  const goToRegisterFromOtp = () => {
    backToCredentials();
    setAuthMode('register');
    setRegisterSuccess(null);
    clearPostRegisterOtp();
  };

  const switchAuthMode = (mode: 'signin' | 'register') => {
    clearPostRegisterOtp();
    setAuthMode(mode);
    setFormError(null);
    setSsoComingSoon(false);
    setAgreeTerms(false);
    if (mode === 'signin') {
      setRegisterSuccess(null);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreeTerms) {
      setFormError('Please agree to the Terms & Conditions and Privacy Policy to continue.');
      return;
    }
    if (!regUserId.trim() || !regFirstName.trim() || !regLastName.trim() || !regEmail.trim() || !regPhone.trim() || !regPassword) {
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setRegisterSuccess(null);
    try {
      const env = await anicaRegister({
        UserID: regUserId.trim(),
        FirstName: regFirstName.trim(),
        LastName: regLastName.trim(),
        EMailID: regEmail.trim(),
        PhoneNum: regPhone.trim(),
        password: regPassword,
        appl: getAnicaLoginAppl(),
        Role: getAnicaLoginDefaultRegisterRole(),
      });
      if (!isAnicaLoginSuccess(env)) {
        throw new Error(envelopeErrorMessage(env));
      }

      const uid = regUserId.trim();
      const pwd = regPassword;
      pendingRegLoginRef.current = { userId: uid, password: pwd };
      setRegPassword('');
      setRegisterOtpCode('');
      setRegisterOtpOpen(true);
      setFormError(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <LoginSplitShell>
        <div className="login-card login-panel">
          <div className="login-loading login-loading--split login-loading--in-card">
            <Loader2 size={44} className="spin" />
            <p>Authenticating…</p>
          </div>
        </div>
      </LoginSplitShell>
    );
  }

  if (step === 'otp') {
    return (
      <LoginSplitShell>
        <div className="login-card login-panel">
          <div className="login-header">
            <LoginBrandMark />
            <div className="login-page-heading">
              <h1 className="login-page-heading__title">Device verification</h1>
              <p className="login-page-heading__sub">
                {otpSent
                  ? 'Enter the code sent to the email on file for your account.'
                  : 'Preparing verification…'}
              </p>
            </div>
          </div>

          {formError && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{formError}</span>
              <button type="button" onClick={dismissError} className="dismiss-error">&times;</button>
            </div>
          )}

          <form onSubmit={handleOtpSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="login-otp">Security code</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="login-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(ev) => setOtp(ev.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="123456"
                  required
                  autoFocus
                  maxLength={8}
                />
              </div>
            </div>

            <button
              type="submit"
              className={['login-submit', submitting ? '' : 'login-submit--cta'].filter(Boolean).join(' ')}
              disabled={submitting || otp.replace(/\D/g, '').length < 6}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Verifying…
                </>
              ) : (
                'Verify and proceed'
              )}
            </button>
          </form>

          <div className="login-footer login-footer--row">
            <button
              type="button"
              className="login-link-btn"
              onClick={handleResendOtp}
              disabled={submitting}
            >
              Resend code
            </button>
            <button type="button" className="login-link-btn" onClick={backToCredentials}>
              Return to sign-in
            </button>
            <button type="button" className="login-link-btn" onClick={goToRegisterFromOtp}>
              Register
            </button>
          </div>
        </div>
      </LoginSplitShell>
    );
  }

  return (
    <>
    <LoginSplitShell>
      <div className={`login-card login-panel ${authMode === 'register' ? 'login-card--register' : ''}`}>
        <div className="login-header">
          <LoginBrandMark />
          <div className="login-page-heading">
            <h1 className="login-page-heading__title">
              {authMode === 'signin'
                ? 'Sign In'
                : registerSuccess && !registerOtpOpen
                  ? 'Account verified'
                  : 'Create an Account'}
            </h1>
            <p className="login-page-heading__sub">
              {authMode === 'signin' ? (
                <>
                  Need directory access?{' '}
                  <button type="button" className="login-inline-link" onClick={() => switchAuthMode('register')}>
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button type="button" className="login-inline-link" onClick={() => switchAuthMode('signin')}>
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
          {authMode === 'register' && registerOtpOpen && (
            <p className="login-header-context">
              Enter the verification code from your email in the dialog to finish setup.
            </p>
          )}
          {authMode === 'register' && !registerSuccess && !registerOtpOpen && (
            <p className="login-header-context">
              Request directory access. Approval may be required.
            </p>
          )}
          {authMode === 'register' && registerSuccess && !registerOtpOpen && (
            <p className="login-header-context">
              Account verified. Sign in once an administrator has assigned your portal role.
            </p>
          )}
        </div>

        {formError && (
          <div className="login-error">
            <AlertCircle size={16} />
            <span>{formError}</span>
            <button type="button" onClick={dismissError} className="dismiss-error">&times;</button>
          </div>
        )}

        {authMode === 'register' && registerSuccess && !registerOtpOpen && (
          <div className="login-success-banner">
            <CheckCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ margin: 0 }}>{registerSuccess}</p>
              <button
                type="button"
                className="login-link-btn"
                style={{ marginTop: '0.5rem' }}
                onClick={() => {
                  switchAuthMode('signin');
                  setUserId(regUserId.trim());
                }}
              >
                Continue to sign-in
              </button>
            </div>
          </div>
        )}

        {authMode === 'signin' && (
          <>
            <form onSubmit={handleCredentialsSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="userid">User ID</label>
                <div className="input-wrapper">
                  <User size={18} className="input-icon" />
                  <input
                    id="userid"
                    type="text"
                    value={userId}
                    onChange={(ev) => setUserId(ev.target.value)}
                    placeholder="john_doe"
                    required
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className={['login-submit', submitting ? '' : 'login-submit--cta'].filter(Boolean).join(' ')}
                disabled={submitting || !userId.trim() || !password}
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>

            <LoginSsoRow onMicrosoft={handleSsoClick} ssoComingSoon={ssoComingSoon} />
          </>
        )}

        {authMode === 'register' && !registerSuccess && !registerOtpOpen && (
          <form onSubmit={handleRegisterSubmit} className="login-form login-register-form">
            <div className="form-group login-reg-span-2">
              <label htmlFor="reg-userid">User ID</label>
              <div className="input-wrapper">
                <User size={18} className="input-icon" />
                <input
                  id="reg-userid"
                  type="text"
                  value={regUserId}
                  onChange={(ev) => setRegUserId(ev.target.value)}
                  placeholder="john_doe"
                  required
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="reg-first">First name</label>
              <div className="input-wrapper">
                <User size={18} className="input-icon" />
                <input
                  id="reg-first"
                  type="text"
                  value={regFirstName}
                  onChange={(ev) => setRegFirstName(ev.target.value)}
                  placeholder="John"
                  required
                  autoComplete="given-name"
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="reg-last">Last name</label>
              <div className="input-wrapper">
                <User size={18} className="input-icon" />
                <input
                  id="reg-last"
                  type="text"
                  value={regLastName}
                  onChange={(ev) => setRegLastName(ev.target.value)}
                  placeholder="Doe"
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="form-group login-reg-span-2">
              <label htmlFor="reg-email">Email address</label>
              <div className="input-wrapper">
                <Mail size={18} className="input-icon" />
                <input
                  id="reg-email"
                  type="email"
                  value={regEmail}
                  onChange={(ev) => setRegEmail(ev.target.value)}
                  placeholder="john@example.com"
                  required
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="form-group login-reg-span-2">
              <label htmlFor="reg-phone">Phone</label>
              <div className="input-wrapper">
                <Phone size={18} className="input-icon" />
                <input
                  id="reg-phone"
                  type="tel"
                  value={regPhone}
                  onChange={(ev) => setRegPhone(ev.target.value)}
                  placeholder="+11234567890"
                  required
                  autoComplete="tel"
                />
              </div>
            </div>
            <div className="form-group login-reg-span-2">
              <label htmlFor="reg-password">Password</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="reg-password"
                  type={showRegPassword ? 'text' : 'password'}
                  value={regPassword}
                  onChange={(ev) => setRegPassword(ev.target.value)}
                  placeholder="Choose a password"
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowRegPassword(!showRegPassword)}
                  tabIndex={-1}
                >
                  {showRegPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <label className="login-terms login-reg-span-2">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(ev) => setAgreeTerms(ev.target.checked)}
              />
              <span>
                I agree to the{' '}
                <a href="#terms" className="login-terms__link" onClick={(ev) => ev.preventDefault()}>
                  Terms {'&'} Conditions
                </a>
                {' '}and{' '}
                <a href="#privacy" className="login-terms__link" onClick={(ev) => ev.preventDefault()}>
                  Privacy Policy
                </a>
                .
              </span>
            </label>

            <button
              type="submit"
              className={['login-submit', 'login-reg-span-2', submitting ? '' : 'login-submit--cta']
                .filter(Boolean)
                .join(' ')}
              disabled={
                submitting
                || !agreeTerms
                || !regUserId.trim()
                || !regFirstName.trim()
                || !regLastName.trim()
                || !regEmail.trim()
                || !regPhone.trim()
                || !regPassword
              }
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Submitting registration…
                </>
              ) : (
                'Sign up'
              )}
            </button>
          </form>
        )}

        {authMode === 'signin' && (
          <div className="login-footer">
            <p>
              First access from this browser may require device verification by email. For credential or access issues,
              contact your IT administrator.
            </p>
          </div>
        )}
      </div>
    </LoginSplitShell>

    {registerOtpOpen && (
      <div
        className="login-modal-overlay"
        role="presentation"
        aria-hidden={!registerOtpOpen}
      >
        <div
          className="login-modal login-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="register-otp-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="login-header login-modal-header login-modal-header--brand">
            <LoginBrandMark />
            <div className="login-page-heading">
              <h1 id="register-otp-title" className="login-page-heading__title">
                Complete registration
              </h1>
              <p className="login-page-heading__sub">
                Enter the code sent to your registered email to finish setup.
              </p>
            </div>
          </div>

          {formError && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{formError}</span>
              <button type="button" onClick={dismissError} className="dismiss-error">&times;</button>
            </div>
          )}

          <form onSubmit={handleRegisterOtpSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="register-post-otp">Security code</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="register-post-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={registerOtpCode}
                  onChange={(ev) => setRegisterOtpCode(ev.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="123456"
                  required
                  autoFocus
                  maxLength={8}
                />
              </div>
            </div>

            <button
              type="submit"
              className={['login-submit', submitting ? '' : 'login-submit--cta'].filter(Boolean).join(' ')}
              disabled={submitting || registerOtpCode.replace(/\D/g, '').length < 6}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Verifying…
                </>
              ) : (
                'Verify and sign in'
              )}
            </button>
          </form>

          <div className="login-footer login-footer--row login-modal-footer">
            <button
              type="button"
              className="login-link-btn"
              onClick={handleResendRegisterOtp}
              disabled={submitting}
            >
              Resend code
            </button>
            <button type="button" className="login-link-btn" onClick={cancelRegisterOtpModal}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Login;
