import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { 
  getFirestore, 
  doc, 
  getDocFromServer, 
  enableIndexedDbPersistence,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfigImport from '../firebase-applet-config.json';
export const firebaseConfig = firebaseConfigImport;

// Initialize Firebase SDK
const app = initializeApp(firebaseConfigImport);

// Which named Firestore database to connect to. A Vercel env var
// (FIREBASE_DATABASE_ID, inlined at build time via vite.config.ts) takes
// precedence so the ERP can be pointed at a different database per environment
// for testing; otherwise it falls back to the committed applet config.
const databaseId = process.env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId;

// Use initializeFirestore to configure experimentalForceLongPolling for better cross-network compatibility
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalForceLongPolling: true, // This helps in environments where WebSockets/gRPC might be blocked
}, databaseId);

export const storage = getStorage(app);

export const auth = getAuth();

// Error Handling Spec for Firestore Operations
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: null,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: null,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: null,
        email: null,
        photoUrl: null,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error:', operationType, path, error instanceof Error ? error.message : String(error));
  throw new Error(JSON.stringify(errInfo));
}

// Validate Connection to Firestore with a slight delay to allow setup
async function testConnection() {
  if (typeof window === 'undefined') return;
  
  // Wait 2 seconds before checking to allow the SDK to initialize
  setTimeout(async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      console.log("Firestore connection test successful.");
    } catch (error) {
      if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('Backend didn\'t respond'))) {
        console.warn("Firestore is operating in offline mode. This is normal if you have a slow connection.");
      }
    }
  }, 2000);
}

testConnection();
