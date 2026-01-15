// 🧑‍🏫 File: profile_screen.dart
//
// ✅ Firestore SDK version (uses FirebaseFirestore directly)
// ✅ Automatically links tips_total with sum(bonus) from 'salary' collection
// ✅ Fixes Timestamp display issue for join_date
// ✅ Displays profile photo, name, email, phone, class, experience, join date, salary & tips

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

class ProfileScreen extends StatefulWidget {
  final String teacherUsername;

  const ProfileScreen({super.key, required this.teacherUsername});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? teacherData;
  bool _isLoading = true;
  double totalBonus = 0.0;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  @override
  void initState() {
    super.initState();
    _loadTeacherProfile();
  }

  /// ✅ Fetch teacher profile and calculate total bonus (tips)
  Future<void> _loadTeacherProfile() async {
    try {
      // Step 1: Load teacher info
      final teacherQuery = await _firestore
          .collection('teachers')
          .where('username', isEqualTo: widget.teacherUsername)
          .limit(1)
          .get();

      if (teacherQuery.docs.isEmpty) {
        Fluttertoast.showToast(msg: "Profile not found.");
        setState(() => _isLoading = false);
        return;
      }

      teacherData = teacherQuery.docs.first.data();
      final teacherDocId = teacherQuery.docs.first.id;

      // Step 2: Load salary records for this teacher
      final salaryQuery = await _firestore
          .collection('salary')
          .where('teacher_username', isEqualTo: widget.teacherUsername)
          .get();

      // Step 3: Sum up all bonus values
      double sumBonus = 0.0;
      for (var doc in salaryQuery.docs) {
        final data = doc.data();
        sumBonus += _safeToDouble(data['bonus']);
      }

      // Step 4: Update tips_total field in Firestore
      await _firestore
          .collection('teachers')
          .doc(teacherDocId)
          .update({'tips_total': sumBonus});

      // Step 5: Update UI
      setState(() {
        totalBonus = sumBonus;
        _isLoading = false;
      });
    } catch (e, st) {
      debugPrint("🔥 Error loading profile: $e\n$st");
      Fluttertoast.showToast(msg: "Error loading profile: $e");
      setState(() => _isLoading = false);
    }
  }

  /// Helper: safely convert dynamic to double
  double _safeToDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  /// 🕓 Format Timestamp to readable string
  String _formatDate(dynamic value) {
    if (value == null) return '-';
    if (value is Timestamp) {
      final date = value.toDate();
      return "${date.day} ${DateFormat('MMMM yyyy').format(date)}";
    }
    return value.toString();
  }

  @override
  Widget build(BuildContext context) {
    final data = teacherData ?? {};

    return Scaffold(
      appBar: AppBar(
        title: const Text("Profile"),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
      ),
      backgroundColor: const Color(0xFFF8FFF8),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Colors.green))
          : data.isEmpty
              ? const Center(child: Text("No profile data found."))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      // 🧑‍🏫 Profile Avatar
                      CircleAvatar(
                        radius: 55,
                        backgroundColor: const Color(0xFFA8E6A3),
                        backgroundImage: (data['image'] != null &&
                                (data['image'] as String).isNotEmpty)
                            ? NetworkImage(data['image'])
                            : null,
                        child: (data['image'] == null ||
                                (data['image'] as String).isEmpty)
                            ? Text(
                                (data['name'] ?? 'T')
                                    .toString()
                                    .substring(0, 1)
                                    .toUpperCase(),
                                style: const TextStyle(
                                  fontSize: 40,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF2E7D32),
                                ),
                              )
                            : null,
                      ),
                      const SizedBox(height: 20),

                      // 👩‍🏫 Name
                      Text(
                        data['name'] ?? 'Unknown Teacher',
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 8),

                      // 🧾 Username
                      Text(
                        "@${data['username'] ?? '-'}",
                        style: const TextStyle(
                          color: Colors.black54,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 30),

                      // 📋 Info Tiles
                      _infoTile("Email", data['email'] ?? '-'),
                      _infoTile("Phone", data['phone'] ?? '-'),
                      _infoTile("Class", data['class'] ?? '-'),
                      _infoTile("Experience", data['experience'] ?? '-'),
                      _infoTile("Joined Date", _formatDate(data['join_date'])),
                      _infoTile("Base Salary",
                          "RM${data['base_salary']?.toString() ?? '0'}"),

                      // 💰 Tips (calculated from salary collection)
                      _infoTile("Tips (Total Bonus)",
                          "RM${totalBonus.toStringAsFixed(2)}"),
                    ],
                  ),
                ),
    );
  }

  /// 🧩 Reusable info tile widget
  Widget _infoTile(String title, String value) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withOpacity(0.2),
            blurRadius: 6,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 16,
              color: Colors.black54,
              fontWeight: FontWeight.w500,
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 16,
                color: Colors.black87,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
