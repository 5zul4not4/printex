// src/lib/firebase/config.ts
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// This check provides a clear error message during development if the config is missing.
if (typeof window !== 'undefined' && !firebaseConfig.projectId) {
  console.error('Firebase project ID is not defined in your environment variables. Check your .env.local file.');
}

// Initialize Firebase App
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize services
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);

export { app, db, storage };
