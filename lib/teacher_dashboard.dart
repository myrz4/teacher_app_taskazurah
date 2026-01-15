// 🌿 File: teacher_dashboard.dart
//
// ✅ Taska Zurah Teacher Dashboard (Firestore SDK Version + FCM Chat Notifications)
// ✅ Reads teacher profile photo, class, salary, and attendance
// ✅ Includes smart Attendance Analysis Bar (Present vs Absent)
// ✅ Uses Firestore SDK for live data
// ✅ Push Notification integrated for chat (FCM + local popup)

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'login_screen.dart';
import 'qr_scanner_screen.dart';
import 'attendance_list_screen.dart';
import 'salary_tips_screen.dart';
import 'profile_screen.dart';
import 'settings_screen.dart';
import 'daily_report_screen.dart';
import 'chat_inbox_screen.dart';
import 'dart:async';

// 🔔 Local notification plugin setup
final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
    FlutterLocalNotificationsPlugin();

class TeacherDashboard extends StatefulWidget {
  final String name;
  final String username;

  const TeacherDashboard({
    super.key,
    required this.name,
    required this.username,
  });

  @override
  State<TeacherDashboard> createState() => _TeacherDashboardState();
}

class _TeacherDashboardState extends State<TeacherDashboard> {
  int todayAttendanceCount = 0;
  int totalStudentCount = 0;
  int absentStudentCount = 0;

  bool _isLoading = true;
  double _baseSalary = 0.0;
  double _bonus = 0.0;
  String _teacherClass = "Unknown";
  String? _profileImageUrl;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // 🔁 LIVE attendance listeners
  StreamSubscription<QuerySnapshot>? _childrenSub;
  StreamSubscription<QuerySnapshot>? _attendanceSub;

  List<QueryDocumentSnapshot> _childrenDocs = [];
  List<QueryDocumentSnapshot> _attendanceDocs = [];

  @override
  void dispose() {
    _childrenSub?.cancel();
    _attendanceSub?.cancel();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    print("🟢 TeacherDashboard loaded");

    // 🔔 Initialize Firebase Messaging
    _initNotificationSystem();

    _startLiveAttendanceListeners();
    _loadSalaryData();
    _loadTeacherProfile();
  }

  void _startLiveAttendanceListeners() {
    // 👶 Listen to children collection
    _childrenSub = _firestore.collection('children').snapshots().listen((snap) {
      _childrenDocs = snap.docs;
      _recalculateTodayAttendance();
    });

    // 📋 Listen to attendance collection
    _attendanceSub = _firestore.collection('attendance').snapshots().listen((snap) {
      _attendanceDocs = snap.docs;
      _recalculateTodayAttendance();
    });
  }

  void _recalculateTodayAttendance() {
    if (!mounted) return;

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    final total = _childrenDocs.length;
    final presentIds = <String>{};

    DateTime? toDate(dynamic v) {
      if (v == null) return null;
      if (v is Timestamp) return v.toDate();
      if (v is DateTime) return v;
      if (v is String) return DateTime.tryParse(v);
      return null;
    }

    for (final doc in _attendanceDocs) {
      final data = doc.data() as Map<String, dynamic>;

      final date = toDate(data['date']);
      if (date == null) continue;

      final recordDay = DateTime(date.year, date.month, date.day);
      if (recordDay != today) continue;

      final childId = data['childId'];
      if (childId == null) continue;

      final isPresent = data['isPresent'] == true;
      final hasCheckIn = data['check_in_time'] != null;

      if (isPresent || hasCheckIn) {
        presentIds.add(childId);
      }
    }

    if (!mounted) return;

    setState(() {
      todayAttendanceCount = presentIds.length;
      totalStudentCount = total;
      absentStudentCount = total - presentIds.length;
      _isLoading = false;
    });
  }

  // 🔔 Setup Firebase Cloud Messaging + Local Notification
  // 🔔 Setup Firebase Cloud Messaging + Local Notification
  Future<void> _initNotificationSystem() async {
    const AndroidInitializationSettings androidInit =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    const InitializationSettings initSettings =
        InitializationSettings(android: androidInit);

    await flutterLocalNotificationsPlugin.initialize(initSettings);

    FirebaseMessaging messaging = FirebaseMessaging.instance;
    await messaging.requestPermission();

    // ✅ Save FCM token into Firestore
    final token = await messaging.getToken();
    if (token != null) {
      await _firestore
          .collection('teachers')
          .doc(widget.username)
          .set({'fcmToken': token}, SetOptions(merge: true));
      print("📱 Saved FCM token for ${widget.username}: $token");
    }

    // ✅ Listen for all incoming messages (foreground/background)
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      final notification = message.notification;
      if (notification != null) {
        // 🚫 Skip notification ONLY if user currently on ChatScreen
        if (ModalRoute.of(context)?.settings.name == 'ChatScreen') {
          print("💬 Skipping popup — user already in chat screen");
          return;
        }

        flutterLocalNotificationsPlugin.show(
          notification.hashCode,
          notification.title ?? "New Message",
          notification.body ?? "",
          const NotificationDetails(
            android: AndroidNotificationDetails(
              'chat_channel',
              'Chat Notifications',
              importance: Importance.max,
              priority: Priority.high,
              icon: '@mipmap/ic_launcher',
            ),
          ),
        );
      }
    });
  }

  /// ✅ Load latest salary + bonus
  Future<void> _loadSalaryData() async {
    try {
      final snapshot = await _firestore
          .collection('salary')
          .where('teacher_username', isEqualTo: widget.username)
          .get();

      if (snapshot.docs.isNotEmpty) {
        final latest = snapshot.docs.first.data();
        setState(() {
          _baseSalary =
              double.tryParse(latest['base_salary'].toString()) ?? 0.0;
          _bonus = double.tryParse(latest['bonus'].toString()) ?? 0.0;
        });
      }
    } catch (e) {
      Fluttertoast.showToast(msg: "Failed to load salary data: $e");
    }
  }

  /// ✅ Load teacher profile (photo + class)
  Future<void> _loadTeacherProfile() async {
    try {
      final query = await _firestore
          .collection('teachers')
          .where('username', isEqualTo: widget.username)
          .limit(1)
          .get();

      if (query.docs.isNotEmpty) {
        final data = query.docs.first.data();
        setState(() {
          _teacherClass = data['class'] ?? 'Unknown';
          _profileImageUrl = data['image'];
        });
      }
    } catch (e) {
      debugPrint("⚠ Error loading teacher profile: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        backgroundColor: Colors.white,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: Colors.green),
              SizedBox(height: 10),
              Text("Loading dashboard...",
                  style: TextStyle(color: Colors.black54)),
            ],
          ),
        ),
      );
    }

    final currentDate = DateTime.now();
    final formattedDate =
        "${currentDate.day}/${currentDate.month}/${currentDate.year}";

    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        title: const Text(
          "Teacher Dashboard",
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),

      // 🟢 Sidebar Drawer
      drawer: Drawer(
        child: Container(
          color: const Color(0xFFF9FFF9),
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              UserAccountsDrawerHeader(
                decoration: const BoxDecoration(color: Color(0xFF2E7D32)),
                currentAccountPicture: CircleAvatar(
                  backgroundColor: Colors.white,
                  backgroundImage:
                      (_profileImageUrl != null && _profileImageUrl!.isNotEmpty)
                          ? NetworkImage(_profileImageUrl!)
                          : null,
                  child: (_profileImageUrl == null || _profileImageUrl!.isEmpty)
                      ? Text(
                          widget.name.isNotEmpty
                              ? widget.name[0].toUpperCase()
                              : "?",
                          style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF2E7D32),
                          ),
                        )
                      : null,
                ),
                accountName: Text(
                  widget.name,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                accountEmail: Text(widget.username),
              ),
              ListTile(
                leading: const Icon(Icons.person, color: Colors.green),
                title: const Text("Profile"),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) =>
                          ProfileScreen(teacherUsername: widget.username),
                    ),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.settings, color: Colors.teal),
                title: const Text("Settings"),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const SettingsScreen(),
                    ),
                  );
                },
              ),

              // ✉ Chat Inbox
              ListTile(
                leading:
                    const Icon(Icons.chat_bubble, color: Colors.blueAccent),
                title: const Text("Inbox"),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => ChatInboxScreen(
                        teacherUsername: widget.username,
                      ),
                    ),
                  );
                },
              ),

              const Divider(),

              ListTile(
                leading: const Icon(Icons.logout, color: Colors.red),
                title: const Text("Logout"),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.pushReplacement(
                    context,
                    MaterialPageRoute(
                        builder: (context) => const LoginScreen()),
                  );
                },
              ),
            ],
          ),
        ),
      ),

      // 🟢 Main Body
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 👩‍🏫 Greeting Header
            Row(
              children: [
                CircleAvatar(
                  radius: 35,
                  backgroundColor: const Color(0xFFA8E6A3),
                  backgroundImage:
                      (_profileImageUrl != null && _profileImageUrl!.isNotEmpty)
                          ? NetworkImage(_profileImageUrl!)
                          : null,
                  child: (_profileImageUrl == null || _profileImageUrl!.isEmpty)
                      ? Text(
                          widget.name.isNotEmpty
                              ? widget.name[0].toUpperCase()
                              : "?",
                          style: const TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF2E7D32),
                          ),
                        )
                      : null,
                ),
                const SizedBox(width: 15),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text("Welcome back,",
                        style: TextStyle(color: Colors.black54, fontSize: 14)),
                    Text(
                      widget.name,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF2E7D32),
                      ),
                    ),
                    Text("Class: $_teacherClass",
                        style: const TextStyle(
                            fontSize: 13, color: Colors.black54)),
                    Text("Date: $formattedDate",
                        style: const TextStyle(
                            fontSize: 13, color: Colors.black54)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 30),

            // 💰 Salary & Bonus
            Row(
              children: [
                Expanded(
                  child: _summaryCard(
                    "Base Salary",
                    "RM${_baseSalary.toStringAsFixed(2)}",
                    Icons.attach_money,
                    Colors.green.shade700,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _summaryCard(
                    "Bonus",
                    "RM${_bonus.toStringAsFixed(2)}",
                    Icons.star_rate,
                    Colors.orange.shade700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 15),

            // 👨‍👩‍👧‍👦 Attendance Summary + Smart Bar
            _summaryCard(
              "Today's Attendance",
              "$todayAttendanceCount Children",
              Icons.people,
              Colors.teal.shade700,
            ),

            const SizedBox(height: 10),

            if (totalStudentCount > 0)
              Container(
                margin: const EdgeInsets.only(bottom: 20),
                padding: const EdgeInsets.all(15),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(15),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.green.withOpacity(0.2),
                      blurRadius: 8,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text("Attendance Overview",
                        style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: Colors.black87)),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(
                      value: totalStudentCount == 0
                          ? 0
                          : todayAttendanceCount / totalStudentCount,
                      backgroundColor: Colors.red.shade100,
                      color: Colors.green.shade600,
                      minHeight: 10,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Present: $todayAttendanceCount",
                            style: TextStyle(
                                color: Colors.green.shade700,
                                fontWeight: FontWeight.bold)),
                        Text("Absent: $absentStudentCount",
                            style: TextStyle(
                                color: Colors.red.shade700,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ],
                ),
              ),

            // 📋 Main Menu
            Text(
              "Main Menu",
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.green.shade900,
              ),
            ),
            const SizedBox(height: 15),

            // 🧭 Menu Cards
            Wrap(
              spacing: 15,
              runSpacing: 15,
              children: [
                _menuCard(context, "Scan QR Code", Icons.qr_code_scanner,
                    Colors.green.shade700, () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) =>
                          QRScannerScreen(teacherUsername: widget.username),
                    ),
                  );
                }),
                _menuCard(context, "Add Memory Journey",
                    Icons.collections_bookmark, Colors.purple.shade700, () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => DailyReportScreen(
                        teacherName: widget.name,
                        teacherUsername: widget.username,
                        teacherClass: _teacherClass,
                      ),
                    ),
                  );
                }),
                _menuCard(context, "Attendance", Icons.insert_chart,
                    Colors.teal.shade700, () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const AttendanceListScreen(),
                    ),
                  );
                }),
                _menuCard(context, "Salary & Tips", Icons.payments,
                    Colors.orange.shade700, () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => SalaryTipsScreen(
                        teacherName: widget.name,
                        teacherUsername: widget.username,
                      ),
                    ),
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // 🌿 Summary Card
  Widget _summaryCard(String title, String value, IconData icon, Color color) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.25),
            blurRadius: 6,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 35),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        color: Colors.black54,
                        fontWeight: FontWeight.w500,
                        fontSize: 13)),
                const SizedBox(height: 4),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(value,
                      style: TextStyle(
                          color: color,
                          fontWeight: FontWeight.bold,
                          fontSize: 18)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // 📦 Menu Card
  Widget _menuCard(BuildContext context, String title, IconData icon,
      Color color, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        width: MediaQuery.of(context).size.width / 2 - 30,
        height: 150,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: color.withOpacity(0.2),
              blurRadius: 8,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 55, color: color),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: color,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
