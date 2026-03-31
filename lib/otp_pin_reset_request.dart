class TeacherOtpPinResetRequest {
  static String? _pendingPhoneE164;
  static int? _pendingAtMs;

  static const int _ttlMs = 2 * 60 * 1000; // 2 minutes

  /// Call this immediately BEFORE starting OTP sign-in.
  static void markPendingForPhone({required String phoneE164}) {
    _pendingPhoneE164 = phoneE164;
    _pendingAtMs = DateTime.now().millisecondsSinceEpoch;
  }

  static void clear() {
    _pendingPhoneE164 = null;
    _pendingAtMs = null;
  }

  /// Returns true once (and clears) if the pending phone matches and is fresh.
  static bool consumeIfMatchesPhone({required String phoneE164}) {
    final p = _pendingPhoneE164;
    final t = _pendingAtMs;
    clear();

    if (p == null || t == null) return false;
    if (p != phoneE164) return false;

    final age = DateTime.now().millisecondsSinceEpoch - t;
    if (age < 0 || age > _ttlMs) return false;

    return true;
  }
}
