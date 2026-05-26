const functions = require('firebase-functions');
const admin = require('firebase-admin');

const MAX_SAMPLES_PER_LABEL = 200;

const LABELS = [
  'bin', 'binRed', 'binGreen', 'binPurple',
  'clean_sri_lanka', 'carekleen', 'notBottle', 'bottle',
];

exports.cleanupTrainingData = functions.pubsub
  .schedule('0 0 * * *')
  .timeZone('Asia/Colombo')
  .onRun(async () => {
    const db = admin.firestore();
    const storage = admin.storage().bucket();
    let totalDeleted = 0;

    for (const label of LABELS) {
      const snap = await db.collection('training_samples')
        .where('label', '==', label)
        .orderBy('timestamp', 'desc')
        .get();

      if (snap.size <= MAX_SAMPLES_PER_LABEL) {
        console.log(`${label}: ${snap.size} samples — OK`);
        continue;
      }

      const toDelete = snap.docs.slice(MAX_SAMPLES_PER_LABEL);
      console.log(`${label}: deleting ${toDelete.length} old samples`);

      for (const doc of toDelete) {
        const data = doc.data();

        if (data.storagePath) {
          try {
            await storage.file(data.storagePath).delete();
          } catch (e) {
            console.warn(`Storage delete failed for ${data.storagePath}: ${e.message}`);
          }
        }

        await doc.ref.delete();
        totalDeleted++;
      }
    }

    console.log(`Cleanup done. Deleted ${totalDeleted} samples.`);
    return null;
  });