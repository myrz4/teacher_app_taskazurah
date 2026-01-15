// 📱 File: student_attendance_detail_screen.dart
// 🍋 Modernized UI + Date/Time Formatting + Dropdown Filter

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class StudentAttendanceDetailScreen extends StatefulWidget {
  final String childId;
  final String childName;

  const StudentAttendanceDetailScreen({
    super.key,
    required this.childId,
    required this.childName,
  });

  @override
  State<StudentAttendanceDetailScreen> createState() =>
      _StudentAttendanceDetailScreenState();
}

class _StudentAttendanceDetailScreenState
    extends State<StudentAttendanceDetailScreen> {
  bool sortDescending = true;
  String _selectedFilter = "All";

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  DateTime _toDate(dynamic val) {
    if (val == null) return DateTime(1970);
    if (val is Timestamp) return val.toDate();
    if (val is String) return DateTime.tryParse(val) ?? DateTime(1970);
    return DateTime(1970);
  }

  String _formatDateOnly(dynamic value) {
    if (value == null) return "-";
    try {
      final dt = _toDate(value);
      return DateFormat('dd MMM yyyy').format(dt);
    } catch (_) {
      return value.toString();
    }
  }

  String _formatTimeOnly(dynamic value) {
    if (value == null) return "-";
    try {
      final dt = _toDate(value);
      return DateFormat('hh:mm a').format(dt);
    } catch (_) {
      return value.toString();
    }
  }

  /// 🔍 Apply filter based on selected dropdown value
  List<Map<String, dynamic>> _applyFilter(List<Map<String, dynamic>> records) {
    final now = DateTime.now();

    if (_selectedFilter == "This Week") {
      final startOfWeek = now.subtract(Duration(days: now.weekday - 1));
      return records.where((r) {
        final dt = _toDate(r['date']);
        return dt.isAfter(startOfWeek);
      }).toList();
    }

    if (_selectedFilter == "This Month") {
      return records.where((r) {
        final dt = _toDate(r['date']);
        return dt.month == now.month && dt.year == now.year;
      }).toList();
    }

    return records;
  }

  void _toggleSort() {
    setState(() {
      sortDescending = !sortDescending;
    });
  }

  Widget _buildTable(List<Map<String, dynamic>> filtered) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: DropdownButton<String>(
            value: _selectedFilter,
            items: const [
              DropdownMenuItem(value: "All", child: Text("All")),
              DropdownMenuItem(value: "This Week", child: Text("This Week")),
              DropdownMenuItem(value: "This Month", child: Text("This Month")),
            ],
            onChanged: (val) {
              setState(() => _selectedFilter = val!);
            },
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const [
                DataColumn(label: Text("Date")),
                DataColumn(label: Text("Check In")),
                DataColumn(label: Text("Check Out")),
                DataColumn(label: Text("Status")),
              ],
              rows: filtered.map((r) {
                return DataRow(cells: [
                  DataCell(Text(_formatDateOnly(r['date']))),
                  DataCell(Text(_formatTimeOnly(r['checkIn']))),
                  DataCell(Text(_formatTimeOnly(r['checkOut']))),
                  DataCell(Text(r['status'])),
                ]);
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: Text("${widget.childName}'s Attendance"),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: Icon(
              sortDescending ? Icons.arrow_downward : Icons.arrow_upward,
            ),
            onPressed: _toggleSort,
          ),
        ],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: _firestore
            .collection('attendance')
            .where('childId', isEqualTo: widget.childId)
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(color: Colors.green),
            );
          }

          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return Center(
              child: Text(
                "No attendance records found for ${widget.childName}.",
                style: const TextStyle(fontSize: 16, color: Colors.black54),
              ),
            );
          }

          final records = snapshot.data!.docs.map((doc) {
            final data = doc.data() as Map<String, dynamic>;
            return {
              'date': data['date'],
              'checkIn': data['check_in_time'],
              'checkOut': data['check_out_time'],
              'teacher': data['teacher'] ?? '-',
              'pickedBy': data['parentName'] ?? '-',
              'status': data['isPresent'] == true
                  ? (data['manualCheckout'] == true ? "Manual" : "On Time")
                  : "Absent",
            };
          }).toList();

          records.sort((a, b) {
            final dtA = _toDate(a['date']);
            final dtB = _toDate(b['date']);
            return sortDescending ? dtB.compareTo(dtA) : dtA.compareTo(dtB);
          });

          final filtered = _applyFilter(records);

          return _buildTable(filtered);
        },
      ),
    );
  }
}
