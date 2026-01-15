// 🌿 Taska Zuhrah Teacher App — Kotlin DSL build.gradle.kts
// ✅ Works with Gradle 8.6 +, Kotlin 2.1 +, Java 17
// ✅ Firestore REST API + Firebase Storage SDK
// ✅ Multidex + Desugaring enabled

import org.jetbrains.kotlin.gradle.dsl.*

buildscript {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.6.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }

    // 🔹 Global Java 17
    tasks.withType<JavaCompile>().configureEach {
        sourceCompatibility = JavaVersion.VERSION_17.toString()
        targetCompatibility = JavaVersion.VERSION_17.toString()
    }

    // 🔹 Global Kotlin JVM 17
    tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
        kotlinOptions.jvmTarget = "17"
    }

    // 🔹 Kotlin toolchain 17
    plugins.withType<org.jetbrains.kotlin.gradle.plugin.KotlinBasePluginWrapper>().configureEach {
        project.extensions.findByName("kotlin")?.let { ext ->
            when (ext) {
                is KotlinJvmProjectExtension -> ext.jvmToolchain(17)
                is KotlinAndroidProjectExtension -> ext.jvmToolchain(17)
            }
        }
    }
}

subprojects {
    afterEvaluate {
        extensions.findByName("android")?.let { androidExt ->
            (androidExt as? com.android.build.gradle.BaseExtension)?.apply {
                compileOptions {
                    sourceCompatibility = JavaVersion.VERSION_17
                    targetCompatibility = JavaVersion.VERSION_17
                    isCoreLibraryDesugaringEnabled = true
                }
                defaultConfig {
                    multiDexEnabled = true
                }
            }
        }

        dependencies {
            add("implementation", "androidx.multidex:multidex:2.0.1")
            add("coreLibraryDesugaring", "com.android.tools:desugar_jdk_libs:2.0.4")
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.buildDir)
}
