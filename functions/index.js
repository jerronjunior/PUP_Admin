const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Triggered when a notification doc is created in 'notifications' collection.
// Expects the document to contain at least: { userId, title, subtitle }
exports.sendNotificationOnCreate = functions.firestore
  .document('notifications/{notifId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data) return null;
    const userId = data.userId;
    if (!userId) return null;

    try {
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) return null;
      const user = userDoc.data();
      const token = user?.fcmToken || user?.deviceToken || null;
      if (!token) {
        console.log(`No FCM token for user ${userId}`);
        return null;
      }

      const message = {
        token,
        notification: {
          title: data.title || 'Notification',
          body: data.subtitle || '',
        },
        data: {
          notifId: context.params.notifId || '',
          click_action: 'FLUTTER_NOTIFICATION_CLICK'
        }
      };

      const resp = await admin.messaging().send(message);
      console.log('FCM send response:', resp);
      return resp;
    } catch (err) {
      console.error('Error sending FCM:', err);
      return null;
    }
  });
