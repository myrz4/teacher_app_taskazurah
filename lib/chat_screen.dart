// 🌿 File: chat_screen.dart
//
// ✅ Taska Zurah Chat Screen (Teacher ↔ Parent)
// ✅ Uses Firestore SDK (Realtime Updates)
// ✅ Supports text messages (teacher sends messages)
// ✅ Auto-updates Inbox (lastMessage + timestamp)
// ✅ Sends Push Notification to Parent (FCM Token)
// ✅ Smooth scrolling + bubble colors for sender/receiver

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

class ChatScreen extends StatefulWidget {
  static const routeName = 'ChatScreen';
  final String teacherUsername;
  final String parentUsername;

  const ChatScreen({
    super.key,
    required this.teacherUsername,
    required this.parentUsername,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _msgController = TextEditingController();
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final ScrollController _scrollController = ScrollController();

  // 🔹 Unique chat room ID between teacher and parent
  String get chatRoomId =>
      "teacher_${widget.teacherUsername}_parent_${widget.parentUsername}";

  // 🔹 Send message to Firestore + Push notification
  Future<void> _sendMessage() async {
    final text = _msgController.text.trim();
    if (text.isEmpty) return;

    final chatDoc = _firestore.collection('chats').doc(chatRoomId);

    try {
      // 🟢 Add message to subcollection
      await chatDoc.collection('messages').add({
        'sender': widget.teacherUsername, // ✅ teacher sending
        'text': text,
        'timestamp': FieldValue.serverTimestamp(),
      });

      // 🟢 Update metadata for Inbox
      await chatDoc.set({
        'teacherUsername': widget.teacherUsername,
        'parentUsername': widget.parentUsername,
        'lastMessage': text,
        'lastTimestamp': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      // 🟢 Send push notification to parent
      await _sendPushNotificationToParent(widget.parentUsername, text);

      _msgController.clear();

      // 🟢 Auto-scroll to bottom
      Future.delayed(const Duration(milliseconds: 300), () {
        if (_scrollController.hasClients) {
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
        }
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Failed to send message: $e")),
      );
    }
  }

  /// 🔔 Send push notification to parent via FCM
  Future<void> _sendPushNotificationToParent(
      String parentUsername, String message) async {
    try {
      // Get parent’s FCM token from Firestore
      final query = await _firestore
          .collection('parents')
          .where('username', isEqualTo: parentUsername)
          .limit(1)
          .get();

      if (query.docs.isEmpty) {
        print("⚠️ Parent not found for $parentUsername");
        return;
      }

      final parentData = query.docs.first.data();
      final fcmToken = parentData['fcmToken'];

      if (fcmToken == null || fcmToken.isEmpty) {
        print("⚠️ No FCM token for $parentUsername");
        return;
      }

      // Send push via FCM HTTP API
      const String fcmUrl = 'https://fcm.googleapis.com/fcm/send';

      // ⚠️ Replace with your actual Firebase Cloud Messaging Server Key
      const String serverKey = 'YOUR_SERVER_KEY_HERE';

      final payload = {
        'to': fcmToken,
        'notification': {
          'title': '📩 New Message from ${widget.teacherUsername}',
          'body': message,
        },
        'data': {
          'click_action': 'FLUTTER_NOTIFICATION_CLICK',
          'screen': 'ChatScreen',
          'sender': widget.teacherUsername,
        },
      };

      final response = await http.post(
        Uri.parse(fcmUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'key=$serverKey',
        },
        body: jsonEncode(payload),
      );

      if (response.statusCode == 200) {
        print("✅ Push notification sent to parent $parentUsername");
      } else {
        print("❌ Failed to send notification: ${response.body}");
      }
    } catch (e) {
      print("🔥 Error sending push notification: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F6),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        title: Row(
          children: [
            const Icon(Icons.chat_bubble_outline, size: 20),
            const SizedBox(width: 6),
            Text(
              "Chat with ${widget.parentUsername}", // ✅ fixed title
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),

      // 💬 Chat Body
      body: Column(
        children: [
          // 🔹 Realtime Messages
          Expanded(
            child: StreamBuilder<QuerySnapshot>(
              stream: _firestore
                  .collection('chats')
                  .doc(chatRoomId)
                  .collection('messages')
                  .orderBy('timestamp', descending: false)
                  .snapshots(),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(
                    child: Text(
                      "⚠️ Error loading messages: ${snapshot.error}",
                      style: const TextStyle(color: Colors.red),
                    ),
                  );
                }

                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(
                    child: CircularProgressIndicator(color: Colors.green),
                  );
                }

                final messages = snapshot.data?.docs ?? [];

                if (messages.isEmpty) {
                  return const Center(
                    child: Text(
                      "No messages yet.\nStart the conversation!",
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.grey, fontSize: 16),
                    ),
                  );
                }

                return ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(12),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final msg = messages[index].data()! as Map<String, dynamic>;
                    final isMe = msg['sender'] == widget.teacherUsername;
                    final text = msg['text'] ?? '';
                    final timestamp = msg['timestamp'];

                    String time = '';
                    if (timestamp != null) {
                      try {
                        time = DateFormat('hh:mm a').format(timestamp.toDate());
                      } catch (_) {}
                    }

                    return Align(
                      alignment:
                          isMe ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.symmetric(
                            vertical: 6, horizontal: 8),
                        padding: const EdgeInsets.all(12),
                        constraints:
                            const BoxConstraints(maxWidth: 280, minWidth: 80),
                        decoration: BoxDecoration(
                          color: isMe
                              ? const Color(
                                  0xFFA5D6A7) // ✅ teacher bubble green
                              : Colors.white, // parent bubble
                          borderRadius: BorderRadius.only(
                            topLeft: const Radius.circular(14),
                            topRight: const Radius.circular(14),
                            bottomLeft:
                                Radius.circular(isMe ? 14 : 0), // bubble shape
                            bottomRight:
                                Radius.circular(isMe ? 0 : 14), // bubble shape
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.grey.withOpacity(0.2),
                              blurRadius: 4,
                              offset: const Offset(1, 2),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              text,
                              style: const TextStyle(fontSize: 16),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              time,
                              style: TextStyle(
                                fontSize: 11,
                                color: Colors.grey.shade600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),

          // 🔹 Message Input
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: const BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black12,
                  blurRadius: 5,
                  offset: Offset(0, -1),
                ),
              ],
            ),
            child: SafeArea(
              child: Row(
                children: [
                  // Text box
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 15),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(25),
                      ),
                      child: TextField(
                        controller: _msgController,
                        decoration: const InputDecoration(
                          hintText: "Type a message...",
                          border: InputBorder.none,
                        ),
                        onSubmitted: (_) => _sendMessage(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Send button
                  CircleAvatar(
                    backgroundColor: const Color(0xFF2E7D32),
                    child: IconButton(
                      icon: const Icon(Icons.send, color: Colors.white),
                      onPressed: _sendMessage,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
