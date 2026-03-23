import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  signInWithEmailAndPassword,
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
  login: (email: string, password: string) => Promise<void>;
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

  const checkAuthorization = useCallback(async (_currentUser: User) => {
    setIsAuthorized(true);
    return true;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log('[AUTH] onAuthStateChanged:', currentUser ? `uid=${currentUser.uid}` : 'null');
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

    try {
      console.log('[AUTH] signInWithEmailAndPassword starting...');
      const result = await signInWithEmailAndPassword(auth, email, password);
      console.log('[AUTH] signInWithEmailAndPassword SUCCESS, uid:', result.user.uid);
      setIsAuthorized(true);
      setUser(result.user);
      console.log('[AUTH] setIsAuthorized(true) and setUser() called');
    } catch (err: any) {
      console.error('[AUTH] signInWithEmailAndPassword FAILED:', err.code, err.message);
      if (err.code === 'auth/multi-factor-auth-required') {
        setMfaRequired(true);
        setMfaResolver(err.resolver);
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
      login,
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
