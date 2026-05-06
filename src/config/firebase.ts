import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** True when env has a real-looking web API key (auth-only deploys can omit Firebase). */
function isFirebaseConfigured(): boolean {
  const k = firebaseConfig.apiKey;
  if (typeof k !== 'string' || !k.trim()) return false;
  if (k.length < 10) return false;
  if (/your_|placeholder|xxxxx/i.test(k)) return false;
  return true;
}

export const isFirebaseAuthConfigured = isFirebaseConfigured();

const app: FirebaseApp | null = isFirebaseAuthConfigured ? initializeApp(firebaseConfig) : null;

export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;
export default app;
