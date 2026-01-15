// 🌱 File: lib/login_screen.dart
//
// ✅ Taska Zurah Teacher Login (Firestore SDK Version)
// ✅ Uses Firebase Firestore SDK for authentication lookup
// ✅ Maintains original UI and logic

import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'teacher_dashboard.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isLoading = false;

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  Future<void> _login() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text.trim();

    if (username.isEmpty || password.isEmpty) {
      Fluttertoast.showToast(msg: "Please enter username and password.");
      return;
    }

    setState(() => _isLoading = true);

    try {
      // 🔍 Query Firestore teachers collection
      final query = await _firestore
          .collection('teachers')
          .where('username', isEqualTo: username)
          .limit(1)
          .get();

      if (query.docs.isEmpty) {
        Fluttertoast.showToast(msg: "User not found in Firestore.");
        setState(() => _isLoading = false);
        return;
      }

      final teacher = query.docs.first.data();
      final storedPassword = teacher['password_hash'] ?? '';
      final teacherName = teacher['name'] ?? 'Teacher';
      final firestoreUsername = teacher['username'] ?? username;

      if (storedPassword == password) {
        Fluttertoast.showToast(msg: "Welcome $teacherName!");
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => TeacherDashboard(
              username: firestoreUsername,
              name: teacherName,
            ),
          ),
        );
      } else {
        Fluttertoast.showToast(msg: "Incorrect password.");
      }
    } catch (e, st) {
      debugPrint("🔥 Login failed: $e\n$st");
      Fluttertoast.showToast(msg: "Error logging in: $e");
    } finally {
      setState(() => _isLoading = false);
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
                controller: _usernameController,
                decoration: InputDecoration(
                  labelText: 'Username',
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
              const SizedBox(height: 15),
              TextField(
                controller: _passwordController,
                obscureText: true,
                decoration: InputDecoration(
                  labelText: 'Password',
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
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
                  onPressed: _isLoading ? null : _login,
                  child: _isLoading
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(color: Colors.white),
                        )
                      : const Text(
                          "Login",
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 18,
                          ),
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
