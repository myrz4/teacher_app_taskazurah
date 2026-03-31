// 🌱 File: lib/login_screen.dart
//
// ✅ Taska Zurah Teacher Login (Firebase Phone OTP)
// ✅ Uses Firebase Auth (phone) + Firestore mapping by phone

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'teacher_dashboard.dart';
 
// Routing is handled by TeacherAuthGate.
import 'otp_pin_reset_request.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();
  final TextEditingController _otpController = TextEditingController();
  bool _isLoading = false;

  DateTime? _lastOtpRequestAt;
  static const Duration _otpCooldown = Duration(seconds: 60);

  String? _verificationId;
  bool _codeSent = false;
  bool _otpMode = false;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  Future<bool> _canRequestOtpBeforeSending({required String phoneE164}) async {
    try {
      final callable = FirebaseFunctions.instanceFor(region: 'asia-southeast1').httpsCallable('canRequestOtp');
      final res = await callable.call({
        'phone': phoneE164,
        'kind': 'teacher',
      });
      final data = (res.data is Map) ? (res.data as Map) : <dynamic, dynamic>{};
      final allowed = data['allowed'] == true;
      if (allowed) return true;

      final reason = (data['reason'] ?? '').toString();
      if (reason == 'not-registered') {
        Fluttertoast.showToast(msg: 'Number not registered as teacher. Contact admin.');
      } else {
        Fluttertoast.showToast(msg: 'Unable to verify registration ($reason). Try again later.');
      }
      return false;
    } catch (e) {
      Fluttertoast.showToast(msg: 'Unable to verify registration. Try again later.');
      return false;
    }
  }

  Future<bool> _ensureTeacherRoleOrSignOut() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return false;

    try {
      // Force-refresh so recently-updated custom claims are picked up.
      Future<String?> readRoleOnce() async {
        final r = await user.getIdTokenResult(true);
        final v = r.claims?['role'];
        return v == null ? null : v.toString();
      }

      var role = await readRoleOnce();
      if (role == 'teacher' || role == 'admin') return true;

      // Claims can take a moment to propagate after being set in Admin SDK.
      await Future.delayed(const Duration(seconds: 2));
      await user.reload();
      role = await readRoleOnce();
      if (role == 'teacher' || role == 'admin') return true;

      // Best-effort: if the role claim isn't there yet, try to self-claim it
      // (only succeeds when the signed-in phone is registered in teachers).
      await _claimTeacherRoleIfRegistered();
      role = await readRoleOnce();
      if (role == 'teacher' || role == 'admin') return true;

      debugPrint('Teacher auth blocked (missing role claim).');
      debugPrint('  uid   : ${user.uid}');
      debugPrint('  phone : ${user.phoneNumber ?? ""}');

      final finalToken = await user.getIdTokenResult(false);
      debugPrint('  claims: ${finalToken.claims ?? {}}');

      Fluttertoast.showToast(
        msg: 'Not authorized. Set role=teacher for UID: ${user.uid}',
      );
      await FirebaseAuth.instance.signOut();
      return false;
    } catch (e) {
      Fluttertoast.showToast(msg: 'Failed to verify access: $e');
      await FirebaseAuth.instance.signOut();
      return false;
    }
  }

  @override
  void initState() {
    super.initState();
    // AuthGate owns session restoration + routing.
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _pinController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  String _digitsOnly(String input) => input.replaceAll(RegExp(r'[^0-9]'), '');

  String _myPhoneTail(String phoneAny) {
    var d = _digitsOnly(phoneAny);
    if (d.isEmpty) return '';
    if (d.startsWith('60') && d.length > 2) d = d.substring(2);
    if (d.startsWith('0') && d.length > 1) d = d.substring(1);
    return d;
  }

  // ignore: unused_element
  Future<bool> _ensureTeacherRegisteredAfterOtpOrSignOut({required String phoneE164}) async {
    // Runs ONLY after phone OTP sign-in.
    final tail = _myPhoneTail(phoneE164);
    final local = _phoneLocalDigitsFromAny(phoneE164);
    if (tail.isEmpty) return false;

    try {
      // Prefer phoneTail (new records), fallback to phone (legacy records).
      var q = await _firestore.collection('teachers').where('phoneTail', isEqualTo: tail).limit(1).get();
      if (q.docs.isEmpty && local.isNotEmpty) {
        q = await _firestore.collection('teachers').where('phone', isEqualTo: local).limit(1).get();
      }

      if (q.docs.isEmpty) {
        Fluttertoast.showToast(msg: 'Number not registered as teacher. Contact admin.');
        await FirebaseAuth.instance.signOut();
        return false;
      }
      return true;
    } catch (e) {
      Fluttertoast.showToast(msg: 'Failed to check registration: $e');
      await FirebaseAuth.instance.signOut();
      return false;
    }
  }

  // Firestore stores phones like 011..., not +60....
  // Canonicalize any input (raw or E164) to local digits (0xxxxxxxxx).
  String _phoneLocalDigitsFromAny(String phone) {
    final digits = _digitsOnly(phone);
    if (digits.isEmpty) return '';
    if (digits.startsWith('60') && digits.length > 2) return '0${digits.substring(2)}';
    if (digits.startsWith('0')) return digits;
    if (digits.startsWith('1')) return '0$digits';
    return digits;
  }

  List<String> _candidateDerivedEmails({required String rawPhone, required String phoneE164}) {
    final emails = <String>{};

    final local = _phoneLocalDigitsFromAny(rawPhone.isNotEmpty ? rawPhone : phoneE164);
    if (local.isNotEmpty) emails.add('t_$local@taskazurah.local');

    // Legacy variants (older builds may have used +60 digits).
    final e164Digits = _digitsOnly(phoneE164);
    if (e164Digits.isNotEmpty) emails.add('t_$e164Digits@taskazurah.local');
    final rawDigits = _digitsOnly(rawPhone);
    if (rawDigits.isNotEmpty) emails.add('t_$rawDigits@taskazurah.local');

    return emails.toList();
  }

  String _emailFromPhone(String phoneE164) {
    final local = _phoneLocalDigitsFromAny(phoneE164);
    return 't_$local@taskazurah.local';
  }

  String? _phoneFromEmail(String? email) {
    if (email == null) return null;
    final e = email.trim().toLowerCase();
    if (!e.startsWith('t_') || !e.endsWith('@taskazurah.local')) return null;
    final at = e.indexOf('@');
    if (at <= 2) return null;
    final digits = e.substring(2, at);
    if (digits.isEmpty) return null;
    if (digits.startsWith('60') && digits.length > 2) return '0${digits.substring(2)}';
    return digits;
  }

  Future<void> _syncLoginModeForPhone() async {
    final rawPhone = _phoneController.text.trim();
    final phoneE164 = _normalizePhoneToE164(rawPhone);
    if (phoneE164 == null) return;

    try {
      final email = _emailFromPhone(phoneE164);
      final methods = await FirebaseAuth.instance.fetchSignInMethodsForEmail(email);
      if (!mounted) return;

      final hasPassword = methods.contains('password');
      setState(() {
        _otpMode = !hasPassword;
        _codeSent = false;
        _verificationId = null;
      });
    } catch (_) {
      // Ignore detection errors; user can manually toggle.
    }
  }

  Future<void> _sendOtp() async {
    final rawPhone = _phoneController.text.trim();
    final phoneE164 = _normalizePhoneToE164(rawPhone);
    if (phoneE164 == null) {
      Fluttertoast.showToast(msg: "Please enter a valid phone number (e.g. +6011...) ");
      return;
    }

    final now = DateTime.now();
    final last = _lastOtpRequestAt;
    if (last != null) {
      final elapsed = now.difference(last);
      if (elapsed < _otpCooldown) {
        final remaining = (_otpCooldown - elapsed).inSeconds;
        Fluttertoast.showToast(msg: "Please wait $remaining seconds before requesting OTP again.");
        return;
      }
    }

    setState(() => _isLoading = true);
    Fluttertoast.showToast(msg: "Sending OTP...");

    try {
      final ok = await _canRequestOtpBeforeSending(phoneE164: phoneE164);
      if (!ok) return;

      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: phoneE164,
        timeout: const Duration(seconds: 60),
        verificationCompleted: (PhoneAuthCredential credential) async {
          try {
            TeacherOtpPinResetRequest.markPendingForPhone(phoneE164: phoneE164);
            await FirebaseAuth.instance.signInWithCredential(credential);
            Fluttertoast.showToast(msg: 'Signed in. Continue...');
          } catch (e) {
            TeacherOtpPinResetRequest.clear();
            Fluttertoast.showToast(msg: "Auto verification failed: $e");
          }
        },
        verificationFailed: (FirebaseAuthException e) {
          if (mounted) {
            setState(() => _isLoading = false);
          }
          final msg = _friendlyAuthErrorMessage(e);
          Fluttertoast.showToast(msg: msg);
        },
        codeSent: (String verificationId, int? resendToken) {
          if (!mounted) return;
          setState(() {
            _verificationId = verificationId;
            _codeSent = true;
            _isLoading = false;
            _lastOtpRequestAt = DateTime.now();
          });
          Fluttertoast.showToast(msg: "OTP sent. Please enter the 6-digit code.");
        },
        codeAutoRetrievalTimeout: (String verificationId) {
          _verificationId = verificationId;
        },
      );
    } catch (e) {
      Fluttertoast.showToast(msg: "Error sending OTP: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  String _friendlyAuthErrorMessage(FirebaseAuthException e) {
    // Common Firebase Phone Auth failure cases.
    final rawMsg = (e.message ?? '').toUpperCase();
    if (rawMsg.contains('BILLING_NOT_ENABLED')) {
      return 'Phone OTP requires Google Cloud Billing for this Firebase project. Enable Billing (Blaze) or use Firebase Test Phone Numbers.';
    }
    switch (e.code) {
      case 'billing-not-enabled':
        return 'Phone OTP requires Google Cloud Billing for this Firebase project. Enable Billing (Blaze) or use Firebase Test Phone Numbers.';
      case 'too-many-requests':
        return 'We have blocked OTP requests due to unusual activity. Please wait and try again, or use a Firebase test phone number.';
      case 'invalid-phone-number':
        return 'Invalid phone number format. Use +6011...';
      case 'captcha-check-failed':
        return 'reCAPTCHA / Play Integrity check failed. Try again on a real device with Google Play services.';
      case 'app-not-authorized':
      case 'invalid-app-credential':
      case 'missing-client-identifier':
        return 'App verification failed. Make sure the Firebase Android app package + SHA-1/SHA-256 match the APK you installed.';
      default:
        // Keep the original message if available.
        final m = e.message;
        if (m != null && m.trim().isNotEmpty) return m;
        return 'Verification failed (${e.code}).';
    }
  }

  Future<void> _loginWithPin() async {
    final rawPhone = _phoneController.text.trim();
    final phoneE164 = _normalizePhoneToE164(rawPhone);
    if (phoneE164 == null) {
      Fluttertoast.showToast(msg: "Please enter a valid phone number (e.g. +6011...) ");
      return;
    }

    final pin = _pinController.text.trim();
    if (pin.length < 4 || pin.length > 6 || !RegExp(r'^[0-9]+$').hasMatch(pin)) {
      Fluttertoast.showToast(msg: 'PIN must be 4–6 digits');
      return;
    }

    setState(() => _isLoading = true);
    try {
      final emails = _candidateDerivedEmails(rawPhone: rawPhone, phoneE164: phoneE164);
      FirebaseAuthException? lastAuthError;

      var signedIn = false;
      for (final email in emails) {
        try {
          await FirebaseAuth.instance.signInWithEmailAndPassword(email: email, password: pin);
          signedIn = true;
          break;
        } on FirebaseAuthException catch (e) {
          lastAuthError = e;
          if (e.code == 'user-not-found' || e.code == 'wrong-password' || e.code == 'invalid-credential') {
            continue;
          }
          rethrow;
        }
      }

      if (!signedIn) {
        throw lastAuthError ?? FirebaseAuthException(code: 'invalid-credential');
      }
      Fluttertoast.showToast(msg: 'Signed in. Continue...');
    } on FirebaseAuthException catch (e) {
      if (e.code == 'user-not-found' || e.code == 'wrong-password' || e.code == 'invalid-credential') {
        Fluttertoast.showToast(msg: 'PIN not set or incorrect. Use OTP login.');
        if (mounted) {
          setState(() {
            _otpMode = true;
            _codeSent = false;
            _verificationId = null;
          });
        }
      } else {
        Fluttertoast.showToast(msg: e.message ?? 'Login failed');
      }
    } catch (e) {
      Fluttertoast.showToast(msg: 'Error: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _claimTeacherRoleIfRegistered() async {
    try {
      final fn = FirebaseFunctions.instanceFor(region: 'asia-southeast1').httpsCallable('claimTeacherRole');
      await fn.call();

      // Force-refresh so the new custom claim is available immediately.
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        await user.getIdToken(true);
      }
    } catch (_) {
      // Best-effort. If it fails, _ensureTeacherRoleOrSignOut will handle it.
    }
  }

  // ignore: unused_element
  Future<QueryDocumentSnapshot<Map<String, dynamic>>?> _getTeacherDocAfterAuth({
    required String rawPhone,
    required String phoneE164,
  }) async {
    // Runs after email/PIN sign-in (or any authenticated state). Provides a clear
    // error message if the account isn't registered as a teacher.
    QueryDocumentSnapshot<Map<String, dynamic>>? teacherDoc;

    final tail = _myPhoneTail(phoneE164.isNotEmpty ? phoneE164 : rawPhone);
    final local = _phoneLocalDigitsFromAny(phoneE164.isNotEmpty ? phoneE164 : rawPhone);

    try {
      if (tail.isNotEmpty) {
        final q = await _firestore.collection('teachers').where('phoneTail', isEqualTo: tail).limit(1).get();
        if (q.docs.isNotEmpty) teacherDoc = q.docs.first;
      }
      if (teacherDoc == null && local.isNotEmpty) {
        final q = await _firestore.collection('teachers').where('phone', isEqualTo: local).limit(1).get();
        if (q.docs.isNotEmpty) teacherDoc = q.docs.first;
      }

      if (teacherDoc != null) return teacherDoc;

      Fluttertoast.showToast(msg: 'Number not registered as teacher. Contact admin.');
      await FirebaseAuth.instance.signOut();
      return null;
    } catch (e) {
      Fluttertoast.showToast(msg: 'Failed to check registration: $e');
      await FirebaseAuth.instance.signOut();
      return null;
    }
  }

  Future<void> _verifyOtpAndLogin() async {
    final rawPhone = _phoneController.text.trim();
    final phoneE164 = _normalizePhoneToE164(rawPhone);
    if (phoneE164 == null) {
      Fluttertoast.showToast(msg: "Please enter a valid phone number (e.g. +6011...) ");
      return;
    }

    final otp = _otpController.text.trim();
    if (otp.length != 6 || !RegExp(r'^[0-9]{6}$').hasMatch(otp)) {
      Fluttertoast.showToast(msg: "OTP must be 6 digits");
      return;
    }

    if (_verificationId == null || !_codeSent) {
      Fluttertoast.showToast(msg: "Please send OTP first");
      return;
    }

    setState(() => _isLoading = true);
    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: _verificationId!,
        smsCode: otp,
      );
      TeacherOtpPinResetRequest.markPendingForPhone(phoneE164: phoneE164);
      await FirebaseAuth.instance.signInWithCredential(credential);
      Fluttertoast.showToast(msg: 'Signed in. Continue...');
    } on FirebaseAuthException catch (e) {
      TeacherOtpPinResetRequest.clear();
      Fluttertoast.showToast(msg: e.message ?? "Verification failed");
    } catch (e) {
      TeacherOtpPinResetRequest.clear();
      Fluttertoast.showToast(msg: "Error: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // ignore: unused_element
  Future<bool> _ensurePinIsSetAfterOtp({required String phoneE164}) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return false;

    final hasPasswordProvider = user.providerData.any((p) => p.providerId == 'password');
    final title = hasPasswordProvider ? 'Reset PIN' : 'Create PIN';
    final subtitle = hasPasswordProvider
        ? 'You logged in using OTP. Set a new PIN to login next time.'
        : 'PIN is mandatory. Create a PIN to login next time.';

    if (!mounted) return false;

    final pin1 = TextEditingController();
    final pin2 = TextEditingController();

    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(subtitle),
              const SizedBox(height: 12),
              TextField(
                controller: pin1,
                keyboardType: TextInputType.number,
                maxLength: 6,
                obscureText: true,
                decoration: const InputDecoration(counterText: '', labelText: 'PIN (4–6 digits)'),
              ),
              TextField(
                controller: pin2,
                keyboardType: TextInputType.number,
                maxLength: 6,
                obscureText: true,
                decoration: const InputDecoration(counterText: '', labelText: 'Confirm PIN'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Logout'),
            ),
            ElevatedButton(
              onPressed: () async {
                final a = pin1.text.trim();
                final b = pin2.text.trim();
                if (a.length < 4 || a.length > 6 || !RegExp(r'^[0-9]+$').hasMatch(a)) {
                  Fluttertoast.showToast(msg: 'PIN must be 4–6 digits');
                  return;
                }
                if (a != b) {
                  Fluttertoast.showToast(msg: 'PIN does not match');
                  return;
                }

                final email = _emailFromPhone(phoneE164);
                try {
                  if (!hasPasswordProvider) {
                    await user.linkWithCredential(EmailAuthProvider.credential(email: email, password: a));
                  } else {
                    await user.updatePassword(a);
                  }
                  if (!context.mounted) return;
                  Navigator.of(context).pop(true);
                } on FirebaseAuthException catch (e) {
                  if (!context.mounted) return;
                  if (e.code == 'email-already-in-use' || e.code == 'credential-already-in-use') {
                    Fluttertoast.showToast(msg: 'PIN already exists. Please login using PIN instead.');
                    return;
                  }
                  Fluttertoast.showToast(msg: e.message ?? 'Failed to create PIN');
                } catch (_) {
                  if (!context.mounted) return;
                  Fluttertoast.showToast(msg: 'Failed to create PIN');
                }
              },
              child: const Text('Save PIN'),
            ),
          ],
        );
      },
    );

    if (result == true) {
      Fluttertoast.showToast(msg: hasPasswordProvider ? 'PIN updated' : 'PIN created');
      return true;
    }

    await FirebaseAuth.instance.signOut();
    Fluttertoast.showToast(msg: 'PIN is required to continue');
    return false;
  }

  Future<void> _completeLoginAfterAuth({required String rawPhone, required String phoneE164}) async {
    QueryDocumentSnapshot<Map<String, dynamic>>? teacherDoc;

    // Prefer phone-tail lookup (handles +60 vs 0 formatting).
    final tail = _myPhoneTail(phoneE164.isNotEmpty ? phoneE164 : rawPhone);
    final local = _phoneLocalDigitsFromAny(phoneE164.isNotEmpty ? phoneE164 : rawPhone);
    if (tail.isNotEmpty) {
      final q = await _firestore.collection('teachers').where('phoneTail', isEqualTo: tail).limit(1).get();
      if (q.docs.isNotEmpty) teacherDoc = q.docs.first;
    }
    if (teacherDoc == null && local.isNotEmpty) {
      final q = await _firestore.collection('teachers').where('phone', isEqualTo: local).limit(1).get();
      if (q.docs.isNotEmpty) teacherDoc = q.docs.first;
    }

    if (teacherDoc == null) {
      Fluttertoast.showToast(msg: "Number not registered. Contact admin.");
      await FirebaseAuth.instance.signOut();
      return;
    }

    final data = teacherDoc.data();
    final teacherName = (data['name'] ?? 'Teacher').toString();
    final usernameKey = (data['username'] ?? teacherDoc.id).toString().trim().toLowerCase();
    final teacherDocId = teacherDoc.id;

    Fluttertoast.showToast(msg: "Welcome $teacherName!");
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => TeacherDashboard(
          username: usernameKey,
          name: teacherName,
          teacherDocId: teacherDocId,
        ),
      ),
    );
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

  // ignore: unused_element
  Future<void> _tryAutoLoginFlexible() async {
    final user = FirebaseAuth.instance.currentUser;
    final phone = user?.phoneNumber;
    if (phone != null && phone.isNotEmpty) {
      setState(() => _isLoading = true);
      try {
        final okRole = await _ensureTeacherRoleOrSignOut();
        if (!okRole) return;
        await _completeLoginAfterAuth(rawPhone: phone, phoneE164: phone);
      } finally {
        if (mounted) setState(() => _isLoading = false);
      }
      return;
    }

    final derivedPhone = _phoneFromEmail(user?.email);
    if (derivedPhone == null) {
      final email = user?.email?.trim();
      // Phone/docId-only: if we can't derive a phone from email and there's no phoneNumber,
      // we can't map this account to a teacher document.
      if (email == null || email.isEmpty) return;
      return;
    }

    setState(() => _isLoading = true);
    try {
      final okRole = await _ensureTeacherRoleOrSignOut();
      if (!okRole) return;
      await _completeLoginAfterAuth(rawPhone: derivedPhone, phoneE164: derivedPhone);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.school, size: 100, color: Color(0xFF2E7D32)),
              const SizedBox(height: 20),
              const Text(
                "Taska Zurah Teacher",
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF2E7D32),
                ),
              ),
              const SizedBox(height: 40),
              TextField(
                controller: _phoneController,
                decoration: InputDecoration(
                  labelText: 'Phone Number',
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                    borderSide: BorderSide.none,
                  ),
                ),
                keyboardType: TextInputType.phone,
                textInputAction: TextInputAction.done,
                onEditingComplete: () {
                  FocusScope.of(context).unfocus();
                  _syncLoginModeForPhone();
                },
                onSubmitted: (_) => _syncLoginModeForPhone(),
              ),
              const SizedBox(height: 15),
              if (_otpMode) ...[
                if (_codeSent)
                  TextField(
                    controller: _otpController,
                    decoration: InputDecoration(
                      labelText: 'OTP (6 digits)',
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(15),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                  )
                else
                  const SizedBox.shrink(),
              ] else ...[
                TextField(
                  controller: _pinController,
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: 'PIN (4–6 digits)',
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(15),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                ),
              ],
              const SizedBox(height: 25),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2E7D32),
                    padding: const EdgeInsets.symmetric(vertical: 15),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                    onPressed: _isLoading
                      ? null
                      : (_otpMode
                        ? (_codeSent ? _verifyOtpAndLogin : _sendOtp)
                        : _loginWithPin),
                  child: _isLoading
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(color: Colors.white),
                        )
                      : Text(
                          _otpMode ? (_codeSent ? 'Verify & Login' : 'Send OTP') : 'Login',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: _isLoading
                    ? null
                    : () {
                        setState(() {
                          _otpMode = !_otpMode;
                          _codeSent = false;
                          _verificationId = null;
                        });
                      },
                child: Text(
                  _otpMode ? 'Use PIN login' : 'Forgot PIN? Use OTP',
                  style: const TextStyle(color: Color(0xFF2E7D32)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
