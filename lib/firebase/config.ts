
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

// Server-side check for environment variables during build.
if (typeof window === 'undefined') {
  for (const [key, value] of Object.entries(firebaseConfig)) {
    if (!value) {
      // This error will be caught by the Vercel build process
      throw new Error(
        `Firebase config error: The environment variable NEXT_PUBLIC_${key.replace(/([A-Z])/g, '_$1').toUpperCase()} is missing or empty. ` +
        `Please add it to your Vercel project settings.`
      );
    }
  }
}

// Client-side check for a better user-facing error.
if (typeof window !== 'undefined' && !firebaseConfig.projectId) {
  alert(
    'Firebase project ID is not defined in your environment variables. ' +
    'The app will not work correctly. ' +
    'Please ensure all NEXT_PUBLIC_FIREBASE_* variables are set in your Vercel project settings.'
  );
}

// Initialize Firebase App
let app: FirebaseApp;
if (getApps().length === 0) {
  // Only initialize if the config is valid
  if (firebaseConfig.projectId) {
    app = initializeApp(firebaseConfig);
  } else {
    // Create a dummy app to avoid crashing the whole application
    // This allows the error alert to be shown to the user
    app = {} as FirebaseApp;
    console.error("Firebase not initialized due to missing projectId.");
  }
} else {
  app = getApp();
}


// Initialize services, checking if the app is valid before proceeding
const db: Firestore = firebaseConfig.projectId ? getFirestore(app) : {} as Firestore;
const storage: FirebaseStorage = firebaseConfig.projectId ? getStorage(app) : {} as FirebaseStorage;

export { app, db, storage };
