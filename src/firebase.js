// src/firebase.js
// price-ur-plastic-faab5 — all services needed by the admin panel
import { initializeApp }   from 'firebase/app';
import { getFirestore }    from 'firebase/firestore';
import { getAuth }         from 'firebase/auth';
import { getStorage }      from 'firebase/storage';   // ← needed by BinsPage

const firebaseConfig = {
  apiKey:            "AIzaSyDfFAzePht8j1YIsnGABUZikm7tTwyvLIU",
  authDomain:        "price-ur-plastic-faab5.firebaseapp.com",
  projectId:         "price-ur-plastic-faab5",
  storageBucket:     "price-ur-plastic-faab5.firebasestorage.app",
  messagingSenderId: "71140175089",
  appId:             "PASTE_YOUR_WEB_APP_ID_HERE", // Firebase Console → Project Settings → Web app
};

const app = initializeApp(firebaseConfig);

export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);   // ← exported so BinsPage can import it
export default app;
