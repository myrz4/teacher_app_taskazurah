// 🌿 File: chat_inbox_screen.dart
//
// ✅ Teacher Inbox (Firestore Root Collection Version)
// ✅ Displays all chat threads with parents (1 doc per chat room)
// ✅ Automatically updates from Firestore when messages are sent
// ✅ Compatible with Option 1 structure from chat_screen.dart
// ✅ Includes debug prints + safe error handling

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'chat_screen.dart';

class ChatInboxScreen extends StatefulWidget {
  final String teacherUsername;

  const ChatInboxScreen({super.key, required this.teacherUsername});

  @override
  State<ChatInboxScreen> createState() => _ChatInboxScreenState();
}

class _ChatInboxScreenState extends State<ChatInboxScreen> {
  final FirebaseFirestore firestore = FirebaseFirestore.instance;
  Stream<QuerySnapshot>? _chatStream;

  @override
  void initState() {
    super.initState();

    try {
      // 🧠 Load only chats that belong to this teacher (root-level docs)
      _chatStream = firestore
          .collection('chats')
          .where('teacherUsername', isEqualTo: widget.teacherUsername)
          .orderBy('lastTimestamp', descending: true)
          .snapshots();

      debugPrint(
          "✅ Using indexed query for teacher: ${widget.teacherUsername}");
    } catch (e) {
      debugPrint("⚠️ Firestore index missing, fallback to unindexed: $e");
      _chatStream = firestore
          .collection('chats')
          .where('teacherUsername', isEqualTo: widget.teacherUsername)
          .snapshots();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      appBar: AppBar(
        title:
            const Text("Inbox", style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        elevation: 0,
      ),

      // 🔥 Real-time listener
      body: StreamBuilder<QuerySnapshot>(
        stream: _chatStream,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(color: Colors.green),
            );
          }

          if (snapshot.hasError) {
            return Center(
              child: Text(
                "❌ Error loading chats: ${snapshot.error}",
                style: const TextStyle(color: Colors.red, fontSize: 14),
              ),
            );
          }

          final chats = snapshot.data?.docs ?? [];

          debugPrint(
              "📬 Loaded ${chats.length} chat(s) for teacher ${widget.teacherUsername}");
          for (var doc in chats) {
            debugPrint("📄 CHAT DOC ID: ${doc.id}");
            debugPrint("➡️ DATA: ${doc.data()}");
          }

          if (chats.isEmpty) {
            return const Center(
              child: Text(
                "📭 No chats yet.\nStart a conversation with a parent!",
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.black54, fontSize: 16),
              ),
            );
          }

          return ListView.builder(
            itemCount: chats.length,
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemBuilder: (context, index) {
              final chat = chats[index].data() as Map<String, dynamic>;

              final parent = chat['parentUsername'] ?? 'Unknown';
              final lastMsg = chat['lastMessage'] ?? '(No message yet)';
              final lastTime = chat['lastTimestamp'];

              String formattedTime = '';
              if (lastTime != null && lastTime is Timestamp) {
                formattedTime = DateFormat('hh:mm a').format(lastTime.toDate());
              }

              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                elevation: 3,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: Colors.green.shade300,
                    radius: 25,
                    child: const Icon(Icons.person, color: Colors.white),
                  ),
                  title: Text(
                    parent,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.black87,
                      fontSize: 16,
                    ),
                  ),
                  subtitle: Text(
                    lastMsg,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.black54),
                  ),
                  trailing: Text(
                    formattedTime,
                    style: const TextStyle(color: Colors.grey, fontSize: 12),
                  ),
                  onTap: () {
                    debugPrint("🟢 Opening chat with $parent");
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => ChatScreen(
                          teacherUsername: widget.teacherUsername,
                          parentUsername: parent,
                        ),
                      ),
                    );
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}
