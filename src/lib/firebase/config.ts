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

// Server-side validation to ensure environment variables are set during build/deployment
if (typeof window === 'undefined') {
    for (const [key, value] of Object.entries(firebaseConfig)) {
        if (!value) {
            throw new Error(`Firebase configuration error: The environment variable ${key.replace(/([A-Z])/g, '_$1').toUpperCase()} is missing. Please add it to your .env.local file and Vercel project settings.`);
        }
    }
}

// Client-side check for a better user experience in case of misconfiguration
if (typeof window !== 'undefined' && !firebaseConfig.projectId) {
  // This will only run in the browser
  // It uses a timeout to ensure the DOM is ready for an alert.
  setTimeout(() => {
    alert('Firebase configuration is missing. The app will not work correctly. Please check your environment variables.');
  }, 500);
}


// Initialize Firebase App
let app: FirebaseApp;
if (getApps().length === 0) {
    // If the project ID is missing on the client, we initialize with a dummy object
    // to prevent the app from crashing outright. The alert above will inform the user.
    app = initializeApp(firebaseConfig.projectId ? firebaseConfig : {});
} else {
    app = getApp();
}


// Initialize services
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);

export { app, db, storage };
