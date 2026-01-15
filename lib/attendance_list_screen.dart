// 📋 File: attendance_list_screen.dart
//
// ✅ Firestore SDK version (uses FirebaseFirestore directly)
// ✅ Fetches children collection from Firestore
// ✅ Same UI and navigation to StudentAttendanceDetailScreen
// ✅ Compatible with cloud_firestore ^5.x

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'student_attendance_detail_screen.dart';

class AttendanceListScreen extends StatefulWidget {
  const AttendanceListScreen({Key? key}) : super(key: key);

  @override
  State<AttendanceListScreen> createState() => _AttendanceListScreenState();
}

class _AttendanceListScreenState extends State<AttendanceListScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _children = [];
  String? _errorMsg;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  @override
  void initState() {
    super.initState();
    _loadChildren();
  }

  /// 🔹 Load children collection from Firestore SDK
  Future<void> _loadChildren() async {
    try {
      setState(() {
        _isLoading = true;
        _errorMsg = null;
      });

      final snapshot = await _firestore.collection('children').get();

      final childrenList = snapshot.docs.map((doc) {
        final data = doc.data();
        return {
          'id': doc.id,
          'name': data['name'] ?? '-',
          'nfc_uid': data['nfc_uid'] ?? '-',
          'parentName': data['parentName'] ?? '-',
          'teacher_username': data['teacher_username'] ?? '-',
          'photoUrl': data['photoUrl'] ?? '',
        };
      }).toList();

      setState(() {
        _children = childrenList;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _errorMsg = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text(
          "Attendance Records",
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        centerTitle: true,
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: Colors.green),
            )
          : _errorMsg != null
              ? Center(
                  child: Text(
                    "Error loading data:\n$_errorMsg",
                    style: const TextStyle(
                      color: Colors.redAccent,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                    textAlign: TextAlign.center,
                  ),
                )
              : _children.isEmpty
                  ? const Center(
                      child: Text(
                        "No children found in Taska Zuhrah database.",
                        style: TextStyle(fontSize: 16, color: Colors.black54),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadChildren,
                      color: Colors.green,
                      child: ListView.builder(
                        physics: const AlwaysScrollableScrollPhysics(),
                        itemCount: _children.length,
                        itemBuilder: (context, index) {
                          final child = _children[index];
                          final childName = child['name'] ?? '-';
                          final childId = child['nfc_uid'] ?? '-';
                          final parentName = child['parentName'] ?? '-';
                          final teacherUsername =
                              child['teacher_username'] ?? '-';
                          final photoUrl = child['photoUrl'] ?? '';

                          return Card(
                            margin: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            elevation: 3,
                            child: ListTile(
                              leading: CircleAvatar(
                                radius: 26,
                                backgroundColor: const Color(0xFFE8F5E9),
                                backgroundImage: (photoUrl.isNotEmpty)
                                    ? NetworkImage(photoUrl)
                                    : null,
                                child: (photoUrl.isEmpty)
                                    ? const Icon(
                                        Icons.child_care,
                                        color: Color(0xFF2E7D32),
                                      )
                                    : null,
                              ),
                              title: Text(
                                childName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 18,
                                ),
                              ),
                              subtitle: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text("Parent: $parentName"),
                                  Text("Teacher: $teacherUsername"),
                                ],
                              ),
                              trailing:
                                  const Icon(Icons.arrow_forward_ios, size: 18),
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (context) =>
                                        StudentAttendanceDetailScreen(
                                      childId: childId,
                                      childName: childName,
                                    ),
                                  ),
                                );
                              },
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
