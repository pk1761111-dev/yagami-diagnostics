package com.yagami.diagnostic

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Small HTTP helpers. Blocking — call from a background thread. */
object Net {
    fun get(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Int = 12000): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
            c.setRequestProperty("User-Agent", "YAGAMI-Diagnostics")
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            val code = c.responseCode
            val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to body
        } finally { c.disconnect() }
    }

    fun postJson(url: String, json: String, headers: Map<String, String>, timeoutMs: Int = 60000): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.doOutput = true
            c.connectTimeout = 15000; c.readTimeout = timeoutMs
            c.setRequestProperty("Content-Type", "application/json")
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            c.instanceFollowRedirects = false
            c.outputStream.use { it.write(json.toByteArray()) }
            val code = c.responseCode
            // Google Apps Script answers a POST with a redirect to the result: fetch it with GET.
            if (code in 301..303 || code == 307 || code == 308) {
                val loc = c.getHeaderField("Location") ?: return code to ""
                return get(loc, timeoutMs = timeoutMs)
            }
            val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            return code to body
        } finally { c.disconnect() }
    }
}

/** Where the online files live. Your public GitHub repo; change in Connect → Online settings. */
object OnlineConfig {
    const val DEFAULT_REPO = "pk1761111-dev/yagami-diagnostics"
    fun repo(ctx: Context): String = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).getString("repo", DEFAULT_REPO) ?: DEFAULT_REPO
    fun dbUrl(ctx: Context) = "https://raw.githubusercontent.com/${repo(ctx)}/main/dtc/dtc_codes.json"
    fun releaseUrl(ctx: Context) = "https://api.github.com/repos/${repo(ctx)}/releases/latest"
    fun configUrl(ctx: Context) = "https://raw.githubusercontent.com/${repo(ctx)}/main/config/app.json"

    /** Remote settings from GitHub (config/app.json), so the AI server link can change without a new APK. */
    fun refreshRemote(ctx: Context) {
        try {
            val (code, body) = Net.get(configUrl(ctx))
            if (code == 200) {
                val o = JSONObject(body)
                ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).edit().putString("ai_url", o.optString("ai_url").trim()).apply()
            }
        } catch (e: Exception) {}
    }

    fun aiUrl(ctx: Context): String = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).getString("ai_url", "").orEmpty()

    fun deviceId(ctx: Context): String {
        val p = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE)
        return p.getString("device_id", null) ?: java.util.UUID.randomUUID().toString().also { p.edit().putString("device_id", it).apply() }
    }
}

data class DtcEntry(val name: String, val causes: List<String>, val checks: List<String>)

/**
 * Fault-code knowledge base. Starts from the copy bundled in the APK, then a newer copy downloaded
 * from GitHub (cached on the phone, so it keeps working offline).
 */
object DtcDb {
    @Volatile private var codes: Map<String, DtcEntry> = emptyMap()
    @Volatile var version: String = "—"; private set
    @Volatile var source: String = "built-in"; private set

    private fun cacheFile(ctx: Context) = File(ctx.filesDir, "dtc_codes.json")

    fun parse(json: String): Pair<String, Map<String, DtcEntry>> {
        val o = JSONObject(json)
        val c = o.getJSONObject("codes")
        val out = HashMap<String, DtcEntry>()
        for (k in c.keys()) {
            val e = c.getJSONObject(k)
            fun list(a: JSONArray?) = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }
            out[k.uppercase()] = DtcEntry(e.optString("n"), list(e.optJSONArray("c")), list(e.optJSONArray("s")))
        }
        return o.optString("version", "?") to out
    }

    fun init(ctx: Context) {
        try {
            val (v, m) = parse(ctx.assets.open("dtc_codes.json").bufferedReader().use { it.readText() })
            codes = m; version = v; source = "built-in"
        } catch (e: Exception) {}
        try {
            val f = cacheFile(ctx)
            if (f.exists()) { val (v, m) = parse(f.readText()); if (v >= version) { codes = m; version = v; source = "online (cached)" } }
        } catch (e: Exception) {}
    }

    /** Downloads the latest database. Returns a message for the user. */
    fun refresh(ctx: Context): String = try {
        val (code, body) = Net.get(OnlineConfig.dbUrl(ctx))
        if (code != 200) "Online database nahi mila (HTTP $code). Repo mein dtc/dtc_codes.json upload hai?"
        else {
            val (v, m) = parse(body)
            cacheFile(ctx).writeText(body)
            codes = m; version = v; source = "online"
            "Code database update ho gaya: ${m.size} codes (v$v)"
        }
    } catch (e: Exception) { "Internet se nahi mila: ${e.message ?: e.javaClass.simpleName}" }

    fun get(code: String): DtcEntry? = codes[code.uppercase()]
    val size: Int get() = codes.size
}

/**
 * AI advice through Google Gemini (free tier, key from aistudio.google.com).
 * The key is typed in by the user and stays on the phone. Tries newer models first, falls back if one is retired.
 */
object Ai {
    val MODELS = listOf("gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash")
    private const val SYSTEM = "Tum ek anubhavi Indian two-wheeler mechanic ho. Hinglish (Roman Hindi) mein, chhote points mein jawab do. " +
        "Sirf diye gaye data par bharosa karo; jo data nahi hai uska andaza mat lagao aur saaf bolo ki pakka nahi keh sakte. " +
        "Safety wali baat (brakes, ABS, fuel leak, overheating) sabse pehle likho."

    fun request(prompt: String): String = JSONObject()
        .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", SYSTEM))))
        .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", prompt)))))
        .put("generationConfig", JSONObject().put("maxOutputTokens", 2048).put("temperature", 0.4))
        .toString()

    fun answerText(resp: String): String {
        val cands = JSONObject(resp).optJSONArray("candidates") ?: return ""
        if (cands.length() == 0) return ""
        val parts = cands.getJSONObject(0).optJSONObject("content")?.optJSONArray("parts") ?: return ""
        val sb = StringBuilder()
        for (i in 0 until parts.length()) { val p = parts.getJSONObject(i); if (!p.optBoolean("thought")) sb.append(p.optString("text")) }
        return sb.toString().trim()
    }

    /** Through the YAGAMI server (Apps Script): no key on the phone. */
    fun askServer(url: String, device: String, prompt: String): String {
        val (code, resp) = Net.postJson(url, JSONObject().put("prompt", prompt).put("device", device).toString(), emptyMap())
        if (code != 200) return "AI server se jawab nahi mila (HTTP $code). Thodi der baad try karo."
        return try {
            val o = JSONObject(resp)
            if (!o.optBoolean("ok")) return o.optString("error", "AI server error")
            val sb = StringBuilder(o.optString("text").ifBlank { "AI ne khaali jawab diya." })
            val src = o.optJSONArray("sources")
            if (src != null && src.length() > 0) {
                sb.append("\n\n🌐 Google Search se:")
                for (i in 0 until src.length()) { val x = src.getJSONObject(i); sb.append("\n• ").append(x.optString("title")).append("\n  ").append(x.optString("url")) }
            }
            sb.toString()
        } catch (e: Exception) { "AI server ka jawab samajh nahi aaya." }
    }

    fun ask(apiKey: String, prompt: String): String {
        var last = ""
        for (m in MODELS) {
            val (code, resp) = Net.postJson("https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent",
                request(prompt), mapOf("x-goog-api-key" to apiKey))
            if (code == 200) return answerText(resp).ifBlank { "AI ne khaali jawab diya. Dobara try karo." }
            val msg = try { JSONObject(resp).getJSONObject("error").optString("message") } catch (e: Exception) { resp.take(200) }
            when (code) {
                400, 403 -> if (msg.contains("API key", true) || msg.contains("permission", true)) return "API key galat hai. Connect → Online → AI salah mein Gemini key check karo."
                429 -> return "Aaj ki free limit poori ho gayi ya bahut jaldi-jaldi poochha (429). Thodi der baad try karo."
            }
            last = "HTTP $code: $msg"
            if (code != 404) break       // only a missing/retired model is worth trying the next one
        }
        return "AI se jawab nahi mila ($last)"
    }
}

data class UpdateInfo(val version: String, val apkUrl: String, val pageUrl: String, val notes: String)

/** Checks GitHub Releases for a newer APK. */
object Updater {
    /** "v2.10.1" > "2.9.0" */
    fun newer(remote: String, local: String): Boolean {
        fun parts(s: String) = s.trim().removePrefix("v").removePrefix("V").split('.', '-').map { it.toIntOrNull() ?: 0 }
        val a = parts(remote); val b = parts(local)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }; val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    fun check(ctx: Context, localVersion: String): Pair<UpdateInfo?, String> = try {
        val (code, body) = Net.get(OnlineConfig.releaseUrl(ctx), mapOf("Accept" to "application/vnd.github+json"))
        when {
            code == 404 -> null to "Abhi tak koi release nahi bani."
            code != 200 -> null to "Update check nahi hua (HTTP $code)."
            else -> {
                val o = JSONObject(body)
                val tag = o.optString("tag_name")
                val assets = o.optJSONArray("assets") ?: JSONArray()
                var apk = ""
                for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk")) { apk = a.optString("browser_download_url"); break }
                }
                if (newer(tag, localVersion) && apk.isNotBlank())
                    UpdateInfo(tag.removePrefix("v"), apk, o.optString("html_url"), o.optString("body").take(400)) to "Naya version $tag available hai."
                else null to "App latest hai (v$localVersion)."
            }
        }
    } catch (e: Exception) { null to "Internet se nahi mila: ${e.message ?: e.javaClass.simpleName}" }
}
