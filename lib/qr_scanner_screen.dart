// 📱 File: qr_scanner_screen.dart
// ✅ Parent Verification System (Firestore SDK)
// ✅ Polished UI + Gradient Button + Dynamic teacher name
// ✅ After scan: updates attendance.checkout_approval for that child

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';

class QRScannerScreen extends StatefulWidget {
  final String teacherUsername;
  final String teacherName;

  const QRScannerScreen({super.key, required this.teacherUsername, required this.teacherName});

  @override
  State<QRScannerScreen> createState() => _QRScannerScreenState();
}

class _QRScannerScreenState extends State<QRScannerScreen> {
  final GlobalKey qrKey = GlobalKey(debugLabel: 'QR');
  QRViewController? controller;
  bool scanned = false;
  String teacherName = '';

  @override
  void initState() {
    super.initState();
    teacherName = widget.teacherName;
  }

  @override
  void reassemble() {
    super.reassemble();
    if (Platform.isAndroid) {
      controller?.pauseCamera();
    } else if (Platform.isIOS) {
      controller?.resumeCamera();
    }
  }

  Future<Map<String, dynamic>> _checkoutWithParentQr({
    required String qrToken,
  }) async {
    final callable = FirebaseFunctions.instanceFor(region: 'asia-southeast1')
        .httpsCallable('attendanceCheckoutWithParentQr');
    final response = await callable.call<Map<String, dynamic>>({
      'qrToken': qrToken,
      'teacherName': teacherName,
    });
    return Map<String, dynamic>.from(response.data);
  }

  String _reasonToMessage(String reason) {
    switch (reason) {
      case 'pickup-token-not-found':
        return 'QR tidak sah atau tiada dalam rekod.';
      case 'pickup-token-expired':
        return 'QR ini telah tamat tempoh.';
      case 'pickup-token-already-used':
        return 'QR ini sudah digunakan.';
      case 'attendance-not-found':
        return 'Rekod kehadiran tiada untuk hari ini.';
      case 'attendance-not-checked-in':
        return 'Kanak-kanak belum check-in.';
      case 'attendance-already-closed':
        return 'Attendance sudah ditutup.';
      case 'pickup-token-child-mismatch':
        return 'QR ini tidak sepadan dengan kanak-kanak yang dipilih.';
      case 'staff-only':
        return 'Hanya guru atau admin boleh sahkan pickup.';
      default:
        return 'Pengesahan QR gagal.';
    }
  }

  void _onQRViewCreated(QRViewController ctrl) {
    controller = ctrl;
    controller!.scannedDataStream.listen((scanData) async {
      if (scanned) return;
      setState(() => scanned = true);

      final qrValue = scanData.code?.trim();
      if (qrValue == null || qrValue.isEmpty) {
        Fluttertoast.showToast(
          msg: "Invalid QR code",
          backgroundColor: Colors.red,
        );
        setState(() => scanned = false);
        return;
      }

      try {
        final tokenValue = qrValue.replaceFirst("QR_", "").trim();
        final result = await _checkoutWithParentQr(qrToken: tokenValue);
        final bool verified = result['ok'] == true;
        final String parentName = (result['parentName'] ?? '-').toString();
        final String phone = (result['parentPhone'] ?? '-').toString();
        final String childName = (result['childName'] ?? '-').toString();
        final String representativeName = (result['representativeName'] ?? '-').toString();
        final String representativeRole = (result['representativeRole'] ?? '-').toString();

        if (!verified) {
          Fluttertoast.showToast(
            msg: _reasonToMessage((result['reason'] ?? '').toString()),
            backgroundColor: Colors.red,
          );
        }

        // 5️⃣ Paparkan keputusan
        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) => VerificationResultScreen(
                isVerified: verified,
                parentName: parentName,
                phone: phone,
                childName: childName,
                teacher: teacherName,
                representativeName: representativeName,
                representativeRole: representativeRole,
                expiryDate: null,
                teacherUsername: widget.teacherUsername,
              ),
            ),
          );
        }
      } catch (e, st) {
        debugPrint("🔥 Error verifying QR: $e\n$st");
        Fluttertoast.showToast(msg: "Error: $e", backgroundColor: Colors.red);
        setState(() => scanned = false);
      }
    });
  }

  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          QRView(
            key: qrKey,
            onQRViewCreated: _onQRViewCreated,
            overlay: QrScannerOverlayShape(
              borderColor: Colors.greenAccent,
              borderRadius: 12,
              borderLength: 30,
              borderWidth: 8,
              cutOutSize: MediaQuery.of(context).size.width * 0.8,
            ),
          ),
          Positioned(
            top: 60,
            left: 20,
            child: IconButton(
              icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
              onPressed: () => Navigator.pop(context),
            ),
          ),
        ],
      ),
    );
  }
}

//
// 🌿 Verification Result Screen (Enhanced UI – Representative Removed)
//
class VerificationResultScreen extends StatelessWidget {
  final bool isVerified;
  final String parentName;
  final String phone;
  final String childName;
  final String teacher;
  final String representativeName;
  final String representativeRole;
  final DateTime? expiryDate;
  final String teacherUsername;

  const VerificationResultScreen({
    super.key,
    required this.isVerified,
    required this.parentName,
    required this.phone,
    required this.childName,
    required this.teacher,
    required this.representativeName,
    required this.representativeRole,
    required this.expiryDate,
    required this.teacherUsername,
  });

  @override
  Widget build(BuildContext context) {
    final bool isExpired =
        expiryDate != null && DateTime.now().isAfter(expiryDate!);

    final Color mainColor = isVerified
        ? const Color(0xFF2E7D32)
        : (isExpired ? Colors.orange : Colors.redAccent);

    final String title = isVerified
        ? "✅ Verified Parent for $childName"
        : (isExpired
            ? "⏰ QR Expired for $childName"
            : "🚫 QR Already Used or Invalid");

    final String subtitle = isVerified
        ? "Parent verified successfully by $teacher."
        : (isExpired
            ? "This QR expired on ${DateFormat('dd MMM yyyy, hh:mm a').format(expiryDate!)}.\nPlease re-generate from Parent App."
            : "This QR was already used or marked invalid.\nPlease request a new QR.");

    return Scaffold(
      backgroundColor: Colors.grey[100],
      appBar: AppBar(
        title: const Text("Verification Result"),
        backgroundColor: mainColor,
        foregroundColor: Colors.white,
        elevation: 2,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 40),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: Colors.grey.shade300,
                  blurRadius: 15,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 45,
                  backgroundColor: mainColor.withValues(alpha: 0.15),
                  child: Icon(
                    isVerified
                        ? Icons.verified_user
                        : (isExpired ? Icons.schedule : Icons.error_outline),
                    color: mainColor,
                    size: 60,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: mainColor,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  subtitle,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 15,
                    color: Colors.grey[700],
                  ),
                ),
                const SizedBox(height: 25),

                // ✅ Show info only for verified
                if (isVerified) ...[
                  _infoRow("Parent Name", parentName),
                  _infoRow("Phone", phone),
                  _infoRow("Child Name", childName),
                  _infoRow("Pickup By", representativeName),
                  _infoRow("Relationship", representativeRole),
                  _infoRow("Teacher", teacher),
                  _infoRow(
                    "QR Expiry",
                    expiryDate != null
                        ? DateFormat('dd MMM yyyy').format(expiryDate!)
                        : "-",
                  ),
                  const Divider(height: 30),
                  Text(
                    "Verified by: $teacher",
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: mainColor,
                    ),
                  ),
                ],

                const SizedBox(height: 30),

                // 🌈 Gradient New Scan Button
                Container(
                  width: double.infinity,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [mainColor, Colors.green.shade700],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: ElevatedButton.icon(
                    icon:
                        const Icon(Icons.qr_code_scanner, color: Colors.white),
                    label: const Text(
                      "New Scan",
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.transparent,
                      shadowColor: Colors.transparent,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 24,
                        vertical: 16,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30),
                      ),
                    ),
                    onPressed: () => Navigator.pushReplacement(
                      context,
                      MaterialPageRoute(
                        builder: (_) =>
                            QRScannerScreen(teacherUsername: teacherUsername, teacherName: teacher),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            "$label:",
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: Colors.black87,
            ),
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(color: Colors.black87),
            ),
          ),
        ],
      ),
    );
  }
}
