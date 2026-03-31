// 🌿 File: chat_inbox_screen.dart
//
// ✅ Teacher Inbox (Firestore Root Collection Version)
// ✅ Displays all chat threads with parents (1 doc per chat room)
// ✅ Automatically updates from Firestore when messages are sent
// ✅ Compatible with Option 1 structure from chat_screen.dart
// ✅ Includes debug prints + safe error handling

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'chat_screen.dart';

class ChatInboxScreen extends StatefulWidget {
  final String teacherId;
  final String teacherName;

  const ChatInboxScreen({
    super.key,
    required this.teacherId,
    required this.teacherName,
  });

  @override
  State<ChatInboxScreen> createState() => _ChatInboxScreenState();
}

class _ChatInboxScreenState extends State<ChatInboxScreen> {
  final FirebaseFirestore firestore = FirebaseFirestore.instance;
  static String _safeStr(Object? v) => v == null ? '' : v.toString();

  static String _norm(String s) => s.trim().toLowerCase();

  static String _chatIdFor({required String teacherId, required String parentId}) {
    return 'teacher_${_norm(teacherId)}_parent_${_norm(parentId)}';
  }

  static int _asInt(Object? v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return 0;
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
        stream: firestore.collection('parents').snapshots(),
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

          final parents = snapshot.data?.docs ?? [];
          if (parents.isEmpty) {
            return const Center(
              child: Text(
                "No parents yet.",
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.black54, fontSize: 16),
              ),
            );
          }

          return StreamBuilder<QuerySnapshot>(
            stream: firestore
                .collection('chats')
                .where('teacherId', isEqualTo: widget.teacherId)
                .snapshots(),
            builder: (context, chatsSnap) {
              if (chatsSnap.hasError) {
                return Center(
                  child: Text(
                    "❌ Error loading chats: ${chatsSnap.error}",
                    style: const TextStyle(color: Colors.red, fontSize: 14),
                  ),
                );
              }

              final chatById = <String, Map<String, dynamic>>{};
              for (final d in (chatsSnap.data?.docs ?? const [])) {
                final data = d.data();
                if (data is Map<String, dynamic>) {
                  chatById[d.id] = data;
                }
              }

              final items = parents.map((parentDoc) {
                final parentId = parentDoc.id;
                final data = parentDoc.data() as Map<String, dynamic>;
                final parentName = _safeStr(data['parentName']).trim().isEmpty
                    ? parentId
                    : _safeStr(data['parentName']).trim();

                final chatId = _chatIdFor(teacherId: widget.teacherId, parentId: parentId);
                final chat = chatById[chatId];
                final lastTs = chat?['lastTimestamp'];

                return (
                  parentId: parentId,
                  parentName: parentName,
                  chatId: chatId,
                  lastTimestamp: lastTs is Timestamp ? lastTs : null,
                  lastMessage: (chat?['lastMessage'] ?? '').toString(),
                  unread: _asInt(chat?['unreadCountTeacher']),
                );
              }).toList();

              items.sort((a, b) {
                final at = a.lastTimestamp;
                final bt = b.lastTimestamp;
                if (at == null && bt == null) {
                  return a.parentName.toLowerCase().compareTo(b.parentName.toLowerCase());
                }
                if (at == null) return 1;
                if (bt == null) return -1;
                final cmp = bt.compareTo(at); // desc
                if (cmp != 0) return cmp;
                return a.parentName.toLowerCase().compareTo(b.parentName.toLowerCase());
              });

              return ListView.builder(
                itemCount: items.length,
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemBuilder: (context, index) {
                  final it = items[index];
                  final subtitle = it.lastMessage.trim().isEmpty
                      ? 'Tap to start chatting'
                      : it.lastMessage.trim();

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
                        it.parentName,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Colors.black87,
                          fontSize: 16,
                        ),
                      ),
                      subtitle: Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.black54),
                      ),
                      trailing: it.unread > 0
                          ? Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: const Color(0xFF2E7D32),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                it.unread > 99 ? '99+' : it.unread.toString(),
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                ),
                              ),
                            )
                          : null,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => ChatScreen(
                              teacherId: widget.teacherId,
                              teacherName: widget.teacherName,
                              parentId: it.parentId,
                              parentName: it.parentName,
                            ),
                          ),
                        );
                      },
                    ),
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}
