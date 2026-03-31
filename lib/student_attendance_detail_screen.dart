// 📱 File: student_attendance_detail_screen.dart
// 🍋 Modernized UI + Date/Time Formatting + Dropdown Filter

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class StudentAttendanceDetailScreen extends StatefulWidget {
  final String childId;
  final int? childNumericId;
  final String childName;

  const StudentAttendanceDetailScreen({
    super.key,
    required this.childId,
    this.childNumericId,
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

  String _normalizeId(String id) {
    return id.trim();
  }

  List<String> _childIdCandidates(String childId) {
    final normalized = _normalizeId(childId);
    if (normalized.isEmpty || normalized == '-') return const [];

    final candidates = <String>{
      normalized,
      normalized.replaceAll(' ', ''),
      normalized.toUpperCase(),
      normalized.toLowerCase(),
    };
    candidates.removeWhere((e) => e.trim().isEmpty || e.trim() == '-');
    return candidates.toList(growable: false);
  }

  DateTime? _tryParseDocIdDate(String docId) {
    // Expected canonical docId: yyyy-MM-dd_<childId>
    final underscore = docId.indexOf('_');
    if (underscore <= 0) return null;
    final datePart = docId.substring(0, underscore);
    try {
      final parsed = DateTime.parse(datePart);
      // Ensure the UI date is stable across device timezones.
      return DateTime(parsed.year, parsed.month, parsed.day);
    } catch (_) {
      return null;
    }
  }

  Future<List<DocumentSnapshot<Map<String, dynamic>>>> _fetchTodayDocs({
    required String childId,
    required int? childNumericId,
  }) async {
    final normalized = _normalizeId(childId);
    final prefix = DateFormat('yyyy-MM-dd').format(DateTime.now());

    final candidates = <String>{};
    if (normalized.isNotEmpty) {
      candidates.addAll({
        normalized,
        normalized.replaceAll(' ', ''),
        normalized.toUpperCase(),
        normalized.toLowerCase(),
      });
    }
    if (childNumericId != null) {
      candidates.add(childNumericId.toString());
    }

    if (candidates.isEmpty) return const [];

    final futures = candidates.map(
      (c) => _firestore.collection('attendance').doc('${prefix}_$c').get(),
    );

    final snaps = await Future.wait(futures);
    final existing = snaps.where((s) => s.exists).toList(growable: false);

    // Fallback: query all today's docs by docId prefix and filter by suffix/fields.
    final fromPrefix = await _fetchTodayDocsByPrefix(
      datePrefix: '${prefix}_',
      childId: normalized,
      childNumericId: childNumericId,
    );

    final merged = <DocumentSnapshot<Map<String, dynamic>>>[];
    final seen = <String>{};
    for (final d in [...existing, ...fromPrefix]) {
      if (seen.add(d.id)) merged.add(d);
    }

    if (merged.isEmpty) {
      debugPrint(
        '🟡 No today doc found for childId="$normalized" childNumericId=$childNumericId prefix=$prefix (direct tried ${candidates.length} ids)',
      );
    } else {
      debugPrint(
        '🟢 Today docs matched for "$normalized": ${merged.map((e) => e.id).join(", ")}',
      );
    }

    return merged;
  }

  Future<List<DocumentSnapshot<Map<String, dynamic>>>> _fetchTodayDocsByPrefix({
    required String datePrefix,
    required String childId,
    required int? childNumericId,
  }) async {
    try {
      final candidates = <String>{};
      if (childId.isNotEmpty) {
        candidates.addAll({
          childId,
          childId.replaceAll(' ', ''),
          childId.toUpperCase(),
          childId.toLowerCase(),
        });
      }
      if (childNumericId != null) {
        candidates.add(childNumericId.toString());
      }
      if (candidates.isEmpty) return const [];

      final qs = await _firestore
          .collection('attendance')
          .orderBy(FieldPath.documentId)
          .startAt([datePrefix])
          .endAt(['$datePrefix\uf8ff'])
          .get();

      final matched = <DocumentSnapshot<Map<String, dynamic>>>[];

      for (final doc in qs.docs) {
        final data = doc.data();

        // Match by docId suffix: yyyy-MM-dd_<id>
        final underscore = doc.id.indexOf('_');
        final suffix = (underscore >= 0 && underscore + 1 < doc.id.length)
            ? doc.id.substring(underscore + 1)
            : '';

        final docChildId = (data['childId'] ?? data['child_id'] ?? '').toString().trim();

        final isMatch = candidates.contains(suffix) || candidates.contains(docChildId);
        if (isMatch) {
          matched.add(doc);
        }
      }

      return matched;
    } catch (e) {
      debugPrint('⚠ Failed to fetch today docs by prefix "$datePrefix": $e');
      return const [];
    }
  }

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _fetchHistoryByNumericId(int childNumericId) async {
    try {
      final snap = await _firestore
          .collection('attendance')
          .where('child_id', isEqualTo: childNumericId)
          .get();
      return snap.docs;
    } catch (e) {
      debugPrint('⚠ Failed to fetch history by child_id=$childNumericId: $e');
      return const [];
    }
  }

  DateTime? _toDateNullable(dynamic val) {
    if (val == null) return null;
    if (val is Timestamp) return val.toDate();
    if (val is DateTime) return val;
    if (val is String) return DateTime.tryParse(val);
    return null;
  }

  DateTime _toDate(dynamic val) {
    return _toDateNullable(val) ?? DateTime(1970);
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
    final childIdCandidates = _childIdCandidates(widget.childId);

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
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: childIdCandidates.isEmpty
            ? const Stream<QuerySnapshot<Map<String, dynamic>>>.empty()
            : _firestore
                .collection('attendance')
                .where('childId', whereIn: childIdCandidates)
                .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Text(
                'Failed to load attendance records.\n${snapshot.error}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.redAccent),
              ),
            );
          }

          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: CircularProgressIndicator(color: Colors.green),
            );
          }

          return FutureBuilder<List<QueryDocumentSnapshot<Map<String, dynamic>>>>(
            future: (widget.childNumericId == null)
                ? Future.value(const [])
                : _fetchHistoryByNumericId(widget.childNumericId!),
            builder: (context, todaySnap) {
                final streamDocs = snapshot.data?.docs ??
                  const <QueryDocumentSnapshot<Map<String, dynamic>>>[];
              final numericDocs = todaySnap.data ?? const <QueryDocumentSnapshot<Map<String, dynamic>>>[];

              return FutureBuilder<List<DocumentSnapshot<Map<String, dynamic>>>>(
                future: _fetchTodayDocs(
                  childId: widget.childId,
                  childNumericId: widget.childNumericId,
                ),
                builder: (context, todayDocSnap) {
                  final records = <Map<String, dynamic>>[];
                  final seenDocIds = <String>{};

                  void addDoc(String docId, Map<String, dynamic> data) {
                    if (seenDocIds.contains(docId)) return;
                    seenDocIds.add(docId);

                    final docIdDate = _tryParseDocIdDate(docId);

                    // Some legacy docs have a non-parseable `date` value; if so,
                    // fall back to the canonical yyyy-MM-dd part of the docId.
                    final dateFromField = _toDateNullable(data['date']);
                    // IMPORTANT: For canonical docs (yyyy-MM-dd_<id>), prefer the
                    // docId date so UI is stable across device timezones.
                    final effectiveDate = docIdDate ?? dateFromField;

                    final presentFlag =
                        (data['isPresent'] == true) || (data['is_present'] == true);
                    final manualFlag =
                      (data['manualCheckout'] == true) ||
                      (data['manual_checkout'] == true) ||
                      (data['manual_in'] == true) ||
                      (data['manual_out'] == true);

                    records.add({
                      'date': effectiveDate,
                      'checkIn': data['check_in_time'] ??
                          data['checkInTime'] ??
                          data['check_in'],
                      'checkOut': data['check_out_time'] ??
                          data['checkOutTime'] ??
                          data['check_out'],
                      'teacher': data['teacher'] ?? '-',
                      'pickedBy': data['parentName'] ?? data['pickedBy'] ?? '-',
                      'status': presentFlag
                          ? (manualFlag ? "Manual" : "On Time")
                          : "Absent",
                    });
                  }

                  for (final doc in streamDocs) {
                    addDoc(doc.id, doc.data());
                  }
                  for (final doc in numericDocs) {
                    addDoc(doc.id, doc.data());
                  }

                  final todayDocs = todayDocSnap.data ??
                      const <DocumentSnapshot<Map<String, dynamic>>>[];
                  for (final doc in todayDocs) {
                    final data = doc.data();
                    if (data != null) addDoc(doc.id, data);
                  }

                  if (records.isEmpty) {
                    return Center(
                      child: Text(
                        "No attendance records found for ${widget.childName}.",
                        style: const TextStyle(fontSize: 16, color: Colors.black54),
                      ),
                    );
                  }

                  records.sort((a, b) {
                    final dtA = _toDate(a['date']);
                    final dtB = _toDate(b['date']);
                    return sortDescending
                        ? dtB.compareTo(dtA)
                        : dtA.compareTo(dtB);
                  });

                  final filtered = _applyFilter(records);
                  return _buildTable(filtered);
                },
              );
            },
          );
        },
      ),
    );
  }
}
