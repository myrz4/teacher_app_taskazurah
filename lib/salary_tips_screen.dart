// 💰 File: salary_tips_screen.dart
//
// ✅ Loads real teacher payroll via Cloud Functions
// ✅ Shows monthly base salary, overtime, and total pay
// ✅ Replaces legacy salary collection reads

import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';

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
  List<_PayrollRecord> _payrolls = [];
  _PayrollPolicy? _policy;

  @override
  void initState() {
    super.initState();
    _loadPayrollData();
  }

  Future<void> _loadPayrollData() async {
    try {
      setState(() {
        _isLoading = true;
        _errorMsg = null;
      });

      final callable = FirebaseFunctions.instanceFor(region: 'asia-southeast1')
          .httpsCallable('getTeacherPayrollForTeacher');
      final response = await callable.call(<String, dynamic>{});
      final payload = Map<String, dynamic>.from(
        (response.data as Map<dynamic, dynamic>?) ?? <String, dynamic>{},
      );

      if (payload['ok'] != true) {
        throw Exception(
          (payload['message'] ?? payload['reason'] ?? 'Unable to load payroll.')
              .toString(),
        );
      }

      final rawPolicy = payload['policy'];
      final rawPayrolls = payload['payrolls'];
      final parsedPayrolls = <_PayrollRecord>[];

      if (rawPayrolls is List) {
        for (final entry in rawPayrolls) {
          if (entry is Map) {
            parsedPayrolls.add(_PayrollRecord.fromMap(
              Map<String, dynamic>.from(entry.cast<dynamic, dynamic>()),
              widget.teacherName,
            ));
          }
        }
      } else if (payload['payroll'] is Map) {
        parsedPayrolls.add(_PayrollRecord.fromMap(
          Map<String, dynamic>.from(
              (payload['payroll'] as Map).cast<dynamic, dynamic>()),
          widget.teacherName,
        ));
      }

      parsedPayrolls.sort((a, b) => b.period.compareTo(a.period));

      setState(() {
        _payrolls = parsedPayrolls;
        _policy = rawPolicy is Map
            ? _PayrollPolicy.fromMap(
                Map<String, dynamic>.from(rawPolicy.cast<dynamic, dynamic>()))
            : null;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _errorMsg = e.toString();
        _isLoading = false;
      });
    }
  }

  String _formatDateTime(String value) {
    if (value.trim().isEmpty) return '-';
    try {
      final parsed = DateTime.tryParse(value);
      if (parsed == null) return value;
      return DateFormat('dd MMM yyyy, HH:mm').format(parsed.toLocal());
    } catch (_) {
      return value;
    }
  }

  Color _statusColor(String status) {
    switch (status.trim().toUpperCase()) {
      case 'PAID':
        return Colors.teal.shade700;
      case 'REVIEWED':
        return Colors.blue.shade700;
      default:
        return Colors.orange.shade700;
    }
  }

  String _statusLabel(String status) {
    switch (status.trim().toUpperCase()) {
      case 'PAID':
        return 'Paid';
      case 'REVIEWED':
        return 'Reviewed';
      case 'PENDING_REVIEW':
        return 'Pending Review';
      default:
        return status.trim().isEmpty ? '-' : status;
    }
  }

  Widget _latestPayrollCard(_PayrollRecord record) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.green.withValues(alpha: 0.12),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      record.periodLabel,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF1E4D2B),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      record.teacherName,
                      style: const TextStyle(
                        fontSize: 14,
                        color: Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: _statusColor(record.status).withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  _statusLabel(record.status),
                  style: TextStyle(
                    color: _statusColor(record.status),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          _moneyRow('Base Salary', record.baseSalary),
          _moneyRow('Overtime Pay', record.overtimeTotal),
          _moneyRow('Total Payroll', record.totalPay, emphasized: true),
          const SizedBox(height: 10),
          Text(
            'Overtime Days: ${record.overtimeDayCount} | Blocks: ${record.totalBlocks}',
            style: const TextStyle(color: Colors.black54),
          ),
          if (record.paymentReference.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              'Payment Reference: ${record.paymentReference}',
              style: const TextStyle(color: Colors.black54),
            ),
          ],
          if (record.paidAt.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              'Paid At: ${_formatDateTime(record.paidAt)}',
              style: const TextStyle(color: Colors.black54),
            ),
          ],
        ],
      ),
    );
  }

  Widget _policyCard(_PayrollPolicy policy) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFE9F7EE),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Overtime Policy',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
              color: Color(0xFF1E4D2B),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Weekday: RM${policy.weekdayRate.toStringAsFixed(2)} per 30 min after ${policy.weekdayClosingTimeLabel}',
            style: const TextStyle(color: Colors.black87),
          ),
          const SizedBox(height: 4),
          Text(
            'Saturday: RM${policy.saturdayRate.toStringAsFixed(2)} per 30 min after ${policy.saturdayClosingTimeLabel}',
            style: const TextStyle(color: Colors.black87),
          ),
        ],
      ),
    );
  }

  Widget _moneyRow(String label, double value, {bool emphasized = false}) {
    final style = TextStyle(
      fontWeight: emphasized ? FontWeight.bold : FontWeight.w600,
      color: emphasized ? const Color(0xFF00695C) : Colors.black87,
      fontSize: emphasized ? 16 : 14,
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.black54)),
          Text('RM${value.toStringAsFixed(2)}', style: style),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final latestPayroll = _payrolls.isEmpty ? null : _payrolls.first;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      appBar: AppBar(
        title: const Text("Salary & Overtime"),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: Colors.green),
            )
          : _errorMsg != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          "Error loading payroll data:\n$_errorMsg",
                          style: const TextStyle(
                            color: Colors.redAccent,
                            fontSize: 15,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 14),
                        ElevatedButton(
                          onPressed: _loadPayrollData,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF2E7D32),
                            foregroundColor: Colors.white,
                          ),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : _payrolls.isEmpty
                  ? const Center(
                      child: Text(
                        "No payroll has been generated for this teacher yet.",
                        style: TextStyle(fontSize: 16, color: Colors.black54),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadPayrollData,
                      color: Colors.green,
                      child: ListView.builder(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.all(16),
                        itemCount: _payrolls.length +
                            (latestPayroll != null ? 2 : 0) +
                            (_policy == null ? 0 : 1),
                        itemBuilder: (context, index) {
                          var cursor = 0;
                          if (latestPayroll != null) {
                            if (index == cursor) {
                              return _latestPayrollCard(latestPayroll);
                            }
                            cursor += 1;
                          }

                          if (_policy != null) {
                            if (index == cursor) {
                              return Padding(
                                padding:
                                    const EdgeInsets.only(top: 14, bottom: 6),
                                child: _policyCard(_policy!),
                              );
                            }
                            cursor += 1;
                          }

                          if (index == cursor) {
                            return const Padding(
                              padding: EdgeInsets.only(top: 18, bottom: 8),
                              child: Text(
                                'Payroll History',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFF1E4D2B),
                                ),
                              ),
                            );
                          }
                          cursor += 1;

                          final record = _payrolls[index - cursor];
                          return Container(
                            margin: const EdgeInsets.only(bottom: 14),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.green.withValues(alpha: 0.10),
                                  blurRadius: 12,
                                  offset: const Offset(0, 5),
                                ),
                              ],
                            ),
                            child: ExpansionTile(
                              tilePadding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 10),
                              childrenPadding:
                                  const EdgeInsets.fromLTRB(16, 0, 16, 16),
                              leading: CircleAvatar(
                                backgroundColor: _statusColor(record.status)
                                    .withValues(alpha: 0.15),
                                child: Icon(Icons.payments,
                                    color: _statusColor(record.status)),
                              ),
                              title: Text(
                                record.periodLabel,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold),
                              ),
                              subtitle: Text(
                                'Total RM${record.totalPay.toStringAsFixed(2)}',
                                style: const TextStyle(color: Colors.black54),
                              ),
                              trailing: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: _statusColor(record.status)
                                      .withValues(alpha: 0.14),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  _statusLabel(record.status),
                                  style: TextStyle(
                                    color: _statusColor(record.status),
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              children: [
                                _moneyRow('Base Salary', record.baseSalary),
                                _moneyRow('Overtime Pay', record.overtimeTotal),
                                _moneyRow('Total Payroll', record.totalPay,
                                    emphasized: true),
                                const SizedBox(height: 8),
                                Text(
                                  'Reviewed At: ${record.reviewedAt.isEmpty ? '-' : _formatDateTime(record.reviewedAt)}',
                                  style: const TextStyle(color: Colors.black54),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Paid At: ${record.paidAt.isEmpty ? '-' : _formatDateTime(record.paidAt)}',
                                  style: const TextStyle(color: Colors.black54),
                                ),
                                if (record.paymentReference.isNotEmpty) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    'Payment Reference: ${record.paymentReference}',
                                    style:
                                        const TextStyle(color: Colors.black54),
                                  ),
                                ],
                                const SizedBox(height: 14),
                                const Align(
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    'Daily Overtime Breakdown',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                      color: Color(0xFF1E4D2B),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                if (record.entries.isEmpty)
                                  const Align(
                                    alignment: Alignment.centerLeft,
                                    child: Text(
                                      'No overtime days recorded for this payroll month.',
                                      style: TextStyle(color: Colors.black54),
                                    ),
                                  )
                                else
                                  ...record.entries.map(
                                    (entry) => Container(
                                      margin: const EdgeInsets.only(bottom: 8),
                                      padding: const EdgeInsets.all(12),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFF5FAF6),
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                      child: Row(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          const Icon(Icons.schedule,
                                              size: 18,
                                              color: Color(0xFF2E7D32)),
                                          const SizedBox(width: 10),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  '${entry.dateKey} • ${entry.dayType}',
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.w700,
                                                    color: Color(0xFF1E4D2B),
                                                  ),
                                                ),
                                                const SizedBox(height: 4),
                                                Text(
                                                  '${entry.blocks} x 30 min • RM${entry.total.toStringAsFixed(2)} • Latest checkout ${entry.latestCheckoutAt.isEmpty ? '-' : _formatDateTime(entry.latestCheckoutAt)}',
                                                  style: const TextStyle(
                                                      color: Colors.black87),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _PayrollRecord {
  final String teacherName;
  final String period;
  final String periodLabel;
  final String status;
  final double baseSalary;
  final double overtimeTotal;
  final double totalPay;
  final int overtimeDayCount;
  final int totalBlocks;
  final String reviewedAt;
  final String paidAt;
  final String paymentReference;
  final List<_PayrollEntry> entries;

  const _PayrollRecord({
    required this.teacherName,
    required this.period,
    required this.periodLabel,
    required this.status,
    required this.baseSalary,
    required this.overtimeTotal,
    required this.totalPay,
    required this.overtimeDayCount,
    required this.totalBlocks,
    required this.reviewedAt,
    required this.paidAt,
    required this.paymentReference,
    required this.entries,
  });

  factory _PayrollRecord.fromMap(
      Map<String, dynamic> map, String fallbackTeacherName) {
    final entries = <_PayrollEntry>[];
    final rawEntries = map['overtimeEntries'];
    if (rawEntries is List) {
      for (final entry in rawEntries) {
        if (entry is Map) {
          entries.add(_PayrollEntry.fromMap(
              Map<String, dynamic>.from(entry.cast<dynamic, dynamic>())));
        }
      }
    }

    return _PayrollRecord(
      teacherName: (map['teacherName'] ?? fallbackTeacherName ?? '').toString(),
      period: (map['period'] ?? '').toString(),
      periodLabel: (map['periodLabel'] ?? map['period'] ?? '').toString(),
      status: (map['status'] ?? '').toString(),
      baseSalary: _senToMoney(map['baseSalarySen']),
      overtimeTotal: _senToMoney(map['overtimeTotalSen']),
      totalPay: _senToMoney(map['totalPaySen']),
      overtimeDayCount: _intValue(map['overtimeDayCount']),
      totalBlocks: _intValue(map['totalBlocks']),
      reviewedAt: (map['reviewedAt'] ?? '').toString(),
      paidAt: (map['paidAt'] ?? '').toString(),
      paymentReference: (map['paymentReference'] ?? '').toString(),
      entries: entries,
    );
  }
}

class _PayrollEntry {
  final String dateKey;
  final String dayType;
  final int blocks;
  final double total;
  final String latestCheckoutAt;

  const _PayrollEntry({
    required this.dateKey,
    required this.dayType,
    required this.blocks,
    required this.total,
    required this.latestCheckoutAt,
  });

  factory _PayrollEntry.fromMap(Map<String, dynamic> map) {
    return _PayrollEntry(
      dateKey: (map['dateKey'] ?? '').toString(),
      dayType: (map['dayType'] ?? '').toString(),
      blocks: _intValue(map['blocks']),
      total: _senToMoney(map['totalSen']),
      latestCheckoutAt: (map['latestCheckoutAt'] ?? '').toString(),
    );
  }
}

class _PayrollPolicy {
  final double weekdayRate;
  final double saturdayRate;
  final String weekdayClosingTimeLabel;
  final String saturdayClosingTimeLabel;

  const _PayrollPolicy({
    required this.weekdayRate,
    required this.saturdayRate,
    required this.weekdayClosingTimeLabel,
    required this.saturdayClosingTimeLabel,
  });

  factory _PayrollPolicy.fromMap(Map<String, dynamic> map) {
    return _PayrollPolicy(
      weekdayRate: _senToMoney(map['weekdayHalfHourRateSen']),
      saturdayRate: _senToMoney(map['saturdayHalfHourRateSen']),
      weekdayClosingTimeLabel:
          (map['weekdayClosingTimeLabel'] ?? '-').toString(),
      saturdayClosingTimeLabel:
          (map['saturdayClosingTimeLabel'] ?? '-').toString(),
    );
  }
}

double _senToMoney(dynamic value) {
  if (value == null) return 0.0;
  if (value is int) return value / 100.0;
  if (value is double) return value / 100.0;
  if (value is String) {
    final parsed = double.tryParse(value);
    return parsed == null ? 0.0 : parsed / 100.0;
  }
  return 0.0;
}

int _intValue(dynamic value) {
  if (value is int) return value;
  if (value is double) return value.round();
  if (value is String) return int.tryParse(value) ?? 0;
  return 0;
}
