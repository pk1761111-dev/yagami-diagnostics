package com.yagami.diagnostic

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * App language. The source text in the code is Hinglish/English; every visible string goes through [tr],
 * which looks it up in lang/<code>.json (bundled in the APK, newer copy downloaded from GitHub).
 * Strings with values inside use {0}, {1}… keys; the values themselves are translated too when known.
 */
object Lang {
    data class L(val code: String, val native: String, val english: String)
    val ALL = listOf(
        L("en", "English", "English"), L("hi", "हिंदी", "Hindi"), L("hinglish", "Hinglish", "Hinglish"),
        L("mr", "मराठी", "Marathi"), L("gu", "ગુજરાતી", "Gujarati"), L("ta", "தமிழ்", "Tamil"),
        L("te", "తెలుగు", "Telugu"), L("kn", "ಕನ್ನಡ", "Kannada"), L("ml", "മലയാളം", "Malayalam")
    )

    @Volatile var code = "hinglish"; private set
    @Volatile private var exact: Map<String, String> = emptyMap()
    @Volatile private var fallback: Map<String, String> = emptyMap()      // English, for keys a language has not translated yet
    @Volatile private var patterns: List<Pair<Regex, String>> = emptyList()
    @Volatile private var fbPatterns: List<Pair<Regex, String>> = emptyList()

    fun current(): L = ALL.first { it.code == code }
    fun chosen(ctx: Context): Boolean = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).contains("lang")

    private fun cache(ctx: Context, c: String) = File(ctx.filesDir, "lang_$c.json")

    private fun read(ctx: Context, c: String): Map<String, String> {
        fun parse(t: String): Pair<String, Map<String, String>> {
            val o = JSONObject(t); val s = o.getJSONObject("strings")
            val m = HashMap<String, String>(); for (k in s.keys()) m[k] = s.getString(k)
            return o.optString("version", "0") to m
        }
        var best: Pair<String, Map<String, String>>? = null
        try { best = parse(ctx.assets.open("lang/$c.json").bufferedReader().use { it.readText() }) } catch (e: Exception) {}
        try { val f = cache(ctx, c); if (f.exists()) { val p = parse(f.readText()); if (best == null || p.first >= best.first) best = p } } catch (e: Exception) {}
        return best?.second ?: emptyMap()
    }

    fun compile(m: Map<String, String>): List<Pair<Regex, String>> =
        m.filterKeys { it.contains("{0}") }.entries
            .sortedByDescending { it.key.replace(Regex("\\{\\d}"), "").length }
            .map { (k, v) ->
                val rx = k.split(Regex("\\{\\d}")).joinToString("(.+?)") { Regex.escape(it) }
                Regex("^$rx$", RegexOption.DOT_MATCHES_ALL) to (k to v)
            }.map { (rx, kv) ->
                // remember the placeholder order of the key
                val order = Regex("\\{(\\d)}").findAll(kv.first).map { it.groupValues[1].toInt() }.toList()
                rx to (order.joinToString(",") + "|" + kv.second)
            }

    fun load(ctx: Context) {
        code = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).getString("lang", "hinglish") ?: "hinglish"
        exact = if (code == "hinglish") emptyMap() else read(ctx, code)
        fallback = if (code == "hinglish" || code == "en") emptyMap() else read(ctx, "en")
        patterns = compile(exact); fbPatterns = compile(fallback)
    }

    fun set(ctx: Context, c: String) {
        ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).edit().putString("lang", c).apply()
        load(ctx)
    }

    /** For tests: use a map directly. */
    fun setForTest(c: String, m: Map<String, String>, fb: Map<String, String> = emptyMap()) {
        code = c; exact = m; fallback = fb; patterns = compile(m); fbPatterns = compile(fb)
    }

    private fun applyPattern(s: String, list: List<Pair<Regex, String>>, depth: Int): String? {
        for ((rx, spec) in list) {
            val m = rx.matchEntire(s) ?: continue
            val order = spec.substringBefore('|').split(',').map { it.toInt() }
            var out = spec.substringAfter('|')
            order.forEachIndexed { gi, idx -> out = out.replace("{$idx}", tr(m.groupValues[gi + 1], depth + 1)) }
            if (out == s) continue          // this split changed nothing; another pattern may fit better
            return out
        }
        return null
    }

    fun tr(s: String, depth: Int = 0): String {
        if (code == "hinglish" || s.isBlank() || depth > 3) return s
        exact[s]?.let { return it }
        fallback[s]?.let { return it }
        // keep surrounding spaces / new lines
        val t = s.trim()
        if (t != s && t.isNotEmpty()) { val r = tr(t, depth); if (r != t) return s.replace(t, r) }
        if (s.contains('\n')) {
            val lines = s.split('\n')
            if (lines.size > 1) return lines.joinToString("\n") { tr(it, depth + 1) }
        }
        applyPattern(s, patterns, depth)?.let { return it }
        applyPattern(s, fbPatterns, depth)?.let { return it }
        return s
    }

    fun tr(s: CharSequence?): CharSequence? = if (s == null || s !is String) s else tr(s)

    /** Downloads the current language file from GitHub (lang/<code>.json). */
    fun refresh(ctx: Context) {
        if (code == "hinglish") return
        for (c in listOf(code, "en").distinct()) try {
            val (http, body) = Net.get("https://raw.githubusercontent.com/${OnlineConfig.repo(ctx)}/main/lang/$c.json")
            if (http == 200 && body.contains("\"strings\"")) { JSONObject(body); cache(ctx, c).writeText(body) }
        } catch (e: Exception) {}
        load(ctx)
    }

    /** Language name for the AI ("Hindi (Devanagari script)", …). */
    fun aiLanguage(): String = when (code) {
        "hinglish" -> "Hinglish (Hindi in Roman script)"
        "en" -> "simple English"
        "hi" -> "Hindi (Devanagari script)"
        else -> current().english + " (" + current().native + " script)"
    }
}
