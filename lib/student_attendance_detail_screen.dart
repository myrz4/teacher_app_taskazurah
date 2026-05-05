// 📱 File: student_attendance_detail_screen.dart
// 🍋 Modernized UI + Date/Time Formatting + Dropdown Filter

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class StudentAttendanceDetailScreen extends StatefulWidget {
  final String childId;
  final int? childNumericId;
  final String? childNfcUid;
  final String childName;

  const StudentAttendanceDetailScreen({
    super.key,
    required this.childId,
    this.childNumericId,
    this.childNfcUid,
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
  String _selectedViewMode = 'Cards';

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  String _normalizeId(String id) {
    return id.trim();
  }

  void _addAliasCandidate(Set<String> target, String rawValue) {
    final normalized = _normalizeId(rawValue);
    if (normalized.isEmpty || normalized == '-') return;

    target.addAll({
      normalized,
      normalized.replaceAll(' ', ''),
      normalized.toUpperCase(),
      normalized.toLowerCase(),
    });
  }

  List<String> _childIdCandidates(String childId, [String? childNfcUid]) {
    final candidates = <String>{};
    _addAliasCandidate(candidates, childId);
    _addAliasCandidate(candidates, childNfcUid ?? '');
    candidates.removeWhere((e) => e.trim().isEmpty || e.trim() == '-');
    return candidates.toList(growable: false);
  }

  List<String> _childRefPathCandidates(String childId) {
    final normalized = _normalizeId(childId);
    if (normalized.isEmpty || normalized == '-') return const [];

    return <String>[
      'children/$normalized',
      '/children/$normalized',
    ];
  }

  String _extractChildIdFromRef(dynamic rawRef) {
    final value = rawRef?.toString().trim() ?? '';
    if (value.isEmpty) return '';

    final normalized = value.startsWith('/') ? value.substring(1) : value;
    final marker = 'children/';
    final markerIndex = normalized.indexOf(marker);
    if (markerIndex < 0) return '';

    final childPath = normalized.substring(markerIndex + marker.length);
    final slashIndex = childPath.indexOf('/');
    return (slashIndex >= 0 ? childPath.substring(0, slashIndex) : childPath)
        .trim();
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

  String _dayKeyForRecord(String docId, Map<String, dynamic> data, DateTime? effectiveDate) {
    final dateKey = (data['dateKey'] ?? '').toString().trim();
    if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dateKey)) {
      return dateKey;
    }

    final docDate = _tryParseDocIdDate(docId);
    if (docDate != null) {
      return DateFormat('yyyy-MM-dd').format(docDate);
    }

    if (effectiveDate != null) {
      return DateFormat('yyyy-MM-dd').format(effectiveDate);
    }

    return docId;
  }

  int _attendanceSortEpoch(String docId, Map<String, dynamic> data, DateTime? effectiveDate) {
    final candidates = <DateTime?>[
      _toDateNullable(data['updatedAt']),
      _toDateNullable(data['checkOutAt']),
      _toDateNullable(data['check_out_time']),
      _toDateNullable(data['checkOutTime']),
      _toDateNullable(data['checkoutTime']),
      _toDateNullable(data['checkInAt']),
      _toDateNullable(data['check_in_time']),
      _toDateNullable(data['checkInTime']),
      _toDateNullable(data['createdAt']),
      effectiveDate,
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

  bool _shouldPreferRecord(Map<String, dynamic> nextRecord, Map<String, dynamic>? currentRecord) {
    if (currentRecord == null) {
      return true;
    }

    final nextEpoch = (nextRecord['_sortEpoch'] as int?) ?? 0;
    final currentEpoch = (currentRecord['_sortEpoch'] as int?) ?? 0;
    if (nextEpoch != currentEpoch) {
      return nextEpoch > currentEpoch;
    }

    final nextCorrected = nextRecord['isAdminCorrected'] == true;
    final currentCorrected = currentRecord['isAdminCorrected'] == true;
    if (nextCorrected != currentCorrected) {
      return nextCorrected;
    }

    final nextStatus = (nextRecord['status'] ?? '').toString();
    final currentStatus = (currentRecord['status'] ?? '').toString();
    final nextHasCheckOut = nextStatus == 'Checked Out';
    final currentHasCheckOut = currentStatus == 'Checked Out';
    if (nextHasCheckOut != currentHasCheckOut) {
      return nextHasCheckOut;
    }

    final nextHasCheckIn = nextStatus == 'On Time' || nextStatus == 'Manual';
    final currentHasCheckIn = currentStatus == 'On Time' || currentStatus == 'Manual';
    if (nextHasCheckIn != currentHasCheckIn) {
      return nextHasCheckIn;
    }

    return (nextRecord['attendanceId'] ?? '').toString().compareTo(
          (currentRecord['attendanceId'] ?? '').toString(),
        ) >
        0;
  }

  Future<List<DocumentSnapshot<Map<String, dynamic>>>> _fetchTodayDocs({
    required String childId,
    required int? childNumericId,
    String? childNfcUid,
  }) async {
    final normalized = _normalizeId(childId);
    final prefix = DateFormat('yyyy-MM-dd').format(DateTime.now());

    final candidates = <String>{..._childIdCandidates(childId, childNfcUid)};
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
      childNfcUid: childNfcUid,
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
    String? childNfcUid,
  }) async {
    try {
      final normalizedChildId = _normalizeId(childId);
      final candidates = <String>{..._childIdCandidates(normalizedChildId, childNfcUid)};
      if (childNumericId != null) {
        candidates.add(childNumericId.toString());
      }
      final childRefPaths = _childRefPathCandidates(normalizedChildId)
          .map((path) => path.startsWith('/') ? path : '/$path')
          .toSet();
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
        final docNfcUid = (data['nfc_uid'] ?? data['nfcUid'] ?? '').toString().trim();
        final refChildId = _extractChildIdFromRef(data['childRef'] ?? data['child_ref']);
        final rawChildRef = (data['childRef'] ?? data['child_ref'] ?? '').toString().trim();
        final normalizedRawChildRef = rawChildRef.isEmpty
          ? ''
          : (rawChildRef.startsWith('/') ? rawChildRef : '/$rawChildRef');

        final isMatch =
          candidates.contains(suffix) ||
          candidates.contains(docChildId) ||
          candidates.contains(docNfcUid) ||
          (refChildId.isNotEmpty && _normalizeId(refChildId) == normalizedChildId) ||
          childRefPaths.contains(normalizedRawChildRef);
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

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _runAttendanceQuery({
    required String field,
    required Object value,
  }) async {
    try {
      final snap = await _firestore
          .collection('attendance')
          .where(field, isEqualTo: value)
          .get();
      return snap.docs;
    } catch (e) {
      debugPrint('⚠ Failed to fetch history by $field=$value: $e');
      return const [];
    }
  }

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _fetchHistoryByAliases({
    required String childId,
    required int? childNumericId,
    String? childNfcUid,
  }) async {
    final normalizedChildId = _normalizeId(childId);
    final normalizedNfcUid = _normalizeId(childNfcUid ?? '');
    final futures = <Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>>>[];

    if (childNumericId != null) {
      futures.add(_fetchHistoryByNumericId(childNumericId));
    }
    if (normalizedNfcUid.isNotEmpty && normalizedNfcUid != '-') {
      futures.add(_runAttendanceQuery(field: 'nfc_uid', value: normalizedNfcUid));
    }
    if (normalizedChildId.isNotEmpty && normalizedChildId != '-') {
      final childRefDoc = _firestore.doc('children/$normalizedChildId');
      futures.add(_runAttendanceQuery(field: 'childRef', value: childRefDoc));
      for (final childRefPath in _childRefPathCandidates(normalizedChildId)) {
        futures.add(_runAttendanceQuery(field: 'childRef', value: childRefPath));
        futures.add(_runAttendanceQuery(field: 'child_ref', value: childRefPath));
      }
    }

    if (futures.isEmpty) return const [];

    final results = await Future.wait(futures);
    final merged = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    final seen = <String>{};

    for (final docs in results) {
      for (final doc in docs) {
        if (seen.add(doc.id)) {
          merged.add(doc);
        }
      }
    }

    return merged;
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

  String _attendanceStatusLabel(Map<String, dynamic> data, {required bool manualFlag}) {
    if (_attendanceHasCheckOut(data)) {
      return 'Checked Out';
    }
    if (_attendanceHasCheckIn(data)) {
      return manualFlag ? 'Manual' : 'On Time';
    }
    return 'Absent';
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

  String _compactMethodLabel(String value) {
    switch (value.trim().toUpperCase()) {
      case 'NFC':
        return 'NFC';
      case 'QR':
      case 'PARENT_QR':
        return 'Parent QR';
      case 'MANUAL':
      case 'ADMIN_MANUAL':
        return 'Manual';
      default:
        return '';
    }
  }

  List<String> _sourceTags(Map<String, dynamic> data) {
    final tags = <String>[];

    void addTag(String raw) {
      final label = _compactMethodLabel(raw);
      if (label.isNotEmpty && !tags.contains(label)) {
        tags.add(label);
      }
    }

    addTag(_readString(data, const ['checkInMethod', 'checkin_method']));
    addTag(_readString(data, const ['checkOutMethod', 'checkout_method']));

    return tags;
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

  String _auditActionLabel(String value) {
    switch (value.trim().toUpperCase()) {
      case 'CHECK_IN':
        return 'Check-in';
      case 'CHECK_OUT':
        return 'Check-out';
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

  String _auditMethodLabel(String value) {
    switch (value.trim().toUpperCase()) {
      case 'NFC':
        return 'NFC tap';
      case 'PARENT_QR':
      case 'QR':
        return 'Parent QR';
      case 'MANUAL':
      case 'ADMIN_MANUAL':
        return 'Admin manual';
      default:
        return value.trim().isEmpty ? '-' : value;
    }
  }

  String _formatAuditTimestamp(dynamic value) {
    final dt = _toDateNullable(value);
    if (dt == null) return '-';
    return DateFormat('dd MMM yyyy, hh:mm a').format(dt);
  }

  String _auditValue(dynamic value) {
    if (value == null) {
      return '-';
    }
    final parsedDate = _toDateNullable(value);
    if (parsedDate != null) {
      return _formatAuditTimestamp(parsedDate);
    }
    final text = value.toString().trim();
    return text.isEmpty ? '-' : text;
  }

  String _firstNonBlank(Iterable<String> values, {String fallback = '-'}) {
    for (final value in values) {
      final normalized = value.trim();
      if (normalized.isNotEmpty) {
        return normalized;
      }
    }
    return fallback;
  }

  String _nestedString(Map<String, dynamic> source, String parentKey, String childKey) {
    final parent = source[parentKey];
    if (parent is Map) {
      return (parent[childKey] ?? '').toString().trim();
    }
    return '';
  }

  List<_AuditChangeData> _auditChanges(Map<String, dynamic> details) {
    final changes = <_AuditChangeData>[];

    void addChange({
      required String label,
      required dynamic before,
      required dynamic after,
      bool formatAsTimestamp = false,
    }) {
      final beforeValue =
          formatAsTimestamp ? _formatAuditTimestamp(before) : _auditValue(before);
      final afterValue =
          formatAsTimestamp ? _formatAuditTimestamp(after) : _auditValue(after);
      if (beforeValue == '-' && afterValue == '-') {
        return;
      }
      changes.add(
        _AuditChangeData(
          label: label,
          before: beforeValue,
          after: afterValue,
        ),
      );
    }

    addChange(
      label: 'Status',
      before: details['previousStatus'],
      after: details['nextStatus'],
    );
    addChange(
      label: 'Check In',
      before: details['previousCheckInAt'],
      after: details['nextCheckInAt'],
      formatAsTimestamp: true,
    );
    addChange(
      label: 'Check Out',
      before: details['previousCheckOutAt'],
      after: details['nextCheckOutAt'],
      formatAsTimestamp: true,
    );

    return changes;
  }

  List<Widget> _auditContextChips(Map<String, dynamic> details) {
    final chips = <Widget>[];

    void addChip({required IconData icon, required String value}) {
      final text = value.trim();
      if (text.isEmpty || text == '-') {
        return;
      }
      chips.add(_AuditMetaChip(icon: icon, label: text));
    }

    addChip(
      icon: Icons.person_outline,
      value: (details['parentName'] ?? '').toString(),
    );
    addChip(
      icon: Icons.phone_outlined,
      value: (details['parentPhone'] ?? '').toString(),
    );
    addChip(
      icon: Icons.badge_outlined,
      value: (details['representativeName'] ?? '').toString(),
    );
    addChip(
      icon: Icons.people_outline,
      value: (details['representativeRole'] ?? '').toString(),
    );
    addChip(
      icon: Icons.confirmation_number_outlined,
      value: (details['tokenValue'] ?? '').toString(),
    );
    addChip(
      icon: Icons.nfc_outlined,
      value: (details['nfcUid'] ?? '').toString(),
    );

    return chips;
  }

  void _openAuditSheet({
    required String attendanceId,
    required String childName,
    required String dateLabel,
  }) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final theme = Theme.of(context);
        final colorScheme = theme.colorScheme;
        return FractionallySizedBox(
          heightFactor: 0.88,
          child: Container(
            decoration: BoxDecoration(
              color: theme.scaffoldBackgroundColor,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: Column(
              children: [
                const SizedBox(height: 12),
                Container(
                  width: 44,
                  height: 5,
                  decoration: BoxDecoration(
                    color: colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 12, 14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Audit History',
                              style: theme.textTheme.titleLarge?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '$childName • $dateLabel',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: colorScheme.onSurfaceVariant,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ],
                  ),
                ),
                Divider(height: 1, color: colorScheme.outlineVariant),
                Expanded(
                  child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                    stream: _firestore
                        .collection('attendanceAudit')
                        .where('attendanceId', isEqualTo: attendanceId)
                        .snapshots(),
                    builder: (context, snapshot) {
                      if (snapshot.hasError) {
                        return _ScreenStateCard(
                          icon: Icons.error_outline_rounded,
                          title: 'Unable to load audit history',
                          message: '${snapshot.error}',
                        );
                      }

                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const _LoadingState(
                          label: 'Loading audit history...',
                        );
                      }

                      final docs = [...?snapshot.data?.docs];
                      docs.sort((a, b) {
                        final left = _toDateNullable(a.data()['createdAt']) ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        final right = _toDateNullable(b.data()['createdAt']) ??
                            DateTime.fromMillisecondsSinceEpoch(0);
                        return right.compareTo(left);
                      });

                      if (docs.isEmpty) {
                        return const _ScreenStateCard(
                          icon: Icons.history_toggle_off_rounded,
                          title: 'No audit history yet',
                          message:
                              'This attendance record does not have any audit entries yet.',
                        );
                      }

                      return ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                        itemCount: docs.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final data = docs[index].data();
                          final details = data['details'] is Map
                              ? Map<String, dynamic>.from(data['details'] as Map)
                              : <String, dynamic>{};
                          final actorName = _firstNonBlank([
                            (data['actorName'] ?? '').toString(),
                            _nestedString(data, 'actor', 'displayName'),
                          ]);
                          final actorRole = _firstNonBlank([
                            (data['actorRole'] ?? '').toString(),
                            _nestedString(data, 'actor', 'role'),
                          ]);
                          final reason = _auditValue(data['reason']);
                          final method = _auditMethodLabel(
                            (data['method'] ?? '').toString(),
                          );
                          final actionLabel = _auditActionLabel(
                            (data['action'] ?? '').toString(),
                          );
                          final changes = _auditChanges(details);
                          final contextChips = _auditContextChips(details);
                          final notes = _auditValue(details['notes']);

                          return Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: theme.cardColor,
                              borderRadius: BorderRadius.circular(22),
                              border: Border.all(
                                color: colorScheme.outlineVariant,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.04),
                                  blurRadius: 12,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Wrap(
                                        spacing: 8,
                                        runSpacing: 8,
                                        crossAxisAlignment: WrapCrossAlignment.center,
                                        children: [
                                          _AttendanceSourceChip(
                                            label: actionLabel,
                                            highlighted: true,
                                          ),
                                          Text(
                                            _formatAuditTimestamp(data['createdAt']),
                                            style: theme.textTheme.bodySmall?.copyWith(
                                              color: colorScheme.onSurfaceVariant,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    _AuditMetaChip(
                                      icon: Icons.person_outline,
                                      label: actorName,
                                    ),
                                    _AuditMetaChip(
                                      icon: Icons.workspace_premium_outlined,
                                      label: actorRole,
                                    ),
                                    _AuditMetaChip(
                                      icon: Icons.touch_app_outlined,
                                      label: method,
                                    ),
                                  ],
                                ),
                                if (reason != '-') ...[
                                  const SizedBox(height: 14),
                                  _SectionLabel(title: 'Reason'),
                                  const SizedBox(height: 6),
                                  Text(
                                    reason,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      height: 1.45,
                                      color: colorScheme.onSurface,
                                    ),
                                  ),
                                ],
                                if (changes.isNotEmpty) ...[
                                  const SizedBox(height: 14),
                                  _SectionLabel(title: 'Changes'),
                                  const SizedBox(height: 8),
                                  ...changes.map(
                                    (change) => Padding(
                                      padding: const EdgeInsets.only(bottom: 8),
                                      child: _AuditChangeTile(change: change),
                                    ),
                                  ),
                                ],
                                if (contextChips.isNotEmpty) ...[
                                  const SizedBox(height: 14),
                                  _SectionLabel(title: 'Context'),
                                  const SizedBox(height: 8),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: contextChips,
                                  ),
                                ],
                                if (notes != '-') ...[
                                  const SizedBox(height: 14),
                                  _SectionLabel(title: 'Notes'),
                                  const SizedBox(height: 6),
                                  Text(
                                    notes,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      height: 1.45,
                                      color: colorScheme.onSurface,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// 🔍 Apply filter based on selected dropdown value
  List<Map<String, dynamic>> _applyFilter(List<Map<String, dynamic>> records) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    DateTime normalizeRecordDate(Map<String, dynamic> record) {
      final date = _toDate(record['date']);
      return DateTime(date.year, date.month, date.day);
    }

    bool isWithinRange(DateTime date, DateTime start, DateTime end) {
      return !date.isBefore(start) && !date.isAfter(end);
    }

    if (_selectedFilter == "Corrected Only") {
      return records.where((r) => r['isAdminCorrected'] == true).toList();
    }

    if (_selectedFilter == 'Today') {
      return records.where((r) {
        final dt = normalizeRecordDate(r);
        return dt == today;
      }).toList();
    }

    if (_selectedFilter == 'Yesterday') {
      final yesterday = today.subtract(const Duration(days: 1));
      return records.where((r) {
        final dt = normalizeRecordDate(r);
        return dt == yesterday;
      }).toList();
    }

    if (_selectedFilter == 'Last 7 Days') {
      final start = today.subtract(const Duration(days: 6));
      return records.where((r) {
        final dt = normalizeRecordDate(r);
        return isWithinRange(dt, start, today);
      }).toList();
    }

    if (_selectedFilter == "This Week") {
      final startOfWeek = DateTime(
        now.year,
        now.month,
        now.day,
      ).subtract(Duration(days: now.weekday - 1));
      return records.where((r) {
        final dt = normalizeRecordDate(r);
        return isWithinRange(dt, startOfWeek, today);
      }).toList();
    }

    if (_selectedFilter == 'Last 30 Days') {
      final start = today.subtract(const Duration(days: 29));
      return records.where((r) {
        final dt = normalizeRecordDate(r);
        return isWithinRange(dt, start, today);
      }).toList();
    }

    if (_selectedFilter == "This Month") {
      return records.where((r) {
        final dt = normalizeRecordDate(r);
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

  Widget _buildFilterSection({
    required int totalCount,
    required int filteredCount,
  }) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final compact = constraints.maxWidth < 460;
                  final filterField = DropdownButtonFormField<String>(
                    initialValue: _selectedFilter,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Filter attendance',
                      prefixIcon: Icon(Icons.tune_rounded),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'All', child: Text('All records')),
                      DropdownMenuItem(value: 'Today', child: Text('Today')),
                      DropdownMenuItem(value: 'Yesterday', child: Text('Yesterday')),
                      DropdownMenuItem(
                        value: 'Last 7 Days',
                        child: Text('Last 7 days'),
                      ),
                      DropdownMenuItem(
                        value: 'Corrected Only',
                        child: Text('Corrected only'),
                      ),
                      DropdownMenuItem(value: 'This Week', child: Text('This week')),
                      DropdownMenuItem(
                        value: 'Last 30 Days',
                        child: Text('Last 30 days'),
                      ),
                      DropdownMenuItem(value: 'This Month', child: Text('This month')),
                    ],
                    onChanged: (value) {
                      if (value == null) {
                        return;
                      }
                      setState(() => _selectedFilter = value);
                    },
                  );

                  final sortButton = OutlinedButton.icon(
                    onPressed: _toggleSort,
                    icon: Icon(
                      sortDescending
                          ? Icons.arrow_downward_rounded
                          : Icons.arrow_upward_rounded,
                    ),
                    label: Text(
                      sortDescending ? 'Newest first' : 'Oldest first',
                    ),
                  );

                  final actionControls = Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      sortButton,
                      _AttendanceViewChip(
                        icon: Icons.view_agenda_rounded,
                        label: 'Cards',
                        selected: _selectedViewMode == 'Cards',
                        onSelected: () {
                          setState(() {
                            _selectedViewMode = 'Cards';
                          });
                        },
                      ),
                      _AttendanceViewChip(
                        icon: Icons.view_list_rounded,
                        label: 'List',
                        selected: _selectedViewMode == 'List',
                        onSelected: () {
                          setState(() {
                            _selectedViewMode = 'List';
                          });
                        },
                      ),
                    ],
                  );

                  final summary = Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Attendance History',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$filteredCount of $totalCount record${totalCount == 1 ? '' : 's'} visible',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  );

                  if (compact) {
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        summary,
                        const SizedBox(height: 14),
                        filterField,
                        const SizedBox(height: 12),
                        actionControls,
                      ],
                    );
                  }

                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      summary,
                      const SizedBox(height: 14),
                      filterField,
                      const SizedBox(height: 12),
                      actionControls,
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAttendanceCard(Map<String, dynamic> record) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final status = (record['status'] ?? '-').toString();
    final isAdminCorrected = record['isAdminCorrected'] == true;
    final updatedBy = (record['updatedBy'] ?? '').toString().trim();
    final reason = (record['manualReason'] ?? '').toString().trim();
    final sourceSummary = (record['sourceSummary'] ?? '-').toString().trim();
    final sourceTags = ((record['sourceTags'] ?? const <String>[]) as List)
        .map((tag) => tag.toString())
        .where((tag) => tag.trim().isNotEmpty)
        .toList(growable: false);
    final checkIn = _formatTimeOnly(record['checkIn']);
    final checkOut = _formatTimeOnly(record['checkOut']);
    final dateValue = _toDate(record['date']);
    final weekday = DateFormat('EEEE').format(dateValue);

    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _openAuditSheet(
          attendanceId: (record['attendanceId'] ?? '').toString(),
          childName: widget.childName,
          dateLabel: _formatDateOnly(record['date']),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _formatDateOnly(record['date']),
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          weekday,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  _AttendanceStatusBadge(status: status),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _AttendanceMetricTile(
                      icon: Icons.login_rounded,
                      label: 'Check In',
                      value: checkIn,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _AttendanceMetricTile(
                      icon: Icons.logout_rounded,
                      label: 'Check Out',
                      value: checkOut,
                    ),
                  ),
                ],
              ),
              if (sourceTags.isNotEmpty || isAdminCorrected) ...[
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (isAdminCorrected)
                      const _AttendanceSourceChip(
                        label: 'Admin corrected',
                        highlighted: true,
                      ),
                    ...sourceTags.map(
                      (tag) => _AttendanceSourceChip(label: tag),
                    ),
                  ],
                ),
              ],
              if (sourceSummary != '-' || updatedBy.isNotEmpty || reason.isNotEmpty) ...[
                const SizedBox(height: 14),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.45),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (sourceSummary != '-')
                        _AttendanceDetailLine(
                          icon: Icons.route_rounded,
                          label: 'Source',
                          value: sourceSummary,
                        ),
                      if (updatedBy.isNotEmpty)
                        _AttendanceDetailLine(
                          icon: Icons.person_outline_rounded,
                          label: 'Updated By',
                          value: updatedBy,
                        ),
                      if (reason.isNotEmpty)
                        _AttendanceDetailLine(
                          icon: Icons.notes_rounded,
                          label: 'Reason',
                          value: reason,
                          isLast: true,
                        ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  Text(
                    'Tap for full audit details',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () => _openAuditSheet(
                      attendanceId: (record['attendanceId'] ?? '').toString(),
                      childName: widget.childName,
                      dateLabel: _formatDateOnly(record['date']),
                    ),
                    icon: const Icon(Icons.history_rounded),
                    label: const Text('View Audit'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _compactStatusText(String status) {
    switch (status.trim().toUpperCase()) {
      case 'CHECKED OUT':
        return 'Out';
      case 'ON TIME':
        return 'In';
      case 'MANUAL':
        return 'Manual';
      case 'ABSENT':
        return 'Absent';
      default:
        return status.trim().isEmpty ? '-' : status;
    }
  }

  Color _compactStatusColor(BuildContext context, String status) {
    switch (status.trim().toUpperCase()) {
      case 'CHECKED OUT':
        return const Color(0xFF1D4ED8);
      case 'MANUAL':
        return const Color(0xFF9A6700);
      case 'ABSENT':
        return const Color(0xFFC62828);
      default:
        return const Color(0xFF2E7D32);
    }
  }

  Widget _buildCompactAttendanceList(List<Map<String, dynamic>> filtered) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      child: Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Compact list',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Tap any row to open full audit details.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: colorScheme.outlineVariant),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 12, 16, 10),
              child: Row(
                children: [
                  Expanded(flex: 4, child: _CompactAttendanceHeaderText(label: 'Date')),
                  Expanded(flex: 3, child: _CompactAttendanceHeaderText(label: 'In')),
                  Expanded(flex: 3, child: _CompactAttendanceHeaderText(label: 'Out')),
                  Expanded(flex: 3, child: _CompactAttendanceHeaderText(label: 'Status')),
                ],
              ),
            ),
            Divider(height: 1, color: colorScheme.outlineVariant),
            Expanded(
              child: ListView.separated(
                padding: EdgeInsets.zero,
                itemCount: filtered.length,
                separatorBuilder: (_, __) => Divider(
                  height: 1,
                  indent: 16,
                  endIndent: 16,
                  color: colorScheme.outlineVariant.withValues(alpha: 0.7),
                ),
                itemBuilder: (context, index) {
                  final record = filtered[index];
                  final status = (record['status'] ?? '-').toString();
                  final isAdminCorrected = record['isAdminCorrected'] == true;
                  final weekday = DateFormat('EEE').format(_toDate(record['date']));

                  return Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: () => _openAuditSheet(
                        attendanceId: (record['attendanceId'] ?? '').toString(),
                        childName: widget.childName,
                        dateLabel: _formatDateOnly(record['date']),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              flex: 4,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _formatDateOnly(record['date']),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Flexible(
                                        child: Text(
                                          weekday,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: theme.textTheme.bodySmall?.copyWith(
                                            color: colorScheme.onSurfaceVariant,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                      if (isAdminCorrected) ...[
                                        const SizedBox(width: 6),
                                        const Icon(
                                          Icons.edit_rounded,
                                          size: 12,
                                          color: Color(0xFF9A6700),
                                        ),
                                      ],
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            Expanded(
                              flex: 3,
                              child: _CompactAttendanceValue(
                                value: _formatTimeOnly(record['checkIn']),
                              ),
                            ),
                            Expanded(
                              flex: 3,
                              child: _CompactAttendanceValue(
                                value: _formatTimeOnly(record['checkOut']),
                              ),
                            ),
                            Expanded(
                              flex: 3,
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  _compactStatusText(status),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: _compactStatusColor(context, status),
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAttendanceList(List<Map<String, dynamic>> records) {
    final filtered = _applyFilter(records);

    return Column(
      children: [
        _buildFilterSection(
          totalCount: records.length,
          filteredCount: filtered.length,
        ),
        Expanded(
          child: filtered.isEmpty
              ? _ScreenStateCard(
                  icon: Icons.filter_alt_off_rounded,
                  title: 'No records match this filter',
                  message:
                      'Try a different filter to see more attendance history for ${widget.childName}.',
                )
              : _selectedViewMode == 'List'
                  ? _buildCompactAttendanceList(filtered)
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) =>
                          _buildAttendanceCard(filtered[index]),
                    ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final childIdCandidates = _childIdCandidates(widget.childId, widget.childNfcUid);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: Text("${widget.childName}'s Attendance"),
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
            return _ScreenStateCard(
              icon: Icons.error_outline_rounded,
              title: 'Unable to load attendance records',
              message: '${snapshot.error}',
            );
          }

          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _LoadingState(
              label: 'Loading attendance records...',
            );
          }

          return FutureBuilder<List<QueryDocumentSnapshot<Map<String, dynamic>>>>(
            future: _fetchHistoryByAliases(
              childId: widget.childId,
              childNumericId: widget.childNumericId,
              childNfcUid: widget.childNfcUid,
            ),
            builder: (context, historySnap) {
              final streamDocs = snapshot.data?.docs ??
                  const <QueryDocumentSnapshot<Map<String, dynamic>>>[];
              final aliasDocs = historySnap.data ?? const <QueryDocumentSnapshot<Map<String, dynamic>>>[];

              return FutureBuilder<List<DocumentSnapshot<Map<String, dynamic>>>>(
                future: _fetchTodayDocs(
                  childId: widget.childId,
                  childNumericId: widget.childNumericId,
                  childNfcUid: widget.childNfcUid,
                ),
                builder: (context, todayDocSnap) {
                  if (historySnap.connectionState == ConnectionState.waiting ||
                      todayDocSnap.connectionState == ConnectionState.waiting) {
                    return const _LoadingState(
                      label: 'Preparing attendance history...',
                    );
                  }

                  final recordsByDay = <String, Map<String, dynamic>>{};
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

                    final manualFlag =
                      (data['manualCheckout'] == true) ||
                      (data['manual_checkout'] == true) ||
                      (data['manual_in'] == true) ||
                      (data['manual_out'] == true);
                    final sourceSummary = _sourceSummary(data);
                    final manualReason = _manualReason(data);
                    final isAdminCorrected =
                        manualReason.isNotEmpty ||
                        sourceSummary.toLowerCase().contains('admin manual');

                    final record = {
                      'attendanceId': (data['attendanceId'] ?? '').toString().trim().isEmpty
                          ? docId
                          : (data['attendanceId'] ?? '').toString().trim(),
                      'isAdminCorrected': isAdminCorrected,
                      'date': effectiveDate,
                      'sourceSummary': sourceSummary,
                      'sourceTags': _sourceTags(data),
                      'updatedBy': _correctionActor(data),
                      'manualReason': manualReason,
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
                      'status': _attendanceStatusLabel(data, manualFlag: manualFlag),
                      '_sortEpoch': _attendanceSortEpoch(docId, data, effectiveDate),
                    };

                    final dayKey = _dayKeyForRecord(docId, data, effectiveDate);
                    final current = recordsByDay[dayKey];
                    if (_shouldPreferRecord(record, current)) {
                      recordsByDay[dayKey] = record;
                    }
                  }

                  for (final doc in streamDocs) {
                    addDoc(doc.id, doc.data());
                  }
                  for (final doc in aliasDocs) {
                    addDoc(doc.id, doc.data());
                  }

                  final todayDocs = todayDocSnap.data ??
                      const <DocumentSnapshot<Map<String, dynamic>>>[];
                  for (final doc in todayDocs) {
                    final data = doc.data();
                    if (data != null) addDoc(doc.id, data);
                  }

                  final records = recordsByDay.values.toList(growable: false);

                  if (records.isEmpty) {
                    return _ScreenStateCard(
                      icon: Icons.event_busy_rounded,
                      title: 'No attendance history yet',
                      message:
                          'No attendance records were found for ${widget.childName}.',
                    );
                  }

                  records.sort((a, b) {
                    final dtA = (a['_sortEpoch'] as int?) ??
                        _toDate(a['date']).millisecondsSinceEpoch;
                    final dtB = (b['_sortEpoch'] as int?) ??
                        _toDate(b['date']).millisecondsSinceEpoch;
                    return sortDescending
                        ? dtB.compareTo(dtA)
                        : dtA.compareTo(dtB);
                  });

                  return _buildAttendanceList(records);
                },
              );
            },
          );
        },
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: theme.colorScheme.primary),
            const SizedBox(height: 14),
            Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ScreenStateCard extends StatelessWidget {
  const _ScreenStateCard({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 34, color: colorScheme.primary),
                const SizedBox(height: 12),
                Text(
                  title,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    height: 1.45,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AttendanceStatusBadge extends StatelessWidget {
  const _AttendanceStatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final normalized = status.trim().toUpperCase();
    late final Color background;
    late final Color foreground;
    late final IconData icon;
    late final String label;

    switch (normalized) {
      case 'CHECKED OUT':
        background = const Color(0xFFE7F0FF);
        foreground = const Color(0xFF1D4ED8);
        icon = Icons.logout_rounded;
        label = 'Checked Out';
        break;
      case 'ABSENT':
        background = const Color(0xFFFFEBEE);
        foreground = const Color(0xFFC62828);
        icon = Icons.event_busy_rounded;
        label = 'Absent';
        break;
      case 'MANUAL':
        background = const Color(0xFFFFF4D6);
        foreground = const Color(0xFF9A6700);
        icon = Icons.edit_calendar_rounded;
        label = 'Corrected';
        break;
      default:
        background = const Color(0xFFE8F5E9);
        foreground = const Color(0xFF2E7D32);
        icon = Icons.check_circle_rounded;
        label = 'On Time';
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _AttendanceSourceChip extends StatelessWidget {
  const _AttendanceSourceChip({
    required this.label,
    this.highlighted = false,
  });

  final String label;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final background = highlighted
        ? const Color(0xFFFFF4D6)
        : colorScheme.primary.withValues(alpha: 0.10);
    final foreground = highlighted
        ? const Color(0xFF7A5C00)
        : colorScheme.primary;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: highlighted
              ? const Color(0xFFE2BC55)
              : colorScheme.primary.withValues(alpha: 0.16),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }
}

class _AttendanceViewChip extends StatelessWidget {
  const _AttendanceViewChip({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ChoiceChip(
      selected: selected,
      onSelected: (_) => onSelected(),
      avatar: Icon(
        icon,
        size: 16,
        color: selected ? colorScheme.onPrimary : colorScheme.primary,
      ),
      label: Text(label),
      labelStyle: TextStyle(
        color: selected ? colorScheme.onPrimary : colorScheme.primary,
        fontWeight: FontWeight.w700,
      ),
      selectedColor: colorScheme.primary,
      backgroundColor: colorScheme.primary.withValues(alpha: 0.08),
      side: BorderSide(
        color: selected
            ? colorScheme.primary
            : colorScheme.primary.withValues(alpha: 0.18),
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    );
  }
}

class _CompactAttendanceHeaderText extends StatelessWidget {
  const _CompactAttendanceHeaderText({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 0.2,
          ),
    );
  }
}

class _CompactAttendanceValue extends StatelessWidget {
  const _CompactAttendanceValue({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Text(
      value,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
    );
  }
}

class _AttendanceMetricTile extends StatelessWidget {
  const _AttendanceMetricTile({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: colorScheme.primary),
          const SizedBox(height: 10),
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _AttendanceDetailLine extends StatelessWidget {
  const _AttendanceDetailLine({
    required this.icon,
    required this.label,
    required this.value,
    this.isLast = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 0 : 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: colorScheme.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    height: 1.4,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 0.2,
          ),
    );
  }
}

class _AuditMetaChip extends StatelessWidget {
  const _AuditMetaChip({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.42),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: colorScheme.primary),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AuditChangeData {
  const _AuditChangeData({
    required this.label,
    required this.before,
    required this.after,
  });

  final String label;
  final String before;
  final String after;
}

class _AuditChangeTile extends StatelessWidget {
  const _AuditChangeTile({required this.change});

  final _AuditChangeData change;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.34),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            change.label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _AuditChangeValue(
                  label: 'Before',
                  value: change.before,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _AuditChangeValue(
                  label: 'After',
                  value: change.after,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AuditChangeValue extends StatelessWidget {
  const _AuditChangeValue({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
