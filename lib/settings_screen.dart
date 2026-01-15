import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _darkMode = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Settings"),
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
      ),
      backgroundColor: const Color(0xFFF8FFF8),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          SwitchListTile(
            value: _darkMode,
            title: const Text("Dark Mode"),
            activeColor: Colors.green,
            onChanged: (val) {
              setState(() => _darkMode = val);
              Fluttertoast.showToast(
                msg: val ? "Dark Mode Enabled" : "Dark Mode Disabled",
              );
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.info_outline, color: Colors.teal),
            title: const Text("App Version"),
            subtitle: const Text("v1.0.0"),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.feedback_outlined, color: Colors.orange),
            title: const Text("Send Feedback"),
            onTap: () =>
                Fluttertoast.showToast(msg: "Feedback form coming soon!"),
          ),
        ],
      ),
    );
  }
}
