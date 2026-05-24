import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithCustomToken,
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
import type { AnicaLoginSessionUser } from '../services/anicaLoginAuth';
import {
  canSwitchPortalRolesFromProfile,
  clearAnicaLoginSession,
  getAnicaUserId,
  loadValidatedAnicaLoginSession,
  persistAnicaLoginSession,
  assertAnicaUserCanSignIn,
} from '../services/anicaLoginAuth';
import {
  getStoredPortalWorkMode,
  portalWorkModeFromAnicaRole,
  setStoredPortalWorkMode,
  type PortalWorkMode,
} from '../utils/portalWorkMode';

interface AuthContextType {
  user: User | null;
  /** Session from password auth (user ID / password + device verification). */
  anicaLoginUser: AnicaLoginSessionUser | null;
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
  completeAnicaLoginSession: (profile: AnicaLoginSessionUser) => void;
  logout: () => Promise<void>;
  clearError: () => void;
  isAuthorized: boolean;
  /** Portal navigation role from login profile (falls back to stored mode). */
  portalWorkMode: PortalWorkMode;
  /** Dev bypass users may switch between all portal roles in the sidebar. */
  canSwitchPortalRoles: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function anicaLoginDisplayEmail(profile: AnicaLoginSessionUser | null): string | null {
  if (!profile) return null;
  const e = profile.EMailID ?? profile.email ?? profile.Email;
  if (typeof e === 'string' && e.trim()) return e;
  const uid = profile.UserID ?? profile.userId;
  if (typeof uid === 'string' && uid.trim()) return uid;
  return null;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initialAnicaLogin = loadValidatedAnicaLoginSession();
  const [user, setUser] = useState<User | null>(null);
  const [anicaLoginUser, setAnicaLoginUser] = useState<AnicaLoginSessionUser | null>(initialAnicaLogin);
  const [loading, setLoading] = useState(!initialAnicaLogin);
  const [error, setError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(!!initialAnicaLogin);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaPhoneHint, setMfaPhoneHint] = useState<string | null>(null);
  const [mfaVerificationId, setMfaVerificationId] = useState<string | null>(null);
  const [mfaEmail, setMfaEmail] = useState<string | null>(null);
  const anicaLoginUserRef = useRef<AnicaLoginSessionUser | null>(anicaLoginUser);
  anicaLoginUserRef.current = anicaLoginUser;

  const portalWorkMode = useMemo((): PortalWorkMode => {
    if (anicaLoginUser && canSwitchPortalRolesFromProfile(anicaLoginUser)) {
      return getStoredPortalWorkMode();
    }
    if (anicaLoginUser) {
      const fromProfile = portalWorkModeFromAnicaRole(anicaLoginUser);
      if (fromProfile) return fromProfile;
    }
    return getStoredPortalWorkMode();
  }, [anicaLoginUser]);

  const canSwitchPortalRoles = useMemo(
    () => !!anicaLoginUser && canSwitchPortalRolesFromProfile(anicaLoginUser),
    [anicaLoginUser],
  );

  useEffect(() => {
    if (!anicaLoginUser || canSwitchPortalRolesFromProfile(anicaLoginUser)) return;
    const fromProfile = portalWorkModeFromAnicaRole(anicaLoginUser);
    if (fromProfile) setStoredPortalWorkMode(fromProfile);
  }, [anicaLoginUser]);

  const checkAuthorization = useCallback(async (_currentUser: User) => {
    setIsAuthorized(true);
    return true;
  }, []);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    if (anicaLoginUserRef.current) {
      setLoading(false);
    }
    const authReadyTimer = window.setTimeout(() => setLoading(false), 4000);
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await checkAuthorization(currentUser);
        setUser(currentUser);
      } else {
        setUser(null);
        if (!anicaLoginUserRef.current) {
          setIsAuthorized(false);
        }
      }
      setLoading(false);
    });

    return () => {
      window.clearTimeout(authReadyTimer);
      unsubscribe();
    };
  }, [checkAuthorization]);

  const login = useCallback(async (email: string, password: string) => {
    if (!auth) {
      setError('Firebase sign-in is not configured. Use user ID sign-in on the login page.');
      throw new Error('Firebase not configured');
    }
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
    if (!auth) throw new Error('Firebase is not configured');
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
    if (!auth) throw new Error('Firebase is not configured');
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
    if (!auth) return false;
    if (!isSignInWithEmailLink(auth, window.location.href)) return false;

    const email = window.localStorage.getItem('emailForSignIn');
    if (!email) {
      setError('Could not determine email. Please try again.');
      return false;
    }

    const url = new URL(window.location.href);
    const oobCode = url.searchParams.get('oobCode');
    if (!oobCode) {
      setError('Invalid email link.');
      return false;
    }

    try {
      const res = await fetch('/api/auth/verify-email-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, oobCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Email link verification failed');
        return false;
      }

      const result = await signInWithCustomToken(auth, data.customToken);
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

  const completeAnicaLoginSession = useCallback((profile: AnicaLoginSessionUser) => {
    assertAnicaUserCanSignIn(profile, getAnicaUserId(profile));
    const mode = portalWorkModeFromAnicaRole(profile);
    if (mode) setStoredPortalWorkMode(mode);
    persistAnicaLoginSession(profile);
    setAnicaLoginUser(profile);
    setIsAuthorized(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      try {
        sessionStorage.removeItem('meter_portal_welcome_dismissed_session');
      } catch {
        /* ignore */
      }
      clearAnicaLoginSession();
      setAnicaLoginUser(null);
      if (auth) {
        await signOut(auth);
      }
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
      anicaLoginUser,
      userEmail: user?.email || anicaLoginDisplayEmail(anicaLoginUser),
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
      completeAnicaLoginSession,
      logout,
      clearError,
      isAuthorized,
      portalWorkMode,
      canSwitchPortalRoles,
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
