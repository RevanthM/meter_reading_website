import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAuth,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
} from '../context/AuthContext';
import { auth } from '../config/firebase';
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  ShieldOff,
  Phone,
  Loader2,
  AlertCircle,
  CheckCircle,
  Trash2,
  Gauge,
} from 'lucide-react';

const MFASettings: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const recaptchaRef = useRef<HTMLDivElement>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  const enrolledFactors = user ? multiFactor(user).enrolledFactors : [];
  const isMFAEnabled = enrolledFactors.length > 0;

  const initRecaptcha = useCallback(() => {
    if (recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current.clear();
    }
    recaptchaVerifierRef.current = new RecaptchaVerifier(auth, recaptchaRef.current!, {
      size: 'invisible',
    });
  }, []);

  const handleStartEnrollment = async () => {
    if (!user || !phoneNumber) return;
    setError(null);
    setSuccess(null);
    setEnrolling(true);

    try {
      initRecaptcha();
      const session = await multiFactor(user).getSession();
      const phoneInfoOptions = {
        phoneNumber,
        session,
      };
      const phoneProvider = new PhoneAuthProvider(auth);
      const id = await phoneProvider.verifyPhoneNumber(phoneInfoOptions, recaptchaVerifierRef.current!);
      setVerificationId(id);
      setSuccess('Verification code sent to your phone.');
    } catch (err: any) {
      console.error('MFA enrollment error:', err);
      if (err.code === 'auth/requires-recent-login') {
        setError('Please sign out and sign back in before enabling MFA.');
      } else {
        setError(err.message || 'Failed to start MFA enrollment.');
      }
    } finally {
      setEnrolling(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!user || !verificationId || !verificationCode) return;
    setError(null);
    setSuccess(null);
    setVerifying(true);

    try {
      const credential = PhoneAuthProvider.credential(verificationId, verificationCode);
      const assertion = PhoneMultiFactorGenerator.assertion(credential);
      await multiFactor(user).enroll(assertion, 'Phone Number');
      setSuccess('MFA has been enabled successfully!');
      setVerificationId(null);
      setVerificationCode('');
      setPhoneNumber('');
    } catch (err: any) {
      console.error('MFA verification error:', err);
      setError(err.message || 'Invalid verification code.');
    } finally {
      setVerifying(false);
    }
  };

  const handleUnenroll = async (index: number) => {
    if (!user) return;
    setError(null);
    setSuccess(null);

    try {
      const factor = multiFactor(user).enrolledFactors[index];
      await multiFactor(user).unenroll(factor);
      setSuccess('MFA factor removed successfully.');
    } catch (err: any) {
      console.error('MFA unenroll error:', err);
      if (err.code === 'auth/requires-recent-login') {
        setError('Please sign out and sign back in before removing MFA.');
      } else {
        setError(err.message || 'Failed to remove MFA factor.');
      }
    }
  };

  return (
    <div className="mfa-page">
      <header className="page-header">
        <div className="header-content">
          <button className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="page-title">
            <Gauge size={28} strokeWidth={1.5} />
            <div>
              <h1>MFA Settings</h1>
              <p>Manage multi-factor authentication</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mfa-content">
        <div className="mfa-status-card">
          <div className="mfa-status-icon">
            {isMFAEnabled ? (
              <ShieldCheck size={48} color="#10b981" />
            ) : (
              <ShieldOff size={48} color="#ef4444" />
            )}
          </div>
          <div className="mfa-status-info">
            <h2>{isMFAEnabled ? 'MFA is Enabled' : 'MFA is Disabled'}</h2>
            <p>
              {isMFAEnabled
                ? `You have ${enrolledFactors.length} factor${enrolledFactors.length > 1 ? 's' : ''} enrolled.`
                : 'Add a phone number to enable multi-factor authentication.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mfa-alert error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mfa-alert success">
            <CheckCircle size={16} />
            <span>{success}</span>
          </div>
        )}

        {enrolledFactors.length > 0 && (
          <div className="mfa-section">
            <h3><Shield size={18} /> Enrolled Factors</h3>
            <div className="enrolled-factors">
              {enrolledFactors.map((factor, index) => (
                <div key={factor.uid} className="factor-item">
                  <div className="factor-info">
                    <Phone size={18} />
                    <div>
                      <span className="factor-name">{factor.displayName || 'Phone Number'}</span>
                      <span className="factor-enrolled">Enrolled {factor.enrollmentTime ? new Date(factor.enrollmentTime).toLocaleDateString() : 'N/A'}</span>
                    </div>
                  </div>
                  <button className="factor-remove" onClick={() => handleUnenroll(index)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!verificationId ? (
          <div className="mfa-section">
            <h3><Phone size={18} /> Add Phone Number</h3>
            <div className="mfa-enroll-form">
              <div className="form-group">
                <label htmlFor="phone">Phone Number</label>
                <div className="input-wrapper">
                  <Phone size={18} className="input-icon" />
                  <input
                    id="phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                  />
                </div>
              </div>
              <button
                className="mfa-submit"
                onClick={handleStartEnrollment}
                disabled={enrolling || !phoneNumber}
              >
                {enrolling ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Sending code...
                  </>
                ) : (
                  'Send Verification Code'
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="mfa-section">
            <h3><Shield size={18} /> Enter Verification Code</h3>
            <div className="mfa-enroll-form">
              <div className="form-group">
                <label htmlFor="code">Verification Code</label>
                <div className="input-wrapper">
                  <Shield size={18} className="input-icon" />
                  <input
                    id="code"
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              </div>
              <div className="mfa-form-actions">
                <button
                  className="mfa-submit"
                  onClick={handleVerifyCode}
                  disabled={verifying || verificationCode.length < 6}
                >
                  {verifying ? (
                    <>
                      <Loader2 size={18} className="spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify & Enable MFA'
                  )}
                </button>
                <button
                  className="mfa-cancel"
                  onClick={() => {
                    setVerificationId(null);
                    setVerificationCode('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={recaptchaRef} id="recaptcha-container" />
      </div>
    </div>
  );
};

export default MFASettings;
