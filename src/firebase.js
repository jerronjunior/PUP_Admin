// src/firebase.js
// Loads Firebase config from environment variables with fallbacks.
// For web apps, register a Web app in Firebase Console and use that config.
// If you only have android/google-services.json values, those are used as fallbacks.
import { initializeApp } from 'firebase/app';
import { getFirestore }  from 'firebase/firestore';
import { getAuth }       from 'firebase/auth';
import { getStorage }    from 'firebase/storage';

const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY || 'AIzaSyDfFAzePht8j1YIsnGABUZikm7tTwyvLIU',
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || `${process.env.REACT_APP_FIREBASE_PROJECT_ID || 'price-ur-plastic-faab5'}.firebaseapp.com`,
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID || 'price-ur-plastic-faab5',
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'price-ur-plastic-faab5.firebasestorage.app',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '71140175089',
  appId:             process.env.REACT_APP_FIREBASE_APP_ID || '1:71140175089:android:6bb69b793b333018818d50',
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export default app;
