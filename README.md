# YAGAMI Diagnostics — Android App (source)

Smart Vehicle Scanner for Engine & ABS (ELM327 Bluetooth / Wi-Fi OBD-II).
New YAGAMI interface, **public (no login)**, real OBD-II diagnostics.

## APK kaise banayein — bina PC ke, FREE (GitHub)

1. **github.com** par jao, apne account (pk1761111-dev) se login karo.
2. **New repository** banao (naam: `yagami-diagnostics`), **Public** rakho, Create.
3. Repo me **Add file → Upload files** → is folder ki **saari files/folders** upload karo
   (ya zip extract karke drag-drop). Commit.
4. Upar **Actions** tab kholo → "Build APK" workflow apne-aap chalega (~4-6 min).
   (Pehli baar "I understand my workflows, go ahead" par click karna pad sakta hai.)
5. Jab tick (✓) aa jaye → us run ko kholo → neeche **Artifacts** me
   **YAGAMI-Diagnostics-APK** download karo → zip kholo → andar `app-debug.apk`.
6. Wo APK phone me install karo. Ho gaya.

## Ya Android Studio se
Android Studio me ye folder **Open** karo → **Build → Build Bundle(s)/APK(s) → Build APK(s)** →
`app/build/outputs/apk/debug/app-debug.apk`.

## Features (v2.6.0)
- **Layout:** YAGAMI AI Shipping Control ki copy (hexagon logo, LIVE + bell header, hero card with ring, rangeen stat cards, chips, alert list, line-icon bottom nav)
- **Auto VIN / ECU detection:** connect hote hi VIN, ECU name, calibration ID, protocol aur supported sensors
- **All ECU scan:** har jawab dene wale ECU ke stored / pending / permanent codes alag-alag
- Read / Clear DTC (mode 03/07/0A/04)
- **Live data with graphs:** sirf wahi sensors jo ECU support karta hai, har sensor ka live graph
- **Freeze frame** (mode 02)
- ECU information
- **Actuator test** (standard OBD mode 08, sirf ECU-supported tests, confirm ke baad)
- ABS: honest read-only probe (kabhi fake result nahi)
- **Report sharing:** WhatsApp / email / copy
- **Online code jaankari:** har code ke kaaran + jaanch steps, GitHub ki `dtc/dtc_codes.json` se (offline copy bhi app mein)
- **AI salah:** Google Gemini (free tier) se mechanic jaisi salah. Key: aistudio.google.com (sirf phone mein save)
- **Auto update:** GitHub Release se naya APK, app khud batata hai
- **Products:** Google Sheet se products (bike ke hisaab se), WhatsApp order
- **Notifications:** Firebase Cloud Messaging (topics `all`, `bike_<company>`); `app/google-services.json` chahiye
- Public: koi id ya password nahi

## Online setup (ek baar)
1. Repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `KEYSTORE_B64` = `yagami.jks.b64` file ka poora text
   - `KEYSTORE_PASS` = keystore password
2. Is folder ki saari files repo ki **main** branch mein upload karo (`dtc/dtc_codes.json` bhi).
3. Naya version release karna ho: `app/build.gradle.kts` mein `versionCode`/`versionName` badhao,
   phir GitHub par **Releases → Draft a new release → tag `v2.3.1`** (jo versionName hai) → Publish.
   Action APK banakar release mein laga dega, aur sab phones ko update dikhega.
4. Codes ki jaankari badalni ho: `dtc/dtc_codes.json` edit karo, `version` date badlo. Phones agle din (ya "Codes update karo" dabane par) le lenge.


## Notes
- minSdk 26 (Android 8.0+), targetSdk 34.
- Brand emblems are original designs (no trademark logos).
- Bluetooth needs the "Nearby devices" permission on Android 12+.

## Products kaise badlein
1. `products/YAGAMI-Products-Template.csv` ko Google Sheets mein kholo (File → Import).
2. Columns: **Name, Price, Category, Bikes, Image, Description, Link**
   - Bikes: `All` ya model/company ke naam `;` se alag (jaise `Pulsar NS200; TVS`)
   - Image: photo ka public link (Google Drive "Anyone with the link" bhi chalega)
3. File → Share → **Publish to web** → sheet chuno → **CSV** → Publish → link copy.
4. App: Connect → Online → Products mein link + WhatsApp number → Save + Refresh.
Uske baad sheet mein jo bhi badlo, app roz (ya ↻ dabane par) le leta hai.

## Sab free hai
- Google Sheet (products), Firebase Messaging (notifications), GitHub public repo + Actions (codes, APK, updates), Gemini free tier (AI salah).

## AI salah server (ek baar, free, bina key ke users)
1. **script.google.com** → New project → `apps-script/Code.gs` ka code paste karo → Save.
2. Project Settings (⚙) → Script properties → `GEMINI_KEY` = aistudio.google.com ki free key.
3. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone** → Deploy → Authorize.
4. `/exec` wala URL `config/app.json` mein `ai_url` par daalo (main branch). Sab phones agli baar khulne par le lenge.
Limit: ek phone se din mein 20, total 400 sawaal (Code.gs mein badal sakte ho).
