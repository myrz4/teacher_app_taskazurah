// File: lib/firebase_options.dart
// Manually generated for project "taskazurah"

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for iOS.',
        );
      case TargetPlatform.macOS:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for macOS.',
        );
      case TargetPlatform.windows:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for Windows.',
        );
      case TargetPlatform.linux:
        throw UnsupportedError(
          'DefaultFirebaseOptions have not been configured for Linux.',
        );
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBiUqTwMUfk-rpgp3I6GZZ-AZ6viNjaZq0',
    appId: '1:50258061076:web:24e9e86b7e3bb441648401',
    messagingSenderId: '50258061076',
    projectId: 'taskazurah',
    storageBucket: 'taskazurah.firebasestorage.app',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyD84FOaSO-9UDDOpN452qIgROtMpaoz6SI',
    appId: '1:50258061076:android:99bf7d3fc09f0d2f648401',
    messagingSenderId: '50258061076',
    projectId: 'taskazurah',
    storageBucket: 'taskazurah.firebasestorage.app',
  );
}
