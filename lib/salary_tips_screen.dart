// 💰 File: salary_tips_screen.dart
//
// ✅ Firestore SDK version (no REST API)
// ✅ Uses FirebaseFirestore to query salary by teacher_username
// ✅ UI & layout 100% preserved

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class SalaryTipsScreen extends StatefulWidget {
  final String teacherName;
  final String teacherUsername;

  const SalaryTipsScreen({
    super.key,
    required this.teacherName,
    required this.teacherUsername,
  });

  @override
  State<SalaryTipsScreen> createState() => _SalaryTipsScreenState();
}

class _SalaryTipsScreenState extends State<SalaryTipsScreen> {
  bool _isLoading = true;
  String? _errorMsg;
  List<Map<String, dynamic>> _salaryRecords = [];

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  @override
  void initState() {
    super.initState();
    _loadSalaryData();
  }

  /// ✅ Load salary data via Firestore SDK
  Future<void> _loadSalaryData() async {
    try {
      setState(() {
        _isLoading = true;
        _errorMsg = null;
      });

      final query = await _firestore
          .collection('salary')
          .where('teacher_username',
              isEqualTo: widget.teacherUsername.toLowerCase())
          .get();

      final records = query.docs.map((doc) {
        final data = doc.data();
        final baseSalary = _safeToDouble(data['base_salary']);
        final bonus = _safeToDouble(data['bonus']);
        final total = _safeToDouble(data['total']) ?? (baseSalary + bonus);
        final payDate = _formatDateValue(data['pay_date']);

        return {
          'teacher_name': data['teacher_name'] ?? widget.teacherName,
          'teacher_username': data['teacher_username'] ?? '',
          'base_salary': baseSalary,
          'bonus': bonus,
          'total': total,
          'pay_date': payDate,
        };
      }).toList();

      // 🔹 Sort descending by pay_date_raw
      records.sort((a, b) {
        final dateA = a['pay_date']['pay_date_raw'] as DateTime?;
        final dateB = b['pay_date']['pay_date_raw'] as DateTime?;
        return (dateB ?? DateTime(0)).compareTo(dateA ?? DateTime(0));
      });

      setState(() {
        _salaryRecords = records;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _errorMsg = e.toString();
        _isLoading = false;
      });
    }
  }

  /// 🔹 Safely convert dynamic number to double
  double _safeToDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  /// 🔹 Format pay_date (handles Timestamp or String)
  Map<String, dynamic> _formatDateValue(dynamic value) {
    DateTime? dt;
    String display = "Unknown";

    try {
      if (value == null) {
        display = "Unknown";
      } else if (value is String && value.contains("T")) {
        dt = DateTime.tryParse(value);
      } else if (value is String) {
        dt = DateTime.tryParse(value);
      } else if (value is Timestamp) {
        dt = value.toDate();
      } else if (value is Map && value.containsKey('_seconds')) {
        dt = DateTime.fromMillisecondsSinceEpoch(value['_seconds'] * 1000);
      }

      if (dt != null) {
        display = DateFormat('dd/MM/yyyy').format(dt);
      }
    } catch (_) {
      display = "Invalid Date";
    }

    return {
      'pay_date_display': display,
      'pay_date_raw': dt,
    };
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      appBar: AppBar(
        title: const Text("Salary & Tips"),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: Colors.green),
            )
          : _errorMsg != null
              ? Center(
                  child: Text(
                    "Error loading salary data:\n$_errorMsg",
                    style: const TextStyle(
                      color: Colors.redAccent,
                      fontSize: 15,
                    ),
                    textAlign: TextAlign.center,
                  ),
                )
              : _salaryRecords.isEmpty
                  ? const Center(
                      child: Text(
                        "No salary records found for this teacher.",
                        style: TextStyle(fontSize: 16, color: Colors.black54),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _salaryRecords.length,
                      itemBuilder: (context, index) {
                        final record = _salaryRecords[index];
                        final teacherName =
                            record['teacher_name'] ?? widget.teacherName;
                        final base = record['base_salary'] ?? 0.0;
                        final tips = record['bonus'] ?? 0.0;
                        final total = record['total'] ?? (base + tips);
                        final payDateDisplay =
                            record['pay_date']['pay_date_display'] ?? "Unknown";

                        return Container(
                          margin: const EdgeInsets.only(bottom: 15),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(15),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.green.withOpacity(0.15),
                                blurRadius: 8,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // 👩‍🏫 Teacher Name
                              Text(
                                teacherName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF2E7D32),
                                  fontSize: 18,
                                ),
                              ),
                              const SizedBox(height: 10),

                              // 💰 Salary Breakdown
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text(
                                    "Base Salary:",
                                    style: TextStyle(color: Colors.black54),
                                  ),
                                  Text(
                                    "RM${base.toStringAsFixed(2)}",
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text(
                                    "Tips:",
                                    style: TextStyle(color: Colors.black54),
                                  ),
                                  Text(
                                    "RM${tips.toStringAsFixed(2)}",
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w500),
                                  ),
                                ],
                              ),
                              const Divider(),

                              // 🧾 Total
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text(
                                    "Total Received:",
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Colors.black87,
                                    ),
                                  ),
                                  Text(
                                    "RM${total.toStringAsFixed(2)}",
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Colors.teal,
                                      fontSize: 16,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),

                              // 📅 Pay Date
                              Text(
                                "Pay Date: $payDateDisplay",
                                style: const TextStyle(color: Colors.black54),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
    );
  }
}
