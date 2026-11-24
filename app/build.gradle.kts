plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// Push notifications: active only when app/google-services.json (from Firebase) is present.
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")
android {
    namespace = "com.yagami.diagnostic"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.yagami.diagnostic"
        minSdk = 26
        targetSdk = 34
        versionCode = 41
        versionName = "2.8.0"
    }
    // One fixed key so every update installs over the previous version.
    // Path + password come from env (GitHub secret in CI), never from the repo.
    val ksPath = System.getenv("YAGAMI_KEYSTORE")
    val ksPass = System.getenv("YAGAMI_KEYSTORE_PASS")
    signingConfigs {
        if (ksPath != null && ksPass != null) create("yagami") {
            storeFile = file(ksPath); storePassword = ksPass
            keyAlias = "yagami"; keyPassword = ksPass
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("yagami") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
