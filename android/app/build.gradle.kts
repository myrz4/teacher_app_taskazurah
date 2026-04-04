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
        versionCode = 4
        versionName = "1.1.2"
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

// Keep Flutter tooling happy: copy APKs to the standard Flutter output folder
// (../build/app/outputs/flutter-apk) without renaming.
val flutterApkOutDir = rootProject.projectDir.parentFile
    .resolve("build/app/outputs/flutter-apk")

val copyFlutterApks by tasks.registering(Copy::class) {
    val fromDir = layout.buildDirectory.dir("outputs/flutter-apk")
    from(fromDir)
    include("*.apk")
    into(flutterApkOutDir)
}

tasks.matching { it.name.startsWith("assemble") }.configureEach {
    finalizedBy(copyFlutterApks)
}
