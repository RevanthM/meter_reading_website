import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Gauge, Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, Smartphone } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const {
    user, isAuthorized, login, error, clearError, loading,
    mfaRequired, mfaPhoneHint, sendMfaCode, verifyMfaCode,
    sendEmailCode, verifyEmailCode,
  } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSent, setMfaSent] = useState(false);
  const [mfaSending, setMfaSending] = useState(false);
  const [useEmailMfa, setUseEmailMfa] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [fallbackCode, setFallbackCode] = useState<string | null>(null);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user && isAuthorized && !loading) {
      navigate('/', { replace: true });
    }
  }, [user, isAuthorized, loading, navigate]);

  useEffect(() => {
    if (mfaRequired && !mfaSent && !useEmailMfa && recaptchaRef.current) {
      setMfaSending(true);
      sendMfaCode(recaptchaRef.current)
        .then(() => setMfaSent(true))
        .catch((err) => {
          console.error('Failed to send MFA code:', err);
        })
        .finally(() => setMfaSending(false));
    }
  }, [mfaRequired, mfaSent, useEmailMfa, sendMfaCode]);

  const handleResendCode = () => {
    if (recaptchaRef.current) {
      setMfaSent(false);
      setMfaSending(true);
      sendMfaCode(recaptchaRef.current)
        .then(() => setMfaSent(true))
        .catch((err) => {
          console.error('Failed to resend MFA code:', err);
        })
        .finally(() => setMfaSending(false));
    }
  };

  const handleSendEmailCode = async () => {
    setEmailSending(true);
    setFallbackCode(null);
    clearError();
    try {
      const result = await sendEmailCode();
      setEmailCodeSent(true);
      if (result.code) {
        setFallbackCode(result.code);
      }
    } catch {
      // error set by context
    } finally {
      setEmailSending(false);
    }
  };

  const handleEmailMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.length < 6) return;
    setSubmitting(true);
    try {
      await verifyEmailCode(mfaCode);
    } catch {
      // error set by context
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      // error state is set by login()
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfaCode || mfaCode.length < 6) return;

    setSubmitting(true);
    try {
      await verifyMfaCode(mfaCode);
    } catch {
      // error state is set by verifyMfaCode()
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-loading">
          <Loader2 size={48} className="spin" />
          <p>Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (mfaRequired && useEmailMfa) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <Mail size={48} strokeWidth={1.5} />
            </div>
            <h1>Email Verification</h1>
            <p>
              {!emailCodeSent
                ? 'We\'ll send a verification code to your email'
                : 'Enter the code sent to your email'}
            </p>
          </div>

          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button onClick={clearError} className="dismiss-error">&times;</button>
            </div>
          )}

          {fallbackCode && (
            <div className="login-error" style={{ background: '#eff6ff', borderColor: '#3b82f6', color: '#1e40af' }}>
              <span>Your code: <strong style={{ letterSpacing: '3px', fontSize: '18px' }}>{fallbackCode}</strong></span>
            </div>
          )}

          {!emailCodeSent ? (
            <div className="login-form">
              <button
                className="login-submit"
                onClick={handleSendEmailCode}
                disabled={emailSending}
              >
                {emailSending ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Sending...
                  </>
                ) : (
                  'Send Code to Email'
                )}
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailMfaSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="email-mfa-code">Verification Code</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    id="email-mfa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    required
                    autoFocus
                    maxLength={6}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="login-submit"
                disabled={submitting || mfaCode.length < 6}
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify'
                )}
              </button>
            </form>
          )}

          <div className="login-footer">
            <p>
              <button
                type="button"
                onClick={() => { setUseEmailMfa(false); setEmailCodeSent(false); setMfaCode(''); setFallbackCode(null); clearError(); }}
                style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}
              >
                Use SMS verification instead
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (mfaRequired) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <Smartphone size={48} strokeWidth={1.5} />
            </div>
            <h1>Verification Required</h1>
            <p>
              {mfaSending
                ? 'Sending verification code...'
                : `Enter the code sent to ${mfaPhoneHint || 'your phone'}`}
            </p>
          </div>

          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
              <button onClick={clearError} className="dismiss-error">&times;</button>
            </div>
          )}

          <form onSubmit={handleMfaSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="mfa-code">Verification Code</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  autoFocus
                  maxLength={6}
                />
              </div>
            </div>

            <button
              type="submit"
              className="login-submit"
              disabled={submitting || mfaCode.length < 6 || !mfaSent}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Verifying...
                </>
              ) : (
                'Verify'
              )}
            </button>
          </form>

          <div className="login-footer">
            <p>
              Didn't receive the code?{' '}
              <button
                type="button"
                onClick={handleResendCode}
                disabled={mfaSending}
                style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}
              >
                {mfaSending ? 'Sending...' : 'Resend code'}
              </button>
              {' | '}
              <button
                type="button"
                onClick={() => { setUseEmailMfa(true); setMfaCode(''); clearError(); }}
                style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}
              >
                Verify via Email
              </button>
            </p>
          </div>
        </div>
        <div ref={recaptchaRef} id="recaptcha-container" />
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <Gauge size={48} strokeWidth={1.5} />
          </div>
          <h1>Meter Reading Analytics</h1>
          <p>Sign in to access the dashboard</p>
        </div>

        {error && (
          <div className="login-error">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button onClick={clearError} className="dismiss-error">&times;</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <div className="input-wrapper">
              <Mail size={18} className="input-icon" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
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
                onChange={(e) => setPassword(e.target.value)}
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
            className="login-submit"
            disabled={submitting || !email || !password}
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>Contact your administrator if you need access.</p>
        </div>
      </div>
      <div ref={recaptchaRef} id="recaptcha-container" />
    </div>
  );
};

export default Login;
