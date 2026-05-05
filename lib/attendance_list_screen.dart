import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'student_attendance_detail_screen.dart';

class AttendanceListScreen extends StatefulWidget {
  const AttendanceListScreen({super.key});

  @override
  State<AttendanceListScreen> createState() => _AttendanceListScreenState();
}

class _AttendanceListScreenState extends State<AttendanceListScreen> {
  bool _isLoading = true;
  List<Map<String, dynamic>> _children = [];
  String? _errorMsg;
  String _searchQuery = '';

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadChildren();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadChildren() async {
    try {
      setState(() {
        _isLoading = true;
        _errorMsg = null;
      });

      final snapshot = await _firestore.collection('children').get();

      final childrenList = snapshot.docs.map((doc) {
        final data = doc.data();
        final photoUrl = (data['photoUrl'] ?? '').toString().trim();
        return {
          'id': doc.id,
          'child_id': data['child_id'],
          'name': data['name'] ?? '-',
          'nfc_uid': data['nfc_uid'] ?? '-',
          'parentName': data['parentName'] ?? '-',
          'photoUrl': photoUrl,
        };
      }).toList()
        ..sort((left, right) {
          final leftName = (left['name'] ?? '').toString().toLowerCase();
          final rightName = (right['name'] ?? '').toString().toLowerCase();
          return leftName.compareTo(rightName);
        });

      if (!mounted) {
        return;
      }

      setState(() {
        _children = childrenList;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMsg = e.toString();
        _isLoading = false;
      });
    }
  }

  List<Map<String, dynamic>> _filteredChildren() {
    final query = _searchQuery.trim().toLowerCase();
    if (query.isEmpty) {
      return _children;
    }

    return _children.where((child) {
      final fields = [
        (child['name'] ?? '').toString(),
        (child['parentName'] ?? '').toString(),
        (child['child_id'] ?? '').toString(),
        (child['nfc_uid'] ?? '').toString(),
      ];
      return fields.any((value) => value.toLowerCase().contains(query));
    }).toList(growable: false);
  }

  void _openAttendanceDetail(Map<String, dynamic> child) {
    final childName = child['name'] ?? '-';
    final childId = child['id'] ?? '-';
    final childNumericId = child['child_id'];

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => StudentAttendanceDetailScreen(
          childId: childId,
          childNumericId: (childNumericId is int)
              ? childNumericId
              : (childNumericId is num)
                  ? childNumericId.toInt()
                  : int.tryParse((childNumericId ?? '').toString()),
          childNfcUid: (child['nfc_uid'] ?? '').toString().trim(),
          childName: childName,
        ),
      ),
    );
  }

  Widget _buildHeader({
    required int totalCount,
    required int visibleCount,
  }) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 460;
            final searchField = TextField(
              controller: _searchController,
              onChanged: (value) {
                setState(() {
                  _searchQuery = value;
                });
              },
              decoration: InputDecoration(
                hintText: 'Search by child, parent, ID, or NFC',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searchQuery.isEmpty
                    ? null
                    : IconButton(
                        onPressed: () {
                          _searchController.clear();
                          setState(() {
                            _searchQuery = '';
                          });
                        },
                        icon: const Icon(Icons.close_rounded),
                      ),
              ),
            );

            final refreshButton = OutlinedButton.icon(
              onPressed: _loadChildren,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Refresh'),
            );

            final summary = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Choose a Student',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Open a child card to view attendance history, corrections, and audit details.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _AttendanceCountChip(
                      icon: Icons.groups_rounded,
                      label: '$totalCount student${totalCount == 1 ? '' : 's'}',
                    ),
                    _AttendanceCountChip(
                      icon: Icons.visibility_rounded,
                      label: '$visibleCount visible',
                    ),
                  ],
                ),
              ],
            );

            if (compact) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  summary,
                  const SizedBox(height: 16),
                  searchField,
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: refreshButton,
                  ),
                ],
              );
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                summary,
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(child: searchField),
                    const SizedBox(width: 12),
                    refreshButton,
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildStudentCard(Map<String, dynamic> child) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final childName = (child['name'] ?? '-').toString();
    final parentName = (child['parentName'] ?? '-').toString().trim();
    final childIdValue = (child['child_id'] ?? '').toString().trim();
    final nfcUid = (child['nfc_uid'] ?? '').toString().trim();
    final photoUrl = (child['photoUrl'] ?? '').toString().trim();

    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _openAttendanceDetail(child),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: colorScheme.primary.withValues(alpha: 0.10),
                    child: photoUrl.isEmpty
                        ? Icon(
                            Icons.child_care_rounded,
                            color: colorScheme.primary,
                          )
                        : ClipOval(
                            child: Image.network(
                              photoUrl,
                              width: 56,
                              height: 56,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Icon(
                                Icons.child_care_rounded,
                                color: colorScheme.primary,
                              ),
                            ),
                          ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          childName,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          parentName.isEmpty || parentName == '-'
                              ? 'Parent not listed'
                              : 'Parent: $parentName',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: 16,
                    color: colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (childIdValue.isNotEmpty && childIdValue != '-')
                    _StudentInfoChip(
                      icon: Icons.badge_outlined,
                      label: 'ID $childIdValue',
                    ),
                  if (nfcUid.isNotEmpty && nfcUid != '-')
                    _StudentInfoChip(
                      icon: Icons.nfc_rounded,
                      label: nfcUid,
                    ),
                  const _StudentInfoChip(
                    icon: Icons.history_rounded,
                    label: 'View attendance',
                    highlighted: true,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStateCard({
    required IconData icon,
    required String title,
    required String message,
    Widget? action,
  }) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Card(
          margin: EdgeInsets.zero,
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
                if (action != null) ...[
                  const SizedBox(height: 14),
                  action,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filteredChildren = _filteredChildren();

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text(
          'Attendance Records',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            onPressed: _isLoading ? null : _loadChildren,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : _errorMsg != null
              ? _buildStateCard(
                  icon: Icons.error_outline_rounded,
                  title: 'Unable to load students',
                  message: 'Error loading data:\n$_errorMsg',
                  action: FilledButton.icon(
                    onPressed: _loadChildren,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Try Again'),
                  ),
                )
              : _children.isEmpty
                  ? _buildStateCard(
                      icon: Icons.groups_rounded,
                      title: 'No students found',
                      message: 'No children were found in the Taska Zuhrah database.',
                    )
                  : RefreshIndicator(
                      onRefresh: _loadChildren,
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                        children: [
                          _buildHeader(
                            totalCount: _children.length,
                            visibleCount: filteredChildren.length,
                          ),
                          const SizedBox(height: 12),
                          if (filteredChildren.isEmpty)
                            _buildStateCard(
                              icon: Icons.search_off_rounded,
                              title: 'No students match this search',
                              message:
                                  'Try another child name, parent name, ID, or NFC value.',
                            )
                          else
                            ...List<Widget>.generate(filteredChildren.length, (index) {
                              final child = filteredChildren[index];
                              return Padding(
                                padding: EdgeInsets.only(
                                  bottom: index == filteredChildren.length - 1 ? 0 : 12,
                                ),
                                child: _buildStudentCard(child),
                              );
                            }),
                        ],
                      ),
                    ),
    );
  }
}

class _AttendanceCountChip extends StatelessWidget {
  const _AttendanceCountChip({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: colorScheme.primary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: colorScheme.primary),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: colorScheme.primary,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _StudentInfoChip extends StatelessWidget {
  const _StudentInfoChip({
    required this.icon,
    required this.label,
    this.highlighted = false,
  });

  final IconData icon;
  final String label;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final background = highlighted
        ? const Color(0xFFE8F5E9)
        : colorScheme.surfaceContainerHighest.withValues(alpha: 0.42);
    final foreground = highlighted ? const Color(0xFF2E7D32) : colorScheme.primary;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: foreground),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: foreground,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
