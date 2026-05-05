import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TeacherThemeController extends ChangeNotifier {
  TeacherThemeController._();

  static final TeacherThemeController instance =
      TeacherThemeController._();

  static const String _storageKey = 'teacher_theme_mode';

  SharedPreferences? _prefs;
  ThemeMode _themeMode = ThemeMode.light;
  bool _hasLoaded = false;

  ThemeMode get themeMode => _themeMode;
  bool get isDarkModeEnabled => _themeMode == ThemeMode.dark;

  Future<void> load() async {
    if (_hasLoaded) {
      return;
    }

    _prefs ??= await SharedPreferences.getInstance();
    final storedMode = _prefs!.getString(_storageKey);
    _themeMode = storedMode == 'dark' ? ThemeMode.dark : ThemeMode.light;
    _hasLoaded = true;
    notifyListeners();
  }

  Future<void> setDarkMode(bool enabled) async {
    final nextMode = enabled ? ThemeMode.dark : ThemeMode.light;
    if (_themeMode == nextMode) {
      return;
    }

    final previousMode = _themeMode;
    _themeMode = nextMode;
    notifyListeners();

    try {
      _prefs ??= await SharedPreferences.getInstance();
      await _prefs!.setString(_storageKey, enabled ? 'dark' : 'light');
    } catch (_) {
      _themeMode = previousMode;
      notifyListeners();
      rethrow;
    }
  }
}