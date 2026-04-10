// ==================== FIREBASE ADMIN CONFIG ====================
const admin = require('firebase-admin');

let firebaseApp;

function initFirebase() {
  if (firebaseApp) return firebaseApp;

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  const serviceAccount = privateKey
    ? {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }
    : undefined;

  // If no service account provided, use Application Default Credentials
  if (serviceAccount) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
    });
  } else {
    // Development: use emulator or ADC
    firebaseApp = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'my-whatsapp-2c1af',
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://my-whatsapp-2c1af-default-rtdb.firebaseio.com',
    });
  }

  console.log('✅ Firebase Admin initialized');
  return firebaseApp;
}

const db = () => admin.firestore();
const auth = () => admin.auth();
const storage = () => admin.storage();
const rtdb = () => admin.database();

module.exports = { initFirebase, db, auth, storage, rtdb, admin };
