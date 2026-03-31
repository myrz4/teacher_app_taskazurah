import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

import 'login_screen.dart';
import 'teacher_dashboard.dart';
import 'otp_pin_reset_request.dart';

class TeacherAuthGate extends StatelessWidget {
  const TeacherAuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const _GateLoadingScaffold();
        }

        final user = snapshot.data;
        if (user == null) return const LoginScreen();

        return _TeacherBootstrapper(user: user);
      },
    );
  }
}

class _GateLoadingScaffold extends StatelessWidget {
  const _GateLoadingScaffold();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: SizedBox(
          height: 28,
          width: 28,
          child: CircularProgressIndicator(strokeWidth: 2.5),
        ),
      ),
    );
  }
}

class _TeacherBootstrapper extends StatefulWidget {
  const _TeacherBootstrapper({required this.user});

  final User user;

  @override
  State<_TeacherBootstrapper> createState() => _TeacherBootstrapperState();
}

class _TeacherBootstrapperState extends State<_TeacherBootstrapper> {
  final _firestore = FirebaseFirestore.instance;

  bool _started = false;
  String? _teacherName;
  String? _usernameKey;
  String? _teacherDocId;
  String? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;

    // Avoid triggering navigation during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _bootstrap();
    });
  }

  Future<void> _bootstrap() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    try {
      final phone = user.phoneNumber;
      if (phone != null && phone.isNotEmpty) {
        final shouldForceReset = TeacherOtpPinResetRequest.consumeIfMatchesPhone(phoneE164: phone);
        if (shouldForceReset) {
          final ok = await _forceResetPinForOtpSession(phoneE164: phone);
          if (!ok) return;

          // Let the dialog route fully dispose before we navigate.
          await Future<void>.delayed(Duration.zero);
        }
      }

      // Best-effort: claim (or revoke) the teacher role based on registration.
      await _claimTeacherRoleIfRegistered();

      final okRole = await _ensureTeacherRoleOrSignOut(user);
      if (!okRole) return;

      final teacherDoc = await _lookupTeacherDoc(user);
      if (teacherDoc == null) {
        Fluttertoast.showToast(msg: 'Account not registered as teacher. Contact admin.');
        await FirebaseAuth.instance.signOut();
        return;
      }

      final data = teacherDoc.data();
      final teacherName = (data['name'] ?? 'Teacher').toString();
      final usernameKey = (data['username'] ?? teacherDoc.id).toString().trim().toLowerCase();
      final teacherDocId = teacherDoc.id;

      if (!mounted) return;
      setState(() {
        _teacherName = teacherName;
        _usernameKey = usernameKey;
        _teacherDocId = teacherDocId;
        _error = null;
      });
    } catch (e) {
      debugPrint('Teacher bootstrap failed: $e');
      Fluttertoast.showToast(msg: 'Failed to auto-login. Please login again.');
      await FirebaseAuth.instance.signOut();
      if (!mounted) return;
      setState(() {
        _teacherName = null;
        _usernameKey = null;
        _error = 'Failed to auto-login. Please login again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return const _GateLoadingScaffold();
    }
    if (_usernameKey == null || _teacherName == null) {
      return const _GateLoadingScaffold();
    }
    return TeacherDashboard(
      username: _usernameKey!,
      name: _teacherName!,
      teacherDocId: _teacherDocId ?? _usernameKey!,
    );
  }

  Future<bool> _forceResetPinForOtpSession({required String phoneE164}) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return false;

    final gateContext = context;

    final hasPasswordProvider = user.providerData.any((p) => p.providerId == 'password');
    final title = hasPasswordProvider ? 'Reset PIN' : 'Create PIN';
    final subtitle = hasPasswordProvider
        ? 'You logged in using OTP. Set a new PIN to login next time.'
        : 'PIN is mandatory. Create a PIN to login next time.';

    final pin1 = TextEditingController();
    final pin2 = TextEditingController();

    final result = await showDialog<_PinDialogResult>(
      context: gateContext,
      barrierDismissible: false,
      builder: (dialogContext) {
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
                decoration: const InputDecoration(counterText: '', labelText: 'PIN (6 digits)'),
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
              onPressed: () => Navigator.of(dialogContext).pop(_PinDialogResult.logout),
              child: const Text('Logout'),
            ),
            ElevatedButton(
              onPressed: () async {
                final a = pin1.text.trim();
                final b = pin2.text.trim();

                if (a.length != 6 || !RegExp(r'^[0-9]{6}$').hasMatch(a)) {
                  Fluttertoast.showToast(msg: 'PIN must be exactly 6 digits');
                  return;
                }
                if (a != b) {
                  Fluttertoast.showToast(msg: 'PIN does not match');
                  return;
                }

                try {
                  final email = _derivedTeacherEmailFromPhone(phoneE164);

                  if (!hasPasswordProvider) {
                    await user.linkWithCredential(
                      EmailAuthProvider.credential(email: email, password: a),
                    );
                  } else {
                    await user.updatePassword(a);
                  }

                  if (!dialogContext.mounted) return;
                  Navigator.of(dialogContext).pop(_PinDialogResult.saved);
                } on FirebaseAuthException catch (e) {
                  if (e.code == 'email-already-in-use' || e.code == 'credential-already-in-use') {
                    if (!dialogContext.mounted) return;
                    Navigator.of(dialogContext).pop(_PinDialogResult.mustUsePinLogin);
                    return;
                  }
                  Fluttertoast.showToast(msg: e.message ?? 'Failed to save PIN');
                } catch (_) {
                  Fluttertoast.showToast(msg: 'Failed to save PIN');
                }
              },
              child: const Text('Save PIN'),
            ),
          ],
        );
      },
    );

    pin1.dispose();
    pin2.dispose();

    switch (result) {
      case _PinDialogResult.saved:
        return true;
      case _PinDialogResult.mustUsePinLogin:
        Fluttertoast.showToast(msg: 'PIN already exists for this number. Please login using PIN.');
        await FirebaseAuth.instance.signOut();
        return false;
      case _PinDialogResult.logout:
      default:
        await FirebaseAuth.instance.signOut();
        return false;
    }
  }

  String _derivedTeacherEmailFromPhone(String phoneE164) {
    final local = _phoneLocalDigitsFromAny(phoneE164);
    return 't_$local@taskazurah.local';
  }

  Future<void> _claimTeacherRoleIfRegistered() async {
    try {
      final fn = FirebaseFunctions.instanceFor(region: 'asia-southeast1').httpsCallable('claimTeacherRole');
      await fn.call();

      // Force-refresh so the updated custom claim is available immediately.
      final user = FirebaseAuth.instance.currentUser;
      if (user != null) {
        await user.getIdToken(true);
      }
    } catch (_) {
      // Best-effort. If it fails, role check will handle it.
    }
  }

  Future<bool> _ensureTeacherRoleOrSignOut(User user) async {
    try {
      Future<String?> readRoleOnce() async {
        final r = await user.getIdTokenResult(true);
        final v = r.claims?['role'];
        return v == null ? null : v.toString();
      }

      var role = await readRoleOnce();
      if (role == 'teacher' || role == 'admin') return true;

      await Future.delayed(const Duration(seconds: 2));
      await user.reload();
      role = await readRoleOnce();
      if (role == 'teacher' || role == 'admin') return true;

      await _claimTeacherRoleIfRegistered();
      role = await readRoleOnce();
      if (role == 'teacher' || role == 'admin') return true;

      Fluttertoast.showToast(msg: 'Not authorized. Please contact admin.');
      await FirebaseAuth.instance.signOut();
      return false;
    } catch (e) {
      Fluttertoast.showToast(msg: 'Failed to verify access. Please login again.');
      await FirebaseAuth.instance.signOut();
      return false;
    }
  }

  String _digitsOnly(String input) => input.replaceAll(RegExp(r'[^0-9]'), '');

  String _myPhoneTail(String phoneAny) {
    var d = _digitsOnly(phoneAny);
    if (d.isEmpty) return '';
    if (d.startsWith('60') && d.length > 2) d = d.substring(2);
    if (d.startsWith('0') && d.length > 1) d = d.substring(1);
    return d;
  }

  String _phoneLocalDigitsFromAny(String phone) {
    final digits = _digitsOnly(phone);
    if (digits.isEmpty) return '';
    if (digits.startsWith('60') && digits.length > 2) return '0${digits.substring(2)}';
    if (digits.startsWith('0')) return digits;
    if (digits.startsWith('1')) return '0$digits';
    return digits;
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

  Future<QueryDocumentSnapshot<Map<String, dynamic>>?> _lookupTeacherDoc(User user) async {
    final phone = user.phoneNumber;
    if (phone != null && phone.isNotEmpty) {
      final doc = await _lookupTeacherDocByPhone(phoneAny: phone);
      if (doc != null) return doc;
    }

    final derivedPhone = _phoneFromEmail(user.email);
    if (derivedPhone != null) {
      final doc = await _lookupTeacherDocByPhone(phoneAny: derivedPhone);
      if (doc != null) return doc;
    }
    return null;
  }

  Future<QueryDocumentSnapshot<Map<String, dynamic>>?> _lookupTeacherDocByPhone({required String phoneAny}) async {
    final tail = _myPhoneTail(phoneAny);
    final local = _phoneLocalDigitsFromAny(phoneAny);

    if (tail.isNotEmpty) {
      final q = await _firestore.collection('teachers').where('phoneTail', isEqualTo: tail).limit(1).get();
      if (q.docs.isNotEmpty) return q.docs.first;
    }

    if (local.isNotEmpty) {
      final q = await _firestore.collection('teachers').where('phone', isEqualTo: local).limit(1).get();
      if (q.docs.isNotEmpty) return q.docs.first;
    }

    return null;
  }

}

enum _PinDialogResult {
  saved,
  logout,
  mustUsePinLogin,
}
