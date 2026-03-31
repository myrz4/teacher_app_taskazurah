import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

class SetLoginPinScreen extends StatefulWidget {
  const SetLoginPinScreen({super.key});

  @override
  State<SetLoginPinScreen> createState() => _SetLoginPinScreenState();
}

class _SetLoginPinScreenState extends State<SetLoginPinScreen> {
  final _currentPinController = TextEditingController();
  final _newPinController = TextEditingController();
  final _confirmPinController = TextEditingController();

  bool _loading = false;

  @override
  void dispose() {
    _currentPinController.dispose();
    _newPinController.dispose();
    _confirmPinController.dispose();
    super.dispose();
  }

  String _digitsOnly(String input) => input.replaceAll(RegExp(r'[^0-9]'), '');

  // Canonicalize any input (raw or E164) to local digits (0xxxxxxxxx).
  String _phoneLocalDigitsFromAny(String phone) {
    final digits = _digitsOnly(phone);
    if (digits.isEmpty) return '';
    if (digits.startsWith('60') && digits.length > 2) return '0${digits.substring(2)}';
    if (digits.startsWith('0')) return digits;
    if (digits.startsWith('1')) return '0$digits';
    return digits;
  }

  List<String> _candidateDerivedEmails({required String phoneAny}) {
    final emails = <String>{};

    // Preferred canonical form used by the Teacher app.
    final local = _phoneLocalDigitsFromAny(phoneAny);
    if (local.isNotEmpty) emails.add('t_$local@taskazurah.local');

    // Legacy variants (older builds / JavaFX may have used +60 digits).
    final rawDigits = _digitsOnly(phoneAny);
    if (rawDigits.isNotEmpty) emails.add('t_$rawDigits@taskazurah.local');
    if (local.startsWith('0') && local.length > 1) {
      final e164Digits = '60${local.substring(1)}';
      emails.add('t_$e164Digits@taskazurah.local');
    }

    return emails.toList();
  }

  String? _phoneFromEmail(String? email) {
    if (email == null) return null;
    final e = email.trim().toLowerCase();
    if (!e.startsWith('t_') || !e.endsWith('@taskazurah.local')) return null;
    final at = e.indexOf('@');
    if (at <= 2) return null;
    final digits = e.substring(2, at);
    if (digits.isEmpty) return null;
    return digits.startsWith('60') ? '+$digits' : digits;
  }

  String? _normalizePhoneToE164(String input) {
    var v = input.trim().replaceAll(RegExp(r'[\s\-\(\)]'), '');
    if (v.isEmpty) return null;

    if (v.startsWith('+')) {
      final digits = _digitsOnly(v);
      if (digits.length < 10) return null;
      return '+$digits';
    }

    final digits = _digitsOnly(v);
    if (digits.startsWith('60')) {
      if (digits.length < 11) return null;
      return '+$digits';
    }
    if (digits.startsWith('0')) {
      final rest = digits.substring(1);
      if (rest.length < 9) return null;
      return '+60$rest';
    }

    return null;
  }

  String? _currentPhoneE164() {
    final user = FirebaseAuth.instance.currentUser;
    final phone = user?.phoneNumber;
    if (phone != null && phone.trim().isNotEmpty) return phone.trim();

    final derived = _phoneFromEmail(user?.email);
    if (derived == null) return null;
    // If it already looks like +E.164 keep it; else normalize best-effort.
    if (derived.startsWith('+')) return derived;
    return _normalizePhoneToE164(derived) ?? derived;
  }

  bool _validPin(String pin) =>
      pin.length >= 4 && pin.length <= 6 && RegExp(r'^[0-9]+$').hasMatch(pin);

  Future<void> _changePin() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      Fluttertoast.showToast(msg: 'Not logged in. Please login again.');
      return;
    }

    final phoneE164 = _currentPhoneE164();
    if (phoneE164 == null || phoneE164.isEmpty) {
      Fluttertoast.showToast(msg: 'No phone found. Please login again.');
      return;
    }

    final currentPin = _currentPinController.text.trim();
    final newPin = _newPinController.text.trim();
    final confirm = _confirmPinController.text.trim();

    if (!_validPin(currentPin) || !_validPin(newPin)) {
      Fluttertoast.showToast(msg: 'PIN must be 4–6 digits');
      return;
    }
    if (newPin != confirm) {
      Fluttertoast.showToast(msg: 'PIN confirmation does not match');
      return;
    }

    final providers = user.providerData.map((p) => p.providerId).toSet();
    if (!providers.contains('password')) {
      Fluttertoast.showToast(msg: 'PIN is not set yet. Login using OTP and create PIN first.');
      return;
    }

    // Prefer the actually-linked email if present (most reliable).
    final userEmail = (user.email ?? '').trim().toLowerCase();
    final candidates = <String>[];
    if (userEmail.isNotEmpty) candidates.add(userEmail);
    candidates.addAll(_candidateDerivedEmails(phoneAny: phoneE164));

    setState(() => _loading = true);
    try {
      FirebaseAuthException? last;
      var authed = false;
      for (final email in candidates.toSet()) {
        try {
          await user.reauthenticateWithCredential(
            EmailAuthProvider.credential(email: email, password: currentPin),
          );
          authed = true;
          break;
        } on FirebaseAuthException catch (e) {
          last = e;
          // Try other derived-email variants.
          if (e.code == 'wrong-password' || e.code == 'invalid-credential' || e.code == 'user-mismatch') {
            continue;
          }
          rethrow;
        }
      }

      if (!authed) {
        throw last ?? FirebaseAuthException(code: 'invalid-credential');
      }
      await user.updatePassword(newPin);
      if (!mounted) return;
      Fluttertoast.showToast(msg: 'PIN updated');
      Navigator.pop(context);
    } on FirebaseAuthException catch (e) {
      if (e.code == 'wrong-password' || e.code == 'invalid-credential') {
        Fluttertoast.showToast(msg: 'Current PIN is wrong');
        return;
      }
      if (e.code == 'user-mismatch') {
        Fluttertoast.showToast(msg: 'Please login again then try changing PIN.');
        return;
      }
      if (e.code == 'requires-recent-login') {
        Fluttertoast.showToast(msg: 'Please login again then try changing PIN.');
        return;
      }
      Fluttertoast.showToast(msg: e.message ?? 'Failed to update PIN');
    } catch (e) {
      Fluttertoast.showToast(msg: 'Error: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final phone = _currentPhoneE164() ?? '-';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Change PIN'),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
      ),
      backgroundColor: const Color(0xFFF8FFF8),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Phone: $phone', style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 16),
          TextField(
            controller: _currentPinController,
            keyboardType: TextInputType.number,
            obscureText: true,
            maxLength: 6,
            decoration: InputDecoration(
              labelText: 'Current PIN',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(15),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _newPinController,
            keyboardType: TextInputType.number,
            obscureText: true,
            maxLength: 6,
            decoration: InputDecoration(
              labelText: 'New PIN (4–6 digits)',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(15),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _confirmPinController,
            keyboardType: TextInputType.number,
            obscureText: true,
            maxLength: 6,
            decoration: InputDecoration(
              labelText: 'Confirm New PIN',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(15),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2E7D32),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
              ),
              onPressed: _loading ? null : _changePin,
              child: _loading
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(color: Colors.white),
                    )
                  : Text(
                      'Save',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
