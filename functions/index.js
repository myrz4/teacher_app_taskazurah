/**
 * 🌿 Taska Zurah – Firebase Cloud Function for Chat Notifications
 *
 * ✅ Triggered when a new message is created in Firestore:
 *    Path: /chats/{chatId}/messages/{messageId}
 *
 * ✅ Detects sender (teacher / parent)
 * ✅ Finds receiver’s FCM token (stored in teachers / parents collections)
 * ✅ Sends a push notification via FCM
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// 🔧 Initialize Firebase Admin SDK
admin.initializeApp();

// 🔔 Firestore trigger — runs every time a new message is added
exports.sendChatNotification = onDocumentCreated(
  "chats/{chatId}/messages/{messageId}",
  async (event) => {
    try {
      const messageData = event.data.data();
      const chatId = event.params.chatId;

      if (!messageData) {
        logger.warn("⚠️ No message data found.");
        return null;
      }

      const sender = messageData.sender || "Unknown";
      const text = messageData.text || "(No text message)";
      logger.info(`🆕 New message in ${chatId} from ${sender}: ${text}`);

      // 🟢 Fetch parent chat metadata
      const chatRef = admin.firestore().collection("chats").doc(chatId);
      const chatSnap = await chatRef.get();

      if (!chatSnap.exists) {
        logger.error("❌ Chat document not found:", chatId);
        return null;
      }

      const chat = chatSnap.data();
      const teacherUsername = chat.teacherUsername;
      const parentUsername = chat.parentUsername;

      if (!teacherUsername || !parentUsername) {
        logger.warn("⚠️ Chat metadata missing teacher/parent usernames");
        return null;
      }

      // 🧭 Determine who receives the notification
      let targetCollection = "";
      let targetUsername = "";

      if (sender === teacherUsername) {
        // Teacher sent message → notify parent
        targetCollection = "parents";
        targetUsername = parentUsername;
      } else if (sender === parentUsername) {
        // Parent sent message → notify teacher
        targetCollection = "teachers";
        targetUsername = teacherUsername;
      } else {
        logger.warn("⚠️ Sender does not match chat participants, skipping");
        return null;
      }

      logger.info(`🎯 Receiver: ${targetCollection}/${targetUsername}`);

      // 🧩 Fetch receiver’s FCM token
      const receiverQuery = await admin
        .firestore()
        .collection(targetCollection)
        .where("username", "==", targetUsername)
        .limit(1)
        .get();

      if (receiverQuery.empty) {
        logger.warn(`⚠️ Receiver ${targetUsername} not found in ${targetCollection}`);
        return null;
      }

      const receiverData = receiverQuery.docs[0].data();
      const fcmToken = receiverData.fcmToken;

      if (!fcmToken) {
        logger.warn(`⚠️ No FCM token for ${targetCollection}/${targetUsername}`);
        return null;
      }

      // 📤 Build notification payload
      const payload = {
        notification: {
          title: `💬 New message from ${sender}`,
          body: text,
        },
        data: {
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          chatId: chatId,
        },
        token: fcmToken,
      };

      // 🚀 Send notification via FCM
      await admin.messaging().send(payload);
      logger.info(`✅ Notification sent to ${targetUsername}`);

      return null;
    } catch (error) {
      logger.error("🔥 Error sending notification:", error);
      return null;
    }
  }
);
