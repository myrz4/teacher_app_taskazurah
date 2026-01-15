// 🌱 File: lib/main.dart
//
// ✅ Entry point for Taska Zurah Teacher App (Firestore SDK + Notification Ready)
// ✅ Initializes Firebase SDK, Messaging, and Local Notifications
// ✅ Supports background + foreground chat notifications
// ✅ Starts at LoginScreen

import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'firebase_options.dart';
import 'login_screen.dart';

// 🟢 Background message handler (runs even when app is terminated)
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  print('📨 Background message received: ${message.notification?.title}');
}

// 🟢 Initialize local notification plugin
final FlutterLocalNotificationsPlugin _localNotifications =
    FlutterLocalNotificationsPlugin();

// 🔔 Create Android Notification Channel
Future<void> _initializeNotificationChannel() async {
  const AndroidNotificationChannel channel = AndroidNotificationChannel(
    'chat_channel', // same as in AndroidManifest.xml
    'Chat Notifications',
    description: 'This channel is used for chat message notifications.',
    importance: Importance.high,
  );

  final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
      FlutterLocalNotificationsPlugin();

  await flutterLocalNotificationsPlugin
      .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(channel);
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // ✅ Initialize Firebase
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // ✅ Register background message handler
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  // ✅ Initialize local notifications
  await _initializeNotificationChannel();

  // ✅ Request user permission for notifications
  final messaging = FirebaseMessaging.instance;
  NotificationSettings settings = await messaging.requestPermission(
    alert: true,
    badge: true,
    sound: true,
  );

  print('🔔 Notification permission: ${settings.authorizationStatus}');

  // ✅ Get and log FCM token
  final token = await messaging.getToken();
  print('📱 FCM Token: $token');

  // ✅ Foreground message listener
  FirebaseMessaging.onMessage.listen((RemoteMessage message) {
    print('💬 Foreground message received: ${message.notification?.title}');

    final notification = message.notification;
    final android = message.notification?.android;

    if (notification != null && android != null) {
      _localNotifications.show(
        notification.hashCode,
        notification.title ?? 'New Message',
        notification.body ?? '',
        const NotificationDetails(
          android: AndroidNotificationDetails(
            'chat_channel',
            'Chat Notifications',
            importance: Importance.high,
            priority: Priority.high,
            icon: '@mipmap/ic_launcher',
          ),
        ),
      );
    }
  });

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Taska Zurah Teacher',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFA8E6A3),
          primary: const Color(0xFF2E7D32),
        ),
        scaffoldBackgroundColor: Colors.white,
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF2E7D32),
          foregroundColor: Colors.white,
          elevation: 2,
        ),
      ),
      home: const LoginScreen(),
    );
  }
}
