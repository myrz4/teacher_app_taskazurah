// ===============================================================
// 🌱 Taska Zuhrah Teacher App — Firestore REST API Version
// ✅ Lightweight build without Firebase Firestore SDK
// ✅ Keeps Firebase Storage for image uploads
// ✅ Compatible with Flutter 3.24+, AGP 8.5+, Kotlin 1.9+, SDK 36
// ===============================================================

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("dev.flutter.flutter-gradle-plugin")
    // ❌ Removed: com.google.gms.google-services (not needed for REST)
}

android {
    namespace = "com.example.teacher_app_taskahzuhrah"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.example.teacher_app_taskahzuhrah"
        minSdk = flutter.minSdkVersion
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        multiDexEnabled = true
    }

    compileOptions {
        // ✅ Java 17 support
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("debug")
        }
        getByName("debug") {
            isMinifyEnabled = false
        }
    }

    packaging {
        resources.excludes.add("META-INF/*")
    }
}

flutter {
    source = "../.."
}

dependencies {
    // ✅ Kotlin + Multidex + Desugar
    implementation("org.jetbrains.kotlin:kotlin-stdlib-jdk8")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
    implementation("androidx.multidex:multidex:2.0.1")

    // ✅ Keep only Firebase Storage (image uploads)
    implementation(platform("com.google.firebase:firebase-bom:33.3.0"))
    implementation("com.google.firebase:firebase-storage")

    // ❌ Removed Firestore, Auth, Analytics SDKs — handled via REST API now
}

// ✅ Auto-copy & rename built APK for convenience
afterEvaluate {
    tasks.matching { it.name.startsWith("assemble") }.configureEach {
        doLast {
            val apkSource = file("${buildDir}/outputs/apk")
            val flutterTarget = file("${rootProject.projectDir}/../build/app/outputs/flutter-apk")
            if (!flutterTarget.exists()) flutterTarget.mkdirs()

            val variant = name.replace("assemble", "").lowercase()
            val apkName = if (variant.contains("release")) "app-release.apk" else "app-debug.apk"

            val apkFiles = apkSource.walkTopDown().filter { it.extension == "apk" }.toList()

            if (apkFiles.isNotEmpty()) {
                val builtApk = apkFiles.first()
                copy {
                    from(builtApk)
                    into(flutterTarget)
                    rename { apkName }
                }
                println("✅ APK renamed to: ${flutterTarget.absolutePath}\\$apkName")
            } else {
                println("⚠️ No .apk file found in ${apkSource.absolutePath}")
            }
        }
    }
}
