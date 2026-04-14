import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut,
  onAuthStateChanged,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  type User,
  type MultiFactorResolver,
} from 'firebase/auth';
import { auth } from '../config/firebase';

interface AuthContextType {
  user: User | null;
  userEmail: string | null;
  loading: boolean;
  error: string | null;
  mfaRequired: boolean;
  mfaResolver: MultiFactorResolver | null;
  mfaPhoneHint: string | null;
  mfaEmail: string | null;
  login: (email: string, password: string) => Promise<void>;
  sendMfaCode: (recaptchaContainer: HTMLElement) => Promise<void>;
  verifyMfaCode: (code: string) => Promise<void>;
  sendEmailLink: () => Promise<void>;
  completeEmailLinkSignIn: () => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  isAuthorized: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaPhoneHint, setMfaPhoneHint] = useState<string | null>(null);
  const [mfaVerificationId, setMfaVerificationId] = useState<string | null>(null);
  const [mfaEmail, setMfaEmail] = useState<string | null>(null);

  const checkAuthorization = useCallback(async (_currentUser: User) => {
    setIsAuthorized(true);
    return true;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await checkAuthorization(currentUser);
        setUser(currentUser);
      } else {
        setUser(null);
        setIsAuthorized(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [checkAuthorization]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setMfaRequired(false);
    setMfaResolver(null);
    setMfaEmail(email);

    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      setIsAuthorized(true);
      setUser(result.user);
    } catch (err: any) {
      if (err.code === 'auth/multi-factor-auth-required') {
        const resolver: MultiFactorResolver = err.resolver;
        setMfaRequired(true);
        setMfaResolver(resolver);
        const phoneHint = resolver.hints.find(h => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID);
        setMfaPhoneHint(phoneHint ? (phoneHint as any).phoneNumber : 'phone on file');
        return;
      }

      const messages: Record<string, string> = {
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
        'auth/invalid-email': 'Please enter a valid email address.',
      };

      setError(messages[err.code] || 'Failed to sign in. Please check your credentials.');
      throw err;
    }
  }, [checkAuthorization]);

  const mfaRecaptchaRef = useRef<RecaptchaVerifier | null>(null);

  const sendMfaCode = useCallback(async (recaptchaContainer: HTMLElement) => {
    if (!mfaResolver) throw new Error('No MFA resolver');
    setError(null);

    const phoneHint = mfaResolver.hints.find(
      h => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
    if (!phoneHint) throw new Error('No phone factor enrolled');

    if (mfaRecaptchaRef.current) {
      mfaRecaptchaRef.current.clear();
      mfaRecaptchaRef.current = null;
    }

    const recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainer, { size: 'invisible' });
    mfaRecaptchaRef.current = recaptchaVerifier;

    const phoneProvider = new PhoneAuthProvider(auth);
    const verificationId = await phoneProvider.verifyPhoneNumber(
      { multiFactorHint: phoneHint, session: mfaResolver.session },
      recaptchaVerifier
    );
    setMfaVerificationId(verificationId);
  }, [mfaResolver]);

  const verifyMfaCode = useCallback(async (code: string) => {
    if (!mfaResolver || !mfaVerificationId) throw new Error('No MFA session');
    setError(null);

    try {
      const credential = PhoneAuthProvider.credential(mfaVerificationId, code);
      const multiFactorAssertion = PhoneMultiFactorGenerator.assertion(credential);
      const result = await mfaResolver.resolveSignIn(multiFactorAssertion);
      setIsAuthorized(true);
      setUser(result.user);
      setMfaRequired(false);
      setMfaResolver(null);
      setMfaVerificationId(null);
    } catch (err: any) {
      setError(err.code === 'auth/invalid-verification-code'
        ? 'Invalid verification code. Please try again.'
        : 'MFA verification failed. Please try again.');
      throw err;
    }
  }, [mfaResolver, mfaVerificationId]);

  const sendEmailLink = useCallback(async () => {
    if (!mfaEmail) throw new Error('No email available');
    setError(null);

    const actionCodeSettings = {
      url: window.location.origin + '/login?emailLink=1',
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, mfaEmail, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', mfaEmail);
    } catch (err: any) {
      setError(err.message || 'Failed to send sign-in link');
      throw err;
    }
  }, [mfaEmail]);

  const completeEmailLinkSignIn = useCallback(async () => {
    if (!isSignInWithEmailLink(auth, window.location.href)) return false;

    const email = window.localStorage.getItem('emailForSignIn');
    if (!email) {
      setError('Could not determine email. Please try again.');
      return false;
    }

    try {
      const result = await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
      setIsAuthorized(true);
      setUser(result.user);
      setMfaRequired(false);
      setMfaResolver(null);
      setMfaVerificationId(null);
      setMfaEmail(null);
      return true;
    } catch (err: any) {
      setError(err.message || 'Email link sign-in failed');
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
      setIsAuthorized(false);
      setMfaRequired(false);
      setMfaResolver(null);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      userEmail: user?.email || null,
      loading,
      error,
      mfaRequired,
      mfaResolver,
      mfaPhoneHint,
      mfaEmail,
      login,
      sendMfaCode,
      verifyMfaCode,
      sendEmailLink,
      completeEmailLinkSignIn,
      logout,
      clearError,
      isAuthorized,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export { RecaptchaVerifier, PhoneAuthProvider, PhoneMultiFactorGenerator, multiFactor };
