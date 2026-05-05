// 🌿 File: teacher_dashboard.dart
//
// ✅ Taska Zurah Teacher Dashboard (Firestore SDK Version + FCM Chat Notifications)
// ✅ Reads teacher profile photo, salary, and attendance
// ✅ Includes smart Attendance Analysis Bar (Present vs Absent)
// ✅ Uses Firestore SDK for live data
// ✅ Push Notification integrated for chat (FCM + local popup)

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'qr_scanner_screen.dart'
  if (dart.library.html) 'qr_scanner_screen_web.dart';
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
  final String teacherDocId;

  const TeacherDashboard({
    super.key,
    required this.name,
    required this.username,
    required this.teacherDocId,
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
  String? _profileImageUrl;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // 🔁 LIVE attendance listeners
  StreamSubscription<QuerySnapshot>? _childrenSub;
  final List<StreamSubscription<QuerySnapshot>> _attendanceSubs = [];
  final Map<String, Map<String, QueryDocumentSnapshot>> _attendanceDocsBySource = {};
  Timer? _midnightTimer;

  List<QueryDocumentSnapshot> _childrenDocs = [];
  List<QueryDocumentSnapshot> _attendanceDocs = [];

  String _todayDocPrefix() {
    // Attendance doc IDs are formatted as: yyyy-MM-dd_<childId>
    return "${DateFormat('yyyy-MM-dd').format(DateTime.now())}_";
  }

  String _todayDateKey() {
    return DateFormat('yyyy-MM-dd').format(DateTime.now());
  }

  Timestamp _todayStartOfDayTimestamp() {
    final now = DateTime.now();
    return Timestamp.fromDate(DateTime(now.year, now.month, now.day));
  }

  DateTime? _toDate(dynamic value) {
    if (value == null) return null;
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }

  DateTime? _tryParseDocIdDate(String docId) {
    final match = RegExp(r'^(\d{4}-\d{2}-\d{2})').firstMatch(docId);
    if (match == null) return null;
    return DateTime.tryParse(match.group(1)!);
  }

  String _manualReason(Map<String, dynamic> data) {
    return (data['manualEditReason'] ?? data['manual_edit_reason'] ?? '')
        .toString()
        .trim();
  }

  bool _isAdminCorrected(Map<String, dynamic> data) {
    return _manualReason(data).isNotEmpty;
  }

  int _attendanceSortEpoch(String docId, Map<String, dynamic> data) {
    final candidates = <DateTime?>[
      _toDate(data['updatedAt']),
      _toDate(data['checkOutAt']),
      _toDate(data['check_out_time']),
      _toDate(data['checkOutTime']),
      _toDate(data['checkoutTime']),
      _toDate(data['checkInAt']),
      _toDate(data['check_in_time']),
      _toDate(data['checkInTime']),
      _toDate(data['createdAt']),
      _toDate(data['date']),
      _tryParseDocIdDate(docId),
    ];

    var best = 0;
    for (final candidate in candidates) {
      final epoch = candidate?.millisecondsSinceEpoch ?? 0;
      if (epoch > best) {
        best = epoch;
      }
    }
    return best;
  }

  bool _shouldPreferAttendanceDoc({
    required String nextDocId,
    required Map<String, dynamic> nextData,
    String? currentDocId,
    Map<String, dynamic>? currentData,
  }) {
    if (currentDocId == null || currentData == null) {
      return true;
    }

    final nextEpoch = _attendanceSortEpoch(nextDocId, nextData);
    final currentEpoch = _attendanceSortEpoch(currentDocId, currentData);
    if (nextEpoch != currentEpoch) {
      return nextEpoch > currentEpoch;
    }

    final nextCorrected = _isAdminCorrected(nextData);
    final currentCorrected = _isAdminCorrected(currentData);
    if (nextCorrected != currentCorrected) {
      return nextCorrected;
    }

    final nextHasCheckOut = _attendanceHasCheckOut(nextData);
    final currentHasCheckOut = _attendanceHasCheckOut(currentData);
    if (nextHasCheckOut != currentHasCheckOut) {
      return nextHasCheckOut;
    }

    final nextHasCheckIn = _attendanceHasCheckIn(nextData);
    final currentHasCheckIn = _attendanceHasCheckIn(currentData);
    if (nextHasCheckIn != currentHasCheckIn) {
      return nextHasCheckIn;
    }

    return nextDocId.compareTo(currentDocId) > 0;
  }

  String _extractChildIdFromRef(dynamic rawRef) {
    if (rawRef is DocumentReference) {
      return rawRef.id.trim();
    }

    final value = rawRef?.toString().trim() ?? '';
    if (value.isEmpty) return '';

    final normalized = value.startsWith('/') ? value.substring(1) : value;
    final marker = 'children/';
    final markerIndex = normalized.indexOf(marker);
    if (markerIndex < 0) return '';

    final childPath = normalized.substring(markerIndex + marker.length);
    final slashIndex = childPath.indexOf('/');
    return (slashIndex >= 0 ? childPath.substring(0, slashIndex) : childPath).trim();
  }

  bool _isAttendanceDocForToday({
    required String docId,
    required String todayPrefix,
    required Map<String, dynamic> data,
    required int todayY,
    required int todayM,
    required int todayD,
  }) {
    if (docId.startsWith(todayPrefix)) {
      return true;
    }

    final dateKey = (data['dateKey'] ?? '').toString().trim();
    if (dateKey == todayPrefix.substring(0, todayPrefix.length - 1)) {
      return true;
    }

    final date = _toDate(data['date']);
    if (date == null) {
      return false;
    }

    return date.year == todayY && date.month == todayM && date.day == todayD;
  }

  bool _attendanceHasCheckIn(Map<String, dynamic> data) {
    final status = (data['status'] ?? '').toString().trim().toUpperCase();
    return data['check_in_time'] != null ||
        data['checkInAt'] != null ||
        data['checkInTime'] != null ||
        data['check_in'] != null ||
      data['isPresent'] == true ||
      data['is_present'] == true ||
      status == 'CHECKED_IN' ||
      status == 'CHECKED_OUT';
  }

  bool _attendanceHasCheckOut(Map<String, dynamic> data) {
    final status = (data['status'] ?? '').toString().trim().toUpperCase();
    return data['check_out_time'] != null ||
        data['checkOutAt'] != null ||
        data['checkOutTime'] != null ||
        data['check_out'] != null ||
        data['checkoutTime'] != null ||
        status == 'CHECKED_OUT';
  }

  String _resolveCanonicalChildId({
    required String docId,
    required String todayPrefix,
    required Map<String, dynamic> data,
    required Map<String, String> childAliasToId,
  }) {
    final candidates = <String>[
      _extractChildIdFromRef(data['childRef'] ?? data['child_ref']),
      (data['childId'] ?? '').toString().trim(),
      (data['nfc_uid'] ?? data['nfcUid'] ?? '').toString().trim(),
      (data['child_id'] ?? '').toString().trim(),
    ];

    if (docId.startsWith(todayPrefix)) {
      candidates.add(docId.substring(todayPrefix.length).trim());
    }

    for (final candidate in candidates) {
      if (candidate.isEmpty) continue;
      final canonicalId = childAliasToId[candidate];
      if (canonicalId != null && canonicalId.isNotEmpty) {
        return canonicalId;
      }
    }

    return '';
  }

  void _replaceAttendanceDocsForSource(String source, List<QueryDocumentSnapshot> docs) {
    final sourceDocs = <String, QueryDocumentSnapshot>{};
    for (final doc in docs) {
      sourceDocs[doc.id] = doc;
    }

    _attendanceDocsBySource[source] = sourceDocs;

    final merged = <String, QueryDocumentSnapshot>{};
    for (final docsForSource in _attendanceDocsBySource.values) {
      docsForSource.forEach((docId, doc) {
        merged.putIfAbsent(docId, () => doc);
      });
    }

    _attendanceDocs = merged.values.toList(growable: false);
    _recalculateTodayAttendance();
  }

  void _cancelAttendanceListeners() {
    for (final sub in _attendanceSubs) {
      sub.cancel();
    }
    _attendanceSubs.clear();
    _attendanceDocsBySource.clear();
    _attendanceDocs = [];
  }

  void _subscribeTodayAttendanceStreams() {
    _cancelAttendanceListeners();

    final prefix = _todayDocPrefix();
    final dateKey = _todayDateKey();
    final startOfDay = _todayStartOfDayTimestamp();

    void listen(String source, Query query) {
      _attendanceSubs.add(
        query.snapshots().listen(
          (snap) => _replaceAttendanceDocsForSource(source, snap.docs),
          onError: (error) {
            debugPrint('⚠ Failed today attendance listener ($source): $error');
            _replaceAttendanceDocsForSource(source, []);
          },
        ),
      );
    }

    listen(
      'docPrefix',
      _firestore
          .collection('attendance')
          .orderBy(FieldPath.documentId)
          .startAt([prefix])
          .endAt(["$prefix\uf8ff"]),
    );
    listen(
      'dateKey',
      _firestore.collection('attendance').where('dateKey', isEqualTo: dateKey),
    );
    listen(
      'dateTimestamp',
      _firestore.collection('attendance').where('date', isEqualTo: startOfDay),
    );
    listen(
      'dateString',
      _firestore.collection('attendance').where('date', isEqualTo: dateKey),
    );
  }

  @override
  void dispose() {
    _childrenSub?.cancel();
    _cancelAttendanceListeners();
    _midnightTimer?.cancel();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    debugPrint("🟢 TeacherDashboard loaded");

    // 🔔 Initialize Firebase Messaging
    _initNotificationSystem();

    _startLiveAttendanceListeners();
    _scheduleMidnightRolloverRefresh();
    _loadSalaryData();
    _loadTeacherProfile();
  }

  void _scheduleMidnightRolloverRefresh() {
    _midnightTimer?.cancel();

    final now = DateTime.now();
    final nextMidnight = DateTime(now.year, now.month, now.day).add(const Duration(days: 1));
    final delay = nextMidnight.difference(now) + const Duration(seconds: 2);

    _midnightTimer = Timer(delay, () {
      if (!mounted) return;

      // Re-subscribe to the new day's attendance sources.
      _subscribeTodayAttendanceStreams();

      // Re-arm for the next day
      _scheduleMidnightRolloverRefresh();
    });
  }

  void _startLiveAttendanceListeners() {
    // 👶 Listen to children collection
    _childrenSub = _firestore.collection('children').snapshots().listen((snap) {
      _childrenDocs = snap.docs;
      _recalculateTodayAttendance();
    });

    // 📋 Subscribe to the same day sources JavaFX uses so legacy docs are not missed.
    _subscribeTodayAttendanceStreams();
  }

  void _recalculateTodayAttendance() {
    if (!mounted) return;

    final now = DateTime.now();
    final todayY = now.year;
    final todayM = now.month;
    final todayD = now.day;
    final todayPrefix = _todayDocPrefix();

    final canonicalChildIds = <String>{};
    final childAliasToId = <String, String>{};
    final effectiveDocsByChild = <String, QueryDocumentSnapshot>{};

    void registerChildAlias(dynamic rawAlias, String canonicalId) {
      final alias = rawAlias?.toString().trim() ?? '';
      if (alias.isEmpty) return;
      childAliasToId.putIfAbsent(alias, () => canonicalId);
    }

    for (final childDoc in _childrenDocs) {
      final data = childDoc.data() as Map<String, dynamic>;
      final migratedToChildId = (data['migratedToChildId'] ?? '').toString().trim();
      final canonicalId = (migratedToChildId.isNotEmpty ? migratedToChildId : childDoc.id).trim();
      if (canonicalId.isEmpty) continue;

      canonicalChildIds.add(canonicalId);

      registerChildAlias(canonicalId, canonicalId);
      registerChildAlias(childDoc.id, canonicalId);
      registerChildAlias(data['childId'], canonicalId);
      registerChildAlias(data['child_id'], canonicalId);
      registerChildAlias(data['nfc_uid'], canonicalId);
      registerChildAlias(data['nfcUid'], canonicalId);
      registerChildAlias(data['migratedToChildId'], canonicalId);
      registerChildAlias(_extractChildIdFromRef(data['childRef'] ?? data['child_ref']), canonicalId);
    }

    final total = canonicalChildIds.length;

    for (final doc in _attendanceDocs) {
      final data = doc.data() as Map<String, dynamic>;

      final isToday = _isAttendanceDocForToday(
        docId: doc.id,
        todayPrefix: todayPrefix,
        data: data,
        todayY: todayY,
        todayM: todayM,
        todayD: todayD,
      );
      if (!isToday) continue;

      final childId = _resolveCanonicalChildId(
        docId: doc.id,
        todayPrefix: todayPrefix,
        data: data,
        childAliasToId: childAliasToId,
      );
      if (childId.isEmpty) continue;

      final current = effectiveDocsByChild[childId];
      if (_shouldPreferAttendanceDoc(
        nextDocId: doc.id,
        nextData: data,
        currentDocId: current?.id,
        currentData: current == null ? null : (current.data() as Map<String, dynamic>),
      )) {
        effectiveDocsByChild[childId] = doc;
      }
    }

    final attendedIds = <String>{};
    for (final entry in effectiveDocsByChild.entries) {
      final data = entry.value.data() as Map<String, dynamic>;
      if (_attendanceHasCheckIn(data) || _attendanceHasCheckOut(data)) {
        attendedIds.add(entry.key);
      }
    }

    if (!mounted) return;

    final absentCount = total - attendedIds.length;

    setState(() {
      todayAttendanceCount = attendedIds.length;
      totalStudentCount = total;
      absentStudentCount = absentCount < 0 ? 0 : absentCount;
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
      try {
        final teacherDocId = widget.teacherDocId.trim();
        if (teacherDocId.isNotEmpty) {
          await _firestore
              .collection('teachers')
              .doc(teacherDocId)
              .set({'fcmToken': token}, SetOptions(merge: true));
        }
        debugPrint("📱 Saved FCM token for ${widget.username}: $token");
      } catch (e) {
        // Most commonly: permission-denied because rules allow only admin writes.
        // For chat functionality, don't crash the app if we can't persist the token.
        debugPrint('⚠️ Could not save FCM token to Firestore: $e');
      }
    }

    // ✅ Listen for all incoming messages (foreground/background)
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      final notification = message.notification;
      if (notification != null) {
        if (!mounted) {
          return;
        }
        // 🚫 Skip notification ONLY if user currently on ChatScreen
        if (ModalRoute.of(context)?.settings.name == 'ChatScreen') {
          debugPrint("💬 Skipping popup — user already in chat screen");
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

  /// ✅ Load teacher profile (photo)
  Future<void> _loadTeacherProfile() async {
    try {
      Map<String, dynamic>? data;
      final teacherDocId = widget.teacherDocId.trim();
      if (teacherDocId.isNotEmpty) {
        final snap = await _firestore.collection('teachers').doc(teacherDocId).get();
        data = snap.data();
      }

      if (data != null) {
        setState(() {
          _profileImageUrl = (data?['image'] ?? '').toString().trim();
        });
      }
    } catch (e) {
      debugPrint("⚠ Error loading teacher profile: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final backgroundColor = theme.scaffoldBackgroundColor;
    final cardColor = theme.cardColor;
    final titleColor = isDark ? Colors.white : const Color(0xFF2E7D32);
    final mutedTextColor = isDark ? Colors.white70 : Colors.black54;

    if (_isLoading) {
      return Scaffold(
        backgroundColor: backgroundColor,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: theme.colorScheme.primary),
              const SizedBox(height: 10),
              Text("Loading dashboard...",
                  style: TextStyle(color: mutedTextColor)),
            ],
          ),
        ),
      );
    }

    final currentDate = DateTime.now();
    final formattedDate =
        "${currentDate.day}/${currentDate.month}/${currentDate.year}";

    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        title: const Text(
          "Teacher Dashboard",
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),

      // 🟢 Sidebar Drawer
      drawer: Drawer(
        child: Container(
          color: theme.drawerTheme.backgroundColor ?? cardColor,
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              UserAccountsDrawerHeader(
                decoration: const BoxDecoration(color: Color(0xFF2E7D32)),
                currentAccountPicture: CircleAvatar(
                  backgroundColor: Colors.white,
                  child: (_profileImageUrl == null ||
                          _profileImageUrl!.trim().isEmpty)
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
                      : ClipOval(
                          child: Image.network(
                            _profileImageUrl!.trim(),
                            width: 72,
                            height: 72,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                              child: Text(
                                widget.name.isNotEmpty
                                    ? widget.name[0].toUpperCase()
                                    : "?",
                                style: const TextStyle(
                                  fontSize: 28,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF2E7D32),
                                ),
                              ),
                            ),
                          ),
                        ),
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
                          ProfileScreen(teacherUsername: widget.username, teacherDocId: widget.teacherDocId),
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
                        teacherId: widget.teacherDocId,
                        teacherName: widget.name,
                      ),
                    ),
                  );
                },
              ),

              const Divider(),

              ListTile(
                leading: const Icon(Icons.logout, color: Colors.red),
                title: const Text("Logout"),
                onTap: () async {
                  Navigator.pop(context);
                  await FirebaseAuth.instance.signOut();
                  if (!context.mounted) return;
                  Navigator.of(context).popUntil((route) => route.isFirst);
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
                  child: (_profileImageUrl == null ||
                          _profileImageUrl!.trim().isEmpty)
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
                      : ClipOval(
                          child: Image.network(
                            _profileImageUrl!.trim(),
                            width: 70,
                            height: 70,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Center(
                              child: Text(
                                widget.name.isNotEmpty
                                    ? widget.name[0].toUpperCase()
                                    : "?",
                                style: const TextStyle(
                                  fontSize: 28,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF2E7D32),
                                ),
                              ),
                            ),
                          ),
                        ),
                ),
                const SizedBox(width: 15),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text("Welcome back,",
                        style: TextStyle(fontSize: 14)),
                    Text(
                      widget.name,
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: titleColor,
                      ),
                    ),
                    Text("Date: $formattedDate",
                        style: TextStyle(
                            fontSize: 13, color: mutedTextColor)),
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
                    context,
                    "Base Salary",
                    "RM${_baseSalary.toStringAsFixed(2)}",
                    Icons.attach_money,
                    Colors.green.shade700,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _summaryCard(
                    context,
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
              context,
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
                  color: cardColor,
                  borderRadius: BorderRadius.circular(15),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.green.withValues(alpha: 0.2),
                      blurRadius: 8,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text("Attendance Overview",
                      style: TextStyle(fontWeight: FontWeight.bold)),
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
                          QRScannerScreen(teacherUsername: widget.username, teacherName: widget.name),
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
  Widget _summaryCard(
    BuildContext context,
    String title,
    String value,
    IconData icon,
    Color color,
  ) {
    final theme = Theme.of(context);
    final mutedColor = theme.brightness == Brightness.dark
        ? Colors.white70
        : Colors.black54;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(15),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.25),
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
                  style: TextStyle(
                    color: mutedColor,
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
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        width: MediaQuery.of(context).size.width / 2 - 30,
        height: 150,
        decoration: BoxDecoration(
          color: theme.cardColor,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
                color: color.withValues(alpha: 0.2),
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
