# YAGAMI CRM – Android APK

Thin, secure Android shell around the YAGAMI CRM server. All data stays on the server, so every phone shares the same customers, payments and reports. Web updates reach the app automatically, so you don't need a new APK.

- First launch asks for the server link (e.g. `yagami-crm.onrender.com`). Only https links are accepted.
- Calls (`tel:`), WhatsApp and other websites open in the phone's own apps.
- Payment proofs can be picked from the gallery or files. CSV reports and backups save to Downloads.
- To change the server: ☰ menu → "Server link badlein", or the button on the connection-error screen.

Build: `ANDROID_HOME=/path/to/sdk ./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`

**Signing key:** `keystore/yagami-release.jks` + `keystore.properties` (not committed to git). Keep both safe. Future APK updates must be signed with the same key, or phones will refuse to update.
