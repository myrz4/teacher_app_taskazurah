// 🌿 Taska Zuhrah Teacher App — Settings Gradle KTS (Final Fix for Gradle 8.6+)

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }

    val flutterSdkPath = run {
        val props = java.util.Properties()
        file("local.properties").inputStream().use { props.load(it) }
        props.getProperty("flutter.sdk")
            ?: throw GradleException("flutter.sdk not set in local.properties")
    }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")
}

// ✅ CRITICAL FIX — disable isolation (so Flutter subprojects can see repos)
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
        // Sometimes needed for Flutter artifacts
        maven { url = uri("https://storage.googleapis.com/download.flutter.io") }
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "8.6.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}

rootProject.name = "teacher_app_taskahzuhrah"
include(":app")
