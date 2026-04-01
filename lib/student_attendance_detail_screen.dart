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

  String _readString(Map<String, dynamic> data, List<String> keys) {
    for (final key in keys) {
      final value = (data[key] ?? '').toString().trim();
      if (value.isNotEmpty) return value;
    }
    return '';
  }

  String _methodLabel(String value, {required bool isCheckout}) {
    switch (value.trim().toUpperCase()) {
      case 'NFC':
        return isCheckout ? 'NFC scan' : 'NFC tap';
      case 'QR':
      case 'PARENT_QR':
        return 'Parent QR';
      case 'MANUAL':
      case 'ADMIN_MANUAL':
        return 'Admin manual';
      default:
        return '-';
    }
  }

  String _sourceSummary(Map<String, dynamic> data) {
    final inMethod = _methodLabel(
      _readString(data, const ['checkInMethod', 'checkin_method']),
      isCheckout: false,
    );
    final outMethod = _methodLabel(
      _readString(data, const ['checkOutMethod', 'checkout_method']),
      isCheckout: true,
    );
    if (inMethod == '-' && outMethod == '-') return '-';
    final parts = <String>[];
    if (inMethod != '-') parts.add('In: $inMethod');
    if (outMethod != '-') parts.add('Out: $outMethod');
    return parts.join(' / ');
  }

  String _manualReason(Map<String, dynamic> data) {
    return _readString(data, const ['manualEditReason', 'reason']);
  }

  String _correctionActor(Map<String, dynamic> data) {
    final auditMetadata = data['auditMetadata'];
    if (auditMetadata is Map) {
      final lastActorName = (auditMetadata['lastActorName'] ?? '').toString().trim();
      if (lastActorName.isNotEmpty) return lastActorName;
    }
    return _readString(data, const ['checkedOutByName', 'checkedInByName']);
  }

  Widget _adminCorrectedBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4D6),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE2BC55)),
      ),
      child: const Text(
        'Admin corrected',
        style: TextStyle(
          color: Color(0xFF7A5C00),
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  String _auditActionLabel(String value) {
    switch (value.trim().toUpperCase()) {
      case 'NFC_CHECK_IN':
        return 'NFC check-in';
      case 'QR_CHECK_OUT':
        return 'Parent QR checkout';
      case 'MANUAL_CHECK_IN':
        return 'Manual check-in';
      case 'MANUAL_CHECK_OUT':
        return 'Manual check-out';
      case 'EDIT_RECORD':
        return 'Record edited';
      case 'REOPEN_RECORD':
        return 'Record reopened';
      case 'MARK_ABSENT':
        return 'Marked absent';
      default:
        return value.trim().isEmpty ? 'Unknown action' : value;
    }
  }

  String _formatAuditTimestamp(dynamic value) {
    final dt = _toDateNullable(value);
    if (dt == null) return '-';
    return DateFormat('dd MMM yyyy, hh:mm a').format(dt);
  }

  String _formatAuditTimeRange(Map<String, dynamic> details) {
    final previousIn = _formatAuditTimestamp(details['previousCheckInAt']);
    final previousOut = _formatAuditTimestamp(details['previousCheckOutAt']);
    final nextIn = _formatAuditTimestamp(details['nextCheckInAt']);
    final nextOut = _formatAuditTimestamp(details['nextCheckOutAt']);
    return 'Before: in $previousIn, out $previousOut\nAfter: in $nextIn, out $nextOut';
  }

  void _openAuditDialog({
    required String attendanceId,
    required String childName,
    required String dateLabel,
  }) {
    showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text('Audit History • $dateLabel'),
          content: SizedBox(
            width: 760,
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: _firestore
                  .collection('attendanceAudit')
                  .where('attendanceId', isEqualTo: attendanceId)
                  .snapshots(),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Text('Failed to load audit history.\n${snapshot.error}');
                }
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const SizedBox(
                    height: 160,
                    child: Center(child: CircularProgressIndicator(color: Colors.green)),
                  );
                }

                final docs = [...?snapshot.data?.docs];
                docs.sort((a, b) {
                  final left = _toDateNullable(a.data()['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0);
                  final right = _toDateNullable(b.data()['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0);
                  return right.compareTo(left);
                });

                if (docs.isEmpty) {
                  return const Text('No audit entries found for this attendance record.');
                }

                return ListView.separated(
                  shrinkWrap: true,
                  itemCount: docs.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    final data = docs[index].data();
                    final details = data['details'] is Map<String, dynamic>
                        ? data['details'] as Map<String, dynamic>
                        : <String, dynamic>{};
                    final actorName = (data['actorName'] ?? '').toString().trim();
                    final reason = (data['reason'] ?? '').toString().trim();
                    final method = (data['method'] ?? '').toString().trim();
                    final actionLabel = _auditActionLabel((data['action'] ?? '').toString());

                    return Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE0E0E0)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  actionLabel,
                                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                                ),
                              ),
                              Text(
                                _formatAuditTimestamp(data['createdAt']),
                                style: const TextStyle(color: Colors.black54, fontSize: 12),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text('Child: $childName', style: const TextStyle(fontSize: 13)),
                          Text('Actor: ${actorName.isEmpty ? '-' : actorName}', style: const TextStyle(fontSize: 13)),
                          Text('Method: ${method.isEmpty ? '-' : method}', style: const TextStyle(fontSize: 13)),
                          Text('Reason: ${reason.isEmpty ? '-' : reason}', style: const TextStyle(fontSize: 13)),
                          const SizedBox(height: 6),
                          Text(
                            _formatAuditTimeRange(details),
                            style: const TextStyle(color: Colors.black87, fontSize: 12),
                          ),
                        ],
                      ),
                    );
                  },
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  /// 🔍 Apply filter based on selected dropdown value
  List<Map<String, dynamic>> _applyFilter(List<Map<String, dynamic>> records) {
    final now = DateTime.now();

    if (_selectedFilter == "Corrected Only") {
      return records.where((r) => r['isAdminCorrected'] == true).toList();
    }

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
              DropdownMenuItem(value: "Corrected Only", child: Text("Corrected Only")),
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
                DataColumn(label: Text("Source")),
                DataColumn(label: Text("Updated By")),
                DataColumn(label: Text("Reason")),
                DataColumn(label: Text("Audit")),
              ],
              rows: filtered.map((r) {
                final isAdminCorrected = r['isAdminCorrected'] == true;
                return DataRow(cells: [
                  DataCell(Text(_formatDateOnly(r['date']))),
                  DataCell(Text(_formatTimeOnly(r['checkIn']))),
                  DataCell(Text(_formatTimeOnly(r['checkOut']))),
                  DataCell(Text(r['status'])),
                  DataCell(
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (isAdminCorrected) ...[
                          _adminCorrectedBadge(),
                          const SizedBox(height: 4),
                        ],
                        Text((r['source'] ?? '-').toString()),
                      ],
                    ),
                  ),
                  DataCell(Text((r['updatedBy'] ?? '').toString().isEmpty
                      ? '-'
                      : r['updatedBy'].toString())),
                  DataCell(Text((r['manualReason'] ?? '').toString().isEmpty
                      ? '-'
                      : r['manualReason'].toString())),
                  DataCell(
                    TextButton(
                      onPressed: () => _openAuditDialog(
                        attendanceId: (r['attendanceId'] ?? '').toString(),
                        childName: widget.childName,
                        dateLabel: _formatDateOnly(r['date']),
                      ),
                      child: const Text('View'),
                    ),
                  ),
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
                      'attendanceId': docId,
                      'isAdminCorrected': _manualReason(data).isNotEmpty || _sourceSummary(data).toLowerCase().contains('admin manual'),
                      'date': effectiveDate,
                      'source': _sourceSummary(data),
                      'updatedBy': _correctionActor(data),
                      'manualReason': _manualReason(data),
                      'checkIn': data['check_in_time'] ??
                        data['checkInAt'] ??
                          data['checkInTime'] ??
                          data['check_in'],
                      'checkOut': data['check_out_time'] ??
                        data['checkOutAt'] ??
                          data['checkOutTime'] ??
                          data['check_out'],
                      'teacher': data['teacher'] ?? '-',
                      'pickedBy': data['parentName'] ?? data['pickedBy'] ?? '-',
                        'status': (data['check_out_time'] ?? data['checkOutTime'] ?? data['check_out']) != null
                          ? "Checked Out"
                          : (presentFlag
                            ? (manualFlag ? "Manual" : "On Time")
                            : "Absent"),
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
