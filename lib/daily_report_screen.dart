// 🌿 File: daily_report_screen.dart
//
// ✅ Teachers can view and upload digital memory journeys
// ✅ "+" opens Add Memory screen with all children (not just linked ones)
// ✅ Dropdown shows child's name and their assigned teacher
// ✅ Data structure fully compatible with 'memory' Firestore collection

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

class DailyReportScreen extends StatefulWidget {
  final String teacherName;
  final String teacherUsername;
  final String teacherClass;

  const DailyReportScreen({
    super.key,
    required this.teacherName,
    required this.teacherUsername,
    required this.teacherClass,
  });

  @override
  State<DailyReportScreen> createState() => _DailyReportScreenState();
}

class _DailyReportScreenState extends State<DailyReportScreen> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  String _filterCategory = "All";

  /// 🔹 Category filter chips
  Widget _buildCategoryChips() {
    final categories = ["All", "Learning", "Play", "Art", "Meal", "Nap"];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      child: Row(
        children: categories.map((cat) {
          final selected = _filterCategory == cat;
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: ChoiceChip(
              label: Text(cat),
              selected: selected,
              selectedColor: const Color(0xFF81C784),
              onSelected: (_) => setState(() => _filterCategory = cat),
            ),
          );
        }).toList(),
      ),
    );
  }

  /// 🔹 Memory card display
  Widget _buildMemoryCard(Map<String, dynamic> data) {
    final time =
        DateFormat('hh:mm a').format((data['timestamp'] as Timestamp).toDate());
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (data['photo_url'] != null)
            ClipRRect(
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(15)),
              child: Image.network(
                data['photo_url'],
                width: double.infinity,
                height: 220,
                fit: BoxFit.cover,
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(data['description'] ?? '',
                    style: const TextStyle(fontSize: 16)),
                const SizedBox(height: 5),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      "${data['teacher_name']} • ${data['category'] ?? 'General'}",
                      style: const TextStyle(color: Colors.grey, fontSize: 12),
                    ),
                    Text(time,
                        style:
                            const TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        title: const Text("Digital Memory Journey"),
      ),
      body: Column(
        children: [
          _buildCategoryChips(),
          Expanded(
            child: StreamBuilder<QuerySnapshot>(
              stream: _firestore
                  .collection('memory')
                  .orderBy('timestamp', descending: true)
                  .snapshots(),
              builder: (context, snapshot) {
                if (!snapshot.hasData) {
                  return const Center(
                      child: CircularProgressIndicator(color: Colors.green));
                }

                final docs = snapshot.data!.docs.where((doc) {
                  if (_filterCategory == "All") return true;
                  return (doc['category'] ?? '') == _filterCategory;
                }).toList();

                if (docs.isEmpty) {
                  return const Center(child: Text("No memories yet."));
                }

                return ListView.builder(
                  itemCount: docs.length,
                  itemBuilder: (context, index) {
                    final data = docs[index].data() as Map<String, dynamic>;
                    return _buildMemoryCard(data);
                  },
                );
              },
            ),
          ),
        ],
      ),

      // ➕ Floating button opens Add Memory Page
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF2E7D32),
        child: const Icon(Icons.add, color: Colors.white),
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => AddMemoryPage(
                teacherName: widget.teacherName,
                teacherUsername: widget.teacherUsername,
                teacherClass: widget.teacherClass,
              ),
            ),
          );
        },
      ),
    );
  }
}

//
// 🟢 Full Add Memory Page
//
class AddMemoryPage extends StatefulWidget {
  final String teacherName;
  final String teacherUsername;
  final String teacherClass;

  const AddMemoryPage({
    super.key,
    required this.teacherName,
    required this.teacherUsername,
    required this.teacherClass,
  });

  @override
  State<AddMemoryPage> createState() => _AddMemoryPageState();
}

class _AddMemoryPageState extends State<AddMemoryPage> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseStorage _storage = FirebaseStorage.instance;
  final ImagePicker _picker = ImagePicker();

  File? _selectedImage;
  bool _isUploading = false;
  String _selectedCategory = "Learning";
  String? _selectedChild;
  List<Map<String, String>> _childList = [];
  final TextEditingController _descController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadChildren();
  }

  /// 🔹 Load all children (regardless of teacher)
  Future<void> _loadChildren() async {
    try {
      final snapshot = await _firestore.collection('children').get();

      final children = snapshot.docs.map((doc) {
        final data = doc.data();
        final name = data['name']?.toString() ?? 'Unnamed';
        final teacher = data['teacher_username']?.toString() ?? 'Unassigned';
        return {
          'name': name,
          'teacher': teacher,
        };
      }).toList();

      setState(() => _childList = children);
    } catch (e) {
      Fluttertoast.showToast(msg: "Failed to load children: $e");
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    final picked = await _picker.pickImage(source: source, imageQuality: 80);
    if (picked != null) setState(() => _selectedImage = File(picked.path));
  }

  /// 🔹 Upload new memory
  Future<void> _uploadMemory() async {
    if (_selectedChild == null) {
      Fluttertoast.showToast(msg: "Please select a child.");
      return;
    }
    if (_selectedImage == null || _descController.text.trim().isEmpty) {
      Fluttertoast.showToast(msg: "Please select an image and add a note.");
      return;
    }

    setState(() => _isUploading = true);
    try {
      final now = DateTime.now();
      final fileName =
          "${widget.teacherUsername}_${now.millisecondsSinceEpoch}.jpg";

      // Upload image to Firebase Storage
      final ref = _storage.ref().child('memory_photos').child(fileName);
      await ref.putFile(_selectedImage!);
      final downloadUrl = await ref.getDownloadURL();

      // Fetch selected child info
      final childSnapshot = await _firestore
          .collection('children')
          .where('name', isEqualTo: _selectedChild)
          .limit(1)
          .get();

      if (childSnapshot.docs.isEmpty) {
        Fluttertoast.showToast(msg: "Child not found in Firestore.");
        setState(() => _isUploading = false);
        return;
      }

      final childDoc = childSnapshot.docs.first;
      final childId = childDoc.id;
      final childData = childDoc.data() as Map<String, dynamic>;

      // Build teacher reference dynamically
      final teacherRef = '/teachers/${widget.teacherUsername}';

      // ✅ Save structured memory document
      await _firestore.collection('memory').add({
        'category': _selectedCategory,
        'description': _descController.text.trim(),
        'timestamp': now,
        'photo_url': downloadUrl,
        'child_id': childId,
        'child_name': _selectedChild,
        'child_ref': 'children/$childId',
        'parent_name': childData['parentName'] ?? '',
        'parent_contact': childData['parentContact'] ?? '',
        'teacher_name': widget.teacherName,
        'teacher_username': widget.teacherUsername,
        'teacher_ref': teacherRef,
        'date_str': DateFormat('d MMM yyyy, hh:mm a').format(now),
      });

      Fluttertoast.showToast(msg: "✅ Memory uploaded successfully!");
      Navigator.pop(context);
    } catch (e) {
      Fluttertoast.showToast(msg: "Upload failed: $e");
    } finally {
      setState(() => _isUploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FFF8),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2E7D32),
        foregroundColor: Colors.white,
        title: const Text("Add New Memory"),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 🔹 Select Child Dropdown
            DropdownButtonFormField<String>(
              value: _selectedChild,
              decoration: const InputDecoration(labelText: "Select Child"),
              items: _childList
                  .map((child) => DropdownMenuItem(
                        value: child['name'],
                        child: Text(
                            "${child['name']} (${child['teacher'] ?? 'Unassigned'})"),
                      ))
                  .toList(),
              onChanged: (val) => setState(() => _selectedChild = val),
            ),
            const SizedBox(height: 15),

            // 🔹 Category Dropdown
            DropdownButtonFormField<String>(
              value: _selectedCategory,
              decoration: const InputDecoration(labelText: "Category"),
              items: const ["Learning", "Play", "Art", "Meal", "Nap", "General"]
                  .map((cat) => DropdownMenuItem(value: cat, child: Text(cat)))
                  .toList(),
              onChanged: (val) => setState(() => _selectedCategory = val!),
            ),
            const SizedBox(height: 15),

            // 🔹 Description
            TextField(
              controller: _descController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: "Description / Note",
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),

            // 🔹 Image preview
            Center(
              child: _selectedImage != null
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.file(
                        _selectedImage!,
                        height: 200,
                        fit: BoxFit.cover,
                      ),
                    )
                  : const Text(
                      "No image selected",
                      style: TextStyle(color: Colors.grey),
                    ),
            ),
            const SizedBox(height: 20),

            // 🔹 Buttons
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green.shade700,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    icon: const Icon(Icons.camera_alt, color: Colors.white),
                    label: const Text("Take a Photo",
                        style: TextStyle(color: Colors.white)),
                    onPressed: () => _pickImage(ImageSource.camera),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green.shade700,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    icon: const Icon(Icons.photo, color: Colors.white),
                    label: const Text("Select Photo",
                        style: TextStyle(color: Colors.white)),
                    onPressed: () => _pickImage(ImageSource.gallery),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 25),

            // 🔹 Upload button
            Center(
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.teal.shade700,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 40, vertical: 14),
                ),
                icon: _isUploading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.cloud_upload, color: Colors.white),
                label: Text(
                  _isUploading ? "Uploading..." : "Upload Memory",
                  style: const TextStyle(color: Colors.white, fontSize: 16),
                ),
                onPressed: _isUploading ? null : _uploadMemory,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
