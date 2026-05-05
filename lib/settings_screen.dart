import 'package:flutter/material.dart';

import 'services/teacher_theme_controller.dart';
import 'set_login_pin_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  Future<void> _updateDarkMode(bool enabled) async {
    try {
      await TeacherThemeController.instance.setDarkMode(enabled);
    } catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to save appearance preference.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: AnimatedBuilder(
        animation: TeacherThemeController.instance,
        builder: (context, _) {
          final isDarkMode = TeacherThemeController.instance.isDarkModeEnabled;

          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                'Security',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  leading: Icon(Icons.lock_outline, color: colorScheme.primary),
                  title: const Text('Change PIN'),
                  subtitle: const Text('PIN is required for future logins'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const SetLoginPinScreen(),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Appearance',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: SwitchListTile.adaptive(
                  value: isDarkMode,
                  title: const Text('Dark Mode'),
                  subtitle: Text(
                    isDarkMode
                        ? 'Enabled across the app and saved on this device'
                        : 'Use the lighter classroom-friendly theme',
                  ),
                  activeThumbColor: colorScheme.primary,
                  onChanged: _updateDarkMode,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'About',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Column(
                  children: [
                    ListTile(
                      leading: Icon(Icons.info_outline, color: colorScheme.primary),
                      title: const Text('App Version'),
                      subtitle: const Text('v1.1.2+4'),
                    ),
                    Divider(height: 1, color: theme.dividerColor),
                    const ListTile(
                      leading: Icon(Icons.support_agent_outlined),
                      title: Text('Support'),
                      subtitle: Text('Contact the admin team for account or device issues'),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
