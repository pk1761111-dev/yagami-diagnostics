package com.yagami.diagnostic

import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : Activity() {

    private enum class Screen { SPLASH, COMPANY, VEHICLE, DASHBOARD, CONNECT, SCAN, LIVE, CLEAR_DTC, FREEZE, ECU_INFO, ACTUATOR, ABS, REPORT, CODE, AI, READY, PRODUCTS, PRODUCT }
    private enum class Tab { HOME, SCAN, LIVE, REPORT, CONNECT, PRODUCTS }

    private val obd = Obd()
    private val io = Executors.newSingleThreadExecutor()
    private val net = Executors.newSingleThreadExecutor()          // internet calls, never blocks the adapter
    private var updateInfo: UpdateInfo? = null
    private var selectedCode: Triple<String, String, String>? = null  // code, kind, ecu
    private var aiAnswer: String? = null
    private var aiFocus: String? = "-"
    private var lastLive = LinkedHashMap<String, String>()
    private val ui = Handler(Looper.getMainLooper())

    private var screen = Screen.SPLASH
    private val backStack = ArrayDeque<Screen>()
    private var brand: String? = null
    private var model: String? = null
    private var mode = "bt"            // "bt" or "wifi"
    private var liveLoop: Runnable? = null

    // ---- session results, used by the dashboard and the shareable report ----
    private var scanResults: LinkedHashMap<String, List<Pair<String, String>>>? = null   // ecu label -> (code, kind)
    private var scanTime: Long = 0
    private var freezeLines: List<Pair<String, String>>? = null
    private var freezeCode: String? = null
    private var lastBattery: String = ""
    private var actuatorLog = ArrayList<String>()
    private var absLog: String? = null

    private fun prefs() = getSharedPreferences("yagami", MODE_PRIVATE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = T.bg
        window.navigationBarColor = T.bg2
        mode = prefs().getString("mode", "bt") ?: "bt"
        brand = prefs().getString("brand", null)
        model = prefs().getString("model", null)
        DtcDb.init(this)
        ProductDb.init(this)
        Push.channel(this)
        Push.subscribe(this, brand)
        askNotificationPermission()
        val fromPush = intent?.getStringExtra("screen")
        show(Screen.SPLASH)
        if (fromPush != null) ui.postDelayed({ openFromPush(fromPush) }, 1500)
        dailyOnlineCheck()
    }

    override fun onDestroy() { super.onDestroy(); io.execute { obd.close() } }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        stopLive()
        val prev = backStack.removeLastOrNull()
        if (prev == null) super.onBackPressed() else show(prev)
    }

    private fun navigate(s: Screen) {
        if (s != screen) backStack.addLast(screen)
        show(s)
    }

    private fun goTab(t: Tab) {
        val target = when (t) {
            Tab.HOME -> Screen.DASHBOARD; Tab.SCAN -> Screen.SCAN; Tab.LIVE -> Screen.LIVE
            Tab.REPORT -> Screen.REPORT; Tab.CONNECT -> Screen.CONNECT; Tab.PRODUCTS -> Screen.PRODUCTS
        }
        if ((t == Tab.SCAN || t == Tab.LIVE) && !obd.connected) { toast("Pehle adapter connect karein"); backStack.clear(); backStack.addLast(Screen.DASHBOARD); show(Screen.CONNECT); return }
        backStack.clear()
        if (target != Screen.DASHBOARD) backStack.addLast(Screen.DASHBOARD)
        show(target)
    }

    private fun show(s: Screen) {
        stopLive()
        screen = s
        when (s) {
            Screen.SPLASH -> buildSplash()
            Screen.COMPANY -> buildCompany()
            Screen.VEHICLE -> buildVehicle()
            Screen.DASHBOARD -> buildDashboard()
            Screen.CONNECT -> buildConnect()
            Screen.SCAN -> buildScan()
            Screen.LIVE -> buildLive()
            Screen.CLEAR_DTC -> buildClearDtc()
            Screen.FREEZE -> buildFreeze()
            Screen.ECU_INFO -> buildEcuInfo()
            Screen.ACTUATOR -> buildActuator()
            Screen.ABS -> buildAbs()
            Screen.REPORT -> buildReport()
            Screen.CODE -> buildCode()
            Screen.AI -> buildAi()
            Screen.READY -> buildReady()
            Screen.PRODUCTS -> buildProducts()
            Screen.PRODUCT -> buildProduct()
        }
    }

    // ================= shared chrome (copied from YAGAMI AI Shipping Control) =================

    private fun codeCount(): Int = scanResults?.values?.sumOf { it.size } ?: 0

    /** Header bar + scrolling body + bottom nav. */
    private fun shell(top: View, tab: Tab?): Pair<LinearLayout, LinearLayout> {
        val root = col().apply { setBackgroundColor(T.bg) }
        root.addView(top, lp(-1, -2))
        root.addView(View(this).apply { setBackgroundColor(alpha(T.yellow, 20)) }, lp(-1, 1))
        val body = col().apply { setPadding(dp(16), dp(14), dp(16), dp(28)) }
        val sv = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        sv.addView(body)
        root.addView(sv, lp(-1, 0, 1f))
        if (tab != null) root.addView(bottomNav(tab), lp(-1, -2))
        return root to body
    }

    /** Hex logo · YAGAMI / AI DIAGNOSTICS · ● LIVE · bell with count. */
    private fun appBar(): LinearLayout {
        val bar = row().apply { setPadding(dp(16), dp(12), dp(16), dp(10)); setBackgroundColor(T.bg) }
        bar.addView(HexLogo(this), lp(dp(30), dp(30)).apply { marginEnd = dp(12) })
        val nm = col()
        nm.addView(tv("YAGAMI", 17f, T.yellow, true).apply { letterSpacing = 0.2f })
        nm.addView(tv("AI DIAGNOSTICS", 9f, T.muted, true).apply { letterSpacing = 0.25f; setPadding(0, dp(4), 0, 0) })
        bar.addView(nm, lp(0, -2, 1f))
        bar.addView(tv(if (obd.connected) "● LIVE" else "○ OFFLINE", 11f, if (obd.connected) T.green else T.grey, true).apply { letterSpacing = 0.1f }, lp(-2, -2).apply { marginEnd = dp(12) })
        bar.addView(bellButton(), lp(dp(42), dp(42)))
        return bar
    }

    private fun bellButton(): FrameLayout {
        val f = FrameLayout(this).apply {
            isClickable = true; clipChildren = false
            setOnClickListener { goTab(Tab.SCAN) }
        }
        f.addView(FrameLayout(this).apply { background = rounded(T.cardHi, dpf(21f), T.stroke, dp(1)) }, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.BOTTOM or Gravity.START))
        f.addView(IconView(this, "bell", T.white), FrameLayout.LayoutParams(dp(22), dp(22), Gravity.BOTTOM or Gravity.START).apply { leftMargin = dp(9); bottomMargin = dp(9) })
        val n = codeCount()
        if (n > 0) f.addView(countBadge(n), FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END))
        return f
    }

    private fun countBadge(n: Int): TextView = tv(n.toString(), 10f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER; minWidth = dp(18); setPadding(dp(5), dp(1), dp(5), dp(2))
        background = rounded(T.red, dpf(9f))
    }

    /** Detail header: square back button · small label + yellow mono value · status badge. */
    private fun detailBar(label: String, title: String, badgeText: String? = null, badgeColor: Int = T.red): LinearLayout {
        val bar = row().apply { setPadding(dp(16), dp(12), dp(16), dp(12)); setBackgroundColor(T.bg) }
        bar.addView(FrameLayout(this).apply {
            background = ripple(rounded(T.cardHi, dpf(11f), T.stroke, dp(1)), dpf(11f)); isClickable = true
            setOnClickListener { onBackPressed() }
            addView(IconView(this@MainActivity, "back", T.white), FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER))
        }, lp(dp(38), dp(38)).apply { marginEnd = dp(12) })
        val c = col()
        c.addView(tv(label.uppercase(), 10f, T.muted, true).apply { letterSpacing = 0.1f })
        c.addView(tv(title, 17f, T.yellow, true).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); setPadding(0, dp(3), 0, 0); maxLines = 1 })
        bar.addView(c, lp(0, -2, 1f))
        if (badgeText != null) bar.addView(badge(badgeText, badgeColor), lp(-2, -2))
        return bar
    }

    private fun subBar(title: String, sub: String? = null): LinearLayout =
        detailBar(sub?.takeIf { it.isNotBlank() } ?: "YAGAMI", title, if (obd.connected) "Live" else "Offline", if (obd.connected) T.green else T.grey)

    private fun bottomNav(active: Tab): LinearLayout {
        val wrap = col().apply { setBackgroundColor(T.bg2) }
        wrap.addView(View(this).apply { setBackgroundColor(T.stroke) }, lp(-1, 1))
        val nav = row().apply { setPadding(dp(6), dp(4), dp(6), dp(8)) }
        val items = listOf(Tab.HOME to ("home" to "Home"), Tab.SCAN to ("scan" to "Scan"), Tab.LIVE to ("live" to "Live"),
            Tab.PRODUCTS to ("bag" to "Products"), Tab.CONNECT to ("connect" to "Connect"))
        for ((t, ic) in items) {
            val on = t == active
            val clr = if (on) T.yellow else T.muted
            val cell = FrameLayout(this).apply {
                isClickable = true; clipChildren = false
                background = ripple(rounded(Color.TRANSPARENT, dpf(12f)), dpf(12f))
                setOnClickListener { if (!on) goTab(t) }
            }
            val c = col().apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(9), 0, dp(4)) }
            c.addView(IconView(this, ic.first, clr), lp(dp(24), dp(24)))
            c.addView(tv(ic.second, 11f, clr, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(4), 0, 0) }, lp(-2, -2))
            cell.addView(c, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
            if (on) cell.addView(View(this).apply {
                background = rounded(T.yellow, dpf(3f))
                if (Build.VERSION.SDK_INT >= 28) { elevation = dpf(6f); outlineSpotShadowColor = T.yellow; outlineAmbientShadowColor = T.yellow }
            }, FrameLayout.LayoutParams(dp(26), dp(3), Gravity.TOP or Gravity.CENTER_HORIZONTAL))
            if (t == Tab.SCAN && codeCount() > 0) cell.addView(countBadge(codeCount()),
                FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { leftMargin = dp(22); topMargin = dp(2) })
            nav.addView(cell, lp(0, -2, 1f))
        }
        wrap.addView(nav, lp(-1, -2))
        return wrap
    }

    /** Pill badge: tinted fill, tinted border, coloured text (Undelivered / RTO Initiated style). */
    private fun badge(text: String, c: Int): TextView = tv(text, 11f, c, true).apply {
        setPadding(dp(9), dp(4), dp(9), dp(4))
        background = rounded(alpha(c, 40), dpf(999f), alpha(c, 90), dp(1))
    }

    /** Small solid tag (the yellow "COD" / "DEMO DATA" tags). */
    private fun tag(text: String, bg: Int, fg: Int = T.ink): TextView = tv(text, 10.5f, fg, true).apply {
        setPadding(dp(7), dp(3), dp(7), dp(3)); background = rounded(bg, dpf(6f)); letterSpacing = 0.04f
    }

    private fun pageTitle(body: LinearLayout, title: String, sub: String) {
        body.addView(tv(title, 24f, T.white, true), lp(-1, -2))
        body.addView(tv(sub, 13f, T.muted).apply { setPadding(0, dp(6), 0, dp(14)) }, lp(-1, -2))
    }

    /** "Live alerts ........ View all (21)" */
    private fun sectionHead(title: String, link: String? = null, onLink: (() -> Unit)? = null): LinearLayout {
        val r = row().apply { setPadding(0, dp(18), 0, dp(10)) }
        r.addView(tv(title, 17f, T.white, true), lp(0, -2, 1f))
        if (link != null) r.addView(tv(link, 13.5f, T.yellow, true).apply { isClickable = true; setOnClickListener { onLink?.invoke() } }, lp(-2, -2))
        return r
    }

    private fun sectionTitle(text: String): TextView = tv(text.uppercase(), 10.5f, T.muted, true).apply {
        letterSpacing = 0.12f; setPadding(dp(2), dp(16), 0, dp(8))
    }

    /** Yellow-bordered info banner with a tag ("DEMO DATA  Sample shipments…"). */
    private fun banner(tagText: String, text: String, c: Int = T.yellow): LinearLayout {
        val b = row().apply {
            gravity = Gravity.TOP; setPadding(dp(14), dp(12), dp(14), dp(12))
            background = rounded(alpha(c, 16), dpf(14f), alpha(c, 80), dp(1))
        }
        b.addView(tag(tagText, c), lp(-2, -2).apply { marginEnd = dp(10) })
        b.addView(tv(text, 13f, T.white), lp(0, -2, 1f))
        return b
    }

    private fun footerBrand(): TextView = tv("YAGAMI\nWe Give Best Quality Connector", 11f, T.muted, false).apply {
        gravity = Gravity.CENTER; setPadding(0, dp(20), 0, dp(4))
    }

    private fun primary(text: String, action: () -> Unit): TextView = tv(text, 15.5f, T.ink, true).apply {
        gravity = Gravity.CENTER; isClickable = true
        background = ripple(vgradient(dpf(12f), T.yellow, T.yellow2), dpf(12f))
        if (Build.VERSION.SDK_INT >= 28) { elevation = dpf(6f); outlineSpotShadowColor = T.yellow; outlineAmbientShadowColor = T.yellow }
        setOnClickListener { action() }
    }

    private fun ghost(text: String, action: () -> Unit): TextView = tv(text, 15f, T.white, true).apply {
        gravity = Gravity.CENTER; isClickable = true
        background = ripple(rounded(T.s3, dpf(12f), T.stroke, dp(1)), dpf(12f))
        setOnClickListener { action() }
    }

    private fun outline(text: String, action: () -> Unit): TextView = tv(text, 14f, T.white, true).apply {
        gravity = Gravity.CENTER; isClickable = true
        background = ripple(rounded(T.bg, dpf(10f), T.stroke, dp(1)), dpf(10f))
        setOnClickListener { action() }
    }

    private fun danger(text: String, action: () -> Unit): TextView = tv(text, 15f, Color.WHITE, true).apply {
        gravity = Gravity.CENTER; isClickable = true
        background = ripple(rounded(T.red, dpf(12f)), dpf(12f))
        setOnClickListener { action() }
    }

    private fun card(): LinearLayout = col().apply {
        setPadding(dp(14), dp(14), dp(14), dp(14))
        background = rounded(T.card, dpf(16f), T.stroke, dp(1))
    }

    /** Card with an uppercase heading, like the Settings sections. */
    private fun sectionCard(title: String): LinearLayout = card().apply {
        addView(tv(title.uppercase(), 11f, T.muted, true).apply { letterSpacing = 0.12f; setPadding(0, 0, 0, dp(10)) })
    }

    /** Stat card: label, big coloured value, colour bar at the bottom, glow when [glow]. */
    private fun statTile(label: String, value: String, c: Int, glow: Boolean = false, tinted: Boolean = false, onClick: (() -> Unit)? = null): FrameLayout {
        val f = FrameLayout(this).apply {
            val bg = if (tinted) vgradient(dpf(16f), alpha(c, 40), T.card).apply { setStroke(dp(1), alpha(c, 70)) }
                     else rounded(T.card, dpf(16f), if (glow) alpha(c, 120) else alpha(c, 45), dp(1))
            background = if (onClick != null) ripple(bg, dpf(16f)) else bg
            clipToOutline = true
            if (glow && Build.VERSION.SDK_INT >= 28) { elevation = dpf(10f); outlineSpotShadowColor = c; outlineAmbientShadowColor = c }
            if (onClick != null) { isClickable = true; setOnClickListener { onClick() } }
            minimumHeight = dp(98)
        }
        val c2 = col().apply { setPadding(dp(12), dp(12), dp(12), dp(14)) }
        c2.addView(tv(label, 12f, T.muted, true).apply { maxLines = 2 }, lp(-1, -2))
        c2.addView(tv(value, 30f, c, true).apply { setPadding(0, dp(12), 0, 0); maxLines = 1 }, lp(-1, -2))
        f.addView(c2, FrameLayout.LayoutParams(-1, -2))
        f.addView(View(this).apply { setBackgroundColor(alpha(c, 200)) }, FrameLayout.LayoutParams(-1, dp(3), Gravity.BOTTOM))
        return f
    }

    /** Rounded pill chip: "⏱ Overdue 6". */
    private fun quickChip(icon: String, label: String, count: String?, action: () -> Unit): LinearLayout = row().apply {
        setPadding(dp(14), dp(10), dp(14), dp(10)); isClickable = true
        background = ripple(rounded(T.cardHi, dpf(999f), T.stroke, dp(1)), dpf(999f))
        setOnClickListener { action() }
        addView(IconView(this@MainActivity, icon, T.white), lp(dp(16), dp(16)).apply { marginEnd = dp(6) })
        addView(tv(label, 13.5f, T.white, true), lp(-2, -2))
        if (count != null) addView(tv("  $count", 13.5f, T.yellow, true), lp(-2, -2))
    }

    /** Horizontal scrolling row of chips. */
    private fun chipRow(views: List<View>): android.widget.HorizontalScrollView {
        val r = row()
        views.forEachIndexed { i, v -> r.addView(v, lp(-2, -2).apply { if (i < views.size - 1) marginEnd = dp(8) }) }
        return android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(r) }
    }

    /** Filter chip: solid yellow when on (the "All" / "All types" chips). */
    private fun filterChip(text: String, on: Boolean, action: () -> Unit): TextView = tv(text, 13f, if (on) T.ink else T.white, true).apply {
        setPadding(dp(14), dp(8), dp(14), dp(8)); isClickable = true
        background = ripple(if (on) rounded(T.yellow, dpf(999f)) else rounded(T.cardHi, dpf(999f), T.stroke, dp(1)), dpf(999f))
        setOnClickListener { action() }
    }

    /** Segmented control ("Active | Resolved", "All At Risk | High | Medium"). */
    private fun segmented(options: List<String>, active: Int, onPick: (Int) -> Unit): LinearLayout {
        val s = row().apply { setPadding(dp(3), dp(3), dp(3), dp(3)); background = rounded(T.card, dpf(12f), T.stroke, dp(1)) }
        options.forEachIndexed { i, o ->
            val on = i == active
            s.addView(tv(o, 13f, if (on) T.yellow else T.muted, true).apply {
                gravity = Gravity.CENTER; setPadding(dp(12), dp(7), dp(12), dp(7)); isClickable = true
                background = if (on) rounded(alpha(T.yellow, 22), dpf(9f), alpha(T.yellow, 110), dp(1)) else rounded(Color.TRANSPARENT, dpf(9f))
                setOnClickListener { onPick(i) }
            }, lp(-2, -2))
        }
        return s
    }

    /** Two-column key/value grid with uppercase labels (shipment detail style). */
    private fun kvGrid(pairs: List<Pair<String, String>>, highlight: Set<String> = emptySet()): LinearLayout {
        val c = card()
        var i = 0
        while (i < pairs.size) {
            val r = row().apply { gravity = Gravity.TOP; setPadding(0, if (i == 0) 0 else dp(14), 0, 0) }
            for (j in 0 until 2) {
                val p = pairs.getOrNull(i + j)
                val cell = col()
                if (p != null) {
                    cell.addView(tv(p.first.uppercase(), 10.5f, T.muted, true).apply { letterSpacing = 0.1f })
                    cell.addView(tv(p.second, 14f, if (p.first in highlight) T.orange else T.white, true).apply { setPadding(0, dp(5), dp(6), 0) })
                }
                r.addView(cell, lp(0, -2, 1f))
            }
            c.addView(r, lp(-1, -2))
            i += 2
        }
        return c
    }

    /** Alert row: coloured dot · title + mono sub · time on the right. */
    private fun alertRow(title: String, sub: String, right: String, dot: Int, action: (() -> Unit)? = null): LinearLayout = row().apply {
        setPadding(dp(14), dp(14), dp(14), dp(14))
        background = if (action != null) ripple(rounded(T.card, dpf(14f), T.stroke, dp(1)), dpf(14f)) else rounded(T.card, dpf(14f), T.stroke, dp(1))
        if (action != null) { isClickable = true; setOnClickListener { action() } }
        addView(View(this@MainActivity).apply { background = rounded(dot, dpf(5f)) }, lp(dp(10), dp(10)).apply { marginEnd = dp(14) })
        val c = col()
        c.addView(tv(title, 15f, T.white, true))
        c.addView(tv(sub, 12.5f, T.muted).apply { setPadding(0, dp(4), 0, 0); maxLines = 2 })
        addView(c, lp(0, -2, 1f))
        addView(tv(right, 12f, T.muted), lp(-2, -2).apply { marginStart = dp(8) })
    }

    /** Big card with a red left edge (the Alerts tab "CRITICAL · RTO" cards). */
    private fun edgeCard(c: Int): Pair<LinearLayout, LinearLayout> {
        val outer = row().apply {
            gravity = Gravity.FILL_VERTICAL
            background = rounded(T.card, dpf(14f), alpha(c, 60), dp(1)); clipToOutline = true
        }
        outer.addView(View(this).apply { setBackgroundColor(c) }, lp(dp(4), -1))
        val inner = col().apply { setPadding(dp(14), dp(14), dp(14), dp(14)) }
        outer.addView(inner, lp(0, -2, 1f))
        return outer to inner
    }

    /** Lays out views in a grid of [cols] equal columns. */
    private fun grid(parent: LinearLayout, cols: Int, views: List<View>) {
        var i = 0
        while (i < views.size) {
            val r = row().apply { gravity = Gravity.TOP }
            for (j in 0 until cols) {
                val v = views.getOrNull(i + j)
                r.addView(v ?: View(this), lp(0, -2, 1f).apply { if (j < cols - 1) marginEnd = dp(10) })
            }
            parent.addView(r, lp(-1, -2).apply { bottomMargin = dp(10) })
            i += cols
        }
    }

    // ================= Online (code database, updates) =================

    private fun appVersion(): String = try { packageManager.getPackageInfo(packageName, 0).versionName ?: "0" } catch (e: Exception) { "0" }

    /** Once a day: refresh the code database and look for a new APK. Silent if offline. */
    private fun dailyOnlineCheck() {
        val today = SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())
        val doDb = prefs().getString("db_day", "") != today
        net.execute {
            if (doDb && DtcDb.refresh(this).startsWith("Code database")) prefs().edit().putString("db_day", today).apply()
            OnlineConfig.refreshRemote(this)
            if (ProductDb.url(this).isNotBlank()) ProductDb.refresh(this)
            val (u, _) = Updater.check(this, appVersion())
            ui.post { updateInfo = u; if (screen == Screen.DASHBOARD) buildDashboard() }
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && !prefs().getBoolean("asked_notif", false)) {
            prefs().edit().putBoolean("asked_notif", true).apply()
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2)
        }
    }

    private fun notifAllowed(): Boolean = Build.VERSION.SDK_INT < 33 ||
        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** A notification can carry data "screen": products / scan / connect / update / a web link. */
    private fun openFromPush(target: String) {
        when {
            target.startsWith("http") -> openUrl(target)
            target == "products" -> goTab(Tab.PRODUCTS)
            target == "scan" -> goTab(Tab.SCAN)
            target == "connect" || target == "update" -> goTab(Tab.CONNECT)
            else -> {}
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("screen")?.let { openFromPush(it) }
    }

    private fun openUrl(url: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))) } catch (e: Exception) { toast("Link nahi khula") }
    }

    // ================= Splash =================

    private fun buildSplash() {
        val root = FrameLayout(this).apply { setBackgroundColor(T.bg) }
        val c = col().apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(24), 0, dp(24), 0) }
        c.addView(HexLogo(this), lp(dp(110), dp(110)))
        c.addView(tv("YAGAMI", 40f, T.yellow, true).apply { gravity = Gravity.CENTER; letterSpacing = 0.18f; setPadding(0, dp(10), 0, 0) }, lp(-2, -2))
        c.addView(tv("AI DIAGNOSTICS", 13f, T.muted, true).apply { gravity = Gravity.CENTER; letterSpacing = 0.34f; setPadding(0, dp(4), 0, 0) }, lp(-2, -2))
        c.addView(tv("Smart Vehicle Scanner for Engine & ABS", 12.5f, T.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(14), 0, 0) }, lp(-2, -2))
        c.addView(tv("Initializing… Please Wait", 11.5f, T.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(40), 0, 0) }, lp(-2, -2))
        root.addView(c, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        setContentView(root)
        ui.postDelayed({
            if (screen == Screen.SPLASH) {
                backStack.clear()
                show(Screen.DASHBOARD)          // always open on Home; bike is picked from "Change bike"
            }
        }, 1400)
    }

    // ================= Select Company / Vehicle =================

    // ================= Vehicle picker: Company → Model → Ready =================

    private var pickQuery = ""

    /** "① Company — ② Model — ③ Ready" step bar. */
    private fun steps(active: Int): LinearLayout {
        val r = row().apply { setPadding(0, 0, 0, dp(14)) }
        listOf("Company", "Model", "Ready").forEachIndexed { i, name ->
            val done = i < active; val on = i == active
            val c = if (on || done) T.yellow else T.muted
            r.addView(tv(if (done) "✓" else "${i + 1}", 12f, if (on || done) T.ink else T.muted, true).apply {
                gravity = Gravity.CENTER
                background = if (on || done) rounded(T.yellow, dpf(12f)) else rounded(T.cardHi, dpf(12f), T.stroke, dp(1))
            }, lp(dp(24), dp(24)))
            r.addView(tv(name, 12.5f, c, true).apply { setPadding(dp(6), 0, dp(6), 0) }, lp(-2, -2))
            if (i < 2) r.addView(View(this).apply { setBackgroundColor(if (done) T.yellow else T.stroke) }, lp(0, dp(2), 1f).apply { marginEnd = dp(6) })
        }
        return r
    }

    private fun searchBox(hint: String, onChange: (String) -> Unit): EditText = field(pickQuery).apply {
        this.hint = "⌕  $hint"
        addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { pickQuery = s?.toString().orEmpty(); onChange(pickQuery) }
        })
    }

    private fun buildCompany() {
        val (root, body) = shell(detailBar("Step 1 of 3", "Select Company"), null)
        body.addView(steps(0), lp(-1, -2))
        body.addView(tv("Apni bike ki company chunein", 13f, T.muted).apply { setPadding(0, 0, 0, dp(10)) }, lp(-1, -2))
        val gridBox = col()
        fun fill(q: String) {
            gridBox.removeAllViews()
            val list = Data.brands.keys.filter { b -> q.isBlank() || b.contains(q, true) || Data.brands[b].orEmpty().any { it.contains(q, true) } }
            if (list.isEmpty()) { gridBox.addView(tv("Kuch nahi mila. 'Others' chunein.", 13f, T.muted), lp(-1, -2)); return }
            grid(gridBox, 3, list.map { b ->
                val style = Data.brandStyle[b] ?: ("#7A8594" to b.take(2).uppercase())
                val selected = b == brand
                val t = col().apply {
                    gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(8), dp(14), dp(8), dp(12))
                    background = ripple(if (selected) vgradient(dpf(16f), alpha(T.yellow, 34), T.card).apply { setStroke(dp(1), T.yellow) }
                        else rounded(T.card, dpf(16f), T.stroke, dp(1)), dpf(16f))
                    isClickable = true
                    setOnClickListener {
                        if (brand != b) model = null
                        brand = b; pickQuery = ""
                        animate().scaleX(0.94f).scaleY(0.94f).setDuration(90).withEndAction { navigate(Screen.VEHICLE) }.start()
                    }
                }
                t.addView(BrandBadge(this, style.second, style.first), lp(dp(42), dp(42)))
                t.addView(tv(b, 12.5f, if (selected) T.yellow else T.white, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0); maxLines = 1 }, lp(-2, -2))
                t.addView(tv("${Data.brands[b].orEmpty().size} models", 10.5f, T.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(2), 0, 0) }, lp(-2, -2))
                t as View
            })
        }
        body.addView(searchBox("Company ya model dhoondo (Pulsar, Activa…)") { fill(it) }, lp(-1, dp(48)).apply { bottomMargin = dp(12) })
        body.addView(gridBox, lp(-1, -2))
        fill(pickQuery)
        setContentView(root)
    }

    private fun buildVehicle() {
        val b = brand ?: return show(Screen.COMPANY)
        val (root, body) = shell(detailBar("Step 2 of 3", b), null)
        body.addView(steps(1), lp(-1, -2))
        val style = Data.brandStyle[b] ?: ("#7A8594" to b.take(2).uppercase())
        val chip = row().apply { setPadding(dp(14), dp(12), dp(14), dp(12)); background = vgradient(dpf(16f), alpha(T.yellow, 30), T.card).apply { setStroke(dp(1), alpha(T.yellow, 80)) } }
        chip.addView(BrandBadge(this, style.second, style.first), lp(dp(36), dp(36)).apply { marginEnd = dp(12) })
        val cc = col()
        cc.addView(tv(b, 17f, T.white, true))
        cc.addView(tv("${Data.brands[b].orEmpty().size} models · apna model chunein", 12f, T.muted).apply { setPadding(0, dp(3), 0, 0) })
        chip.addView(cc, lp(0, -2, 1f))
        body.addView(chip, lp(-1, -2).apply { bottomMargin = dp(12) })
        val listBox = col()
        fun fill(q: String) {
            listBox.removeAllViews()
            val models = Data.brands[b].orEmpty().filter { q.isBlank() || it.contains(q, true) }
            if (models.isEmpty()) listBox.addView(tv("Ye model list mein nahi hai. Sabse milta-julta model chunein.", 13f, T.muted), lp(-1, -2))
            for (m in models) {
                val selected = m == model
                val rrow = row().apply {
                    setPadding(dp(14), dp(14), dp(14), dp(14))
                    background = ripple(rounded(if (selected) alpha(T.yellow, 26) else T.card, dpf(14f), if (selected) T.yellow else T.stroke, dp(1)), dpf(14f))
                    isClickable = true
                    setOnClickListener {
                        model = m; pickQuery = ""
                        prefs().edit().putString("brand", b).putString("model", m).apply()
                        Push.subscribe(this@MainActivity, b)
                        animate().scaleX(0.97f).scaleY(0.97f).setDuration(90).withEndAction { show(Screen.READY) }.start()
                    }
                }
                rrow.addView(IconView(this, "bike", if (selected) T.yellow else T.muted), lp(dp(22), dp(22)).apply { marginEnd = dp(12) })
                rrow.addView(tv(m, 15f, if (selected) T.yellow else T.white, true), lp(0, -2, 1f))
                rrow.addView(tv(if (selected) "✓" else "›", 18f, if (selected) T.yellow else T.muted, true), lp(-2, -2))
                listBox.addView(rrow, lp(-1, -2).apply { bottomMargin = dp(8) })
            }
        }
        body.addView(searchBox("Model dhoondo") { fill(it) }, lp(-1, dp(48)).apply { bottomMargin = dp(12) })
        body.addView(listBox, lp(-1, -2))
        fill(pickQuery)
        setContentView(root)
    }

    /** Step 3: short "profile ready" animation. Every line states something true about the selection. */
    private fun buildReady() {
        val b = brand ?: return show(Screen.COMPANY)
        val m = model ?: return show(Screen.VEHICLE)
        val root = FrameLayout(this).apply { setBackgroundColor(T.bg) }
        val c = col().apply { gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(28), 0, dp(28), 0) }
        c.addView(steps(2), lp(-1, -2).apply { bottomMargin = dp(18) })
        val logo = HexLogo(this)
        c.addView(logo, lp(dp(84), dp(84)))
        logo.animate().rotationBy(360f).setDuration(1400).start()
        val style = Data.brandStyle[b] ?: ("#7A8594" to b.take(2).uppercase())
        c.addView(BrandBadge(this, style.second, style.first), lp(dp(46), dp(46)).apply { topMargin = dp(18) })
        c.addView(tv(m, 22f, T.white, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(10), 0, 0) }, lp(-1, -2))
        c.addView(tv(b, 13f, T.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(4), 0, dp(18)) }, lp(-1, -2))
        val bar = FrameLayout(this).apply { background = rounded(T.cardHi, dpf(3f)) }
        val fillV = View(this).apply { background = vgradient(dpf(3f), T.yellow, T.yellow2); pivotX = 0f; scaleX = 0f }
        bar.addView(fillV, FrameLayout.LayoutParams(-1, -1))
        c.addView(bar, lp(-1, dp(6)).apply { bottomMargin = dp(16) })
        val lines = listOf(
            "$b profile load ho gaya",
            "Model: $m",
            "Fault code database: ${DtcDb.size} codes ready",
            "Protocol connect hote hi auto-detect hoga",
            "Vehicle save ho gaya"
        )
        val list = col()
        c.addView(list, lp(-1, -2))
        root.addView(c, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        setContentView(root)
        lines.forEachIndexed { i, t ->
            ui.postDelayed({
                if (screen != Screen.READY) return@postDelayed
                val r = row().apply { setPadding(0, dp(6), 0, dp(6)); alpha = 0f; translationY = dpf(8f) }
                r.addView(tv("✓", 14f, T.ink, true).apply { gravity = Gravity.CENTER; background = rounded(T.green, dpf(11f)) }, lp(dp(22), dp(22)).apply { marginEnd = dp(12) })
                r.addView(tv(t, 14.5f, T.white, i == 1), lp(0, -2, 1f))
                list.addView(r, lp(-1, -2))
                r.animate().alpha(1f).translationY(0f).setDuration(220).start()
                fillV.animate().scaleX((i + 1f) / lines.size).setDuration(260).start()
            }, 250L + i * 330L)
        }
        ui.postDelayed({
            if (screen == Screen.READY) { backStack.clear(); show(Screen.DASHBOARD); toast("✓ $b $m select ho gayi") }
        }, 250L + lines.size * 330L + 650L)
    }

    /** Vehicle bar on Home: the selected bike, or a big call to pick one. */
    private fun vehicleCard(): LinearLayout {
        val b = brand; val m = model
        val open = { pickQuery = ""; backStack.clear(); backStack.addLast(Screen.DASHBOARD); show(if (b != null && m == null) Screen.VEHICLE else Screen.COMPANY) }
        val r = row().apply {
            setPadding(dp(14), dp(12), dp(12), dp(12)); isClickable = true
            setOnClickListener { open() }
        }
        if (b == null || m == null) {
            r.background = ripple(vgradient(dpf(16f), alpha(T.yellow, 40), T.card).apply { setStroke(dp(1), T.yellow) }, dpf(16f))
            r.addView(FrameLayout(this).apply {
                background = rounded(alpha(T.yellow, 40), dpf(12f))
                addView(IconView(this@MainActivity, "bike", T.yellow), FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER))
            }, lp(dp(44), dp(44)).apply { marginEnd = dp(12) })
            val cc = col()
            cc.addView(tv("Apni bike chunein", 16f, T.white, true))
            cc.addView(tv("${Data.brands.size} companies · ${Data.brands.values.sumOf { it.size }} models", 12f, T.muted).apply { setPadding(0, dp(3), 0, 0) })
            r.addView(cc, lp(0, -2, 1f))
            r.addView(tv("Select", 13f, T.ink, true).apply { setPadding(dp(14), dp(8), dp(14), dp(8)); background = vgradient(dpf(10f), T.yellow, T.yellow2) }, lp(-2, -2))
        } else {
            r.background = ripple(rounded(T.card, dpf(16f), T.stroke, dp(1)), dpf(16f))
            val style = Data.brandStyle[b] ?: ("#7A8594" to b.take(2).uppercase())
            r.addView(BrandBadge(this, style.second, style.first), lp(dp(40), dp(40)).apply { marginEnd = dp(12) })
            val cc = col()
            cc.addView(tv(b.uppercase(), 10.5f, T.muted, true).apply { letterSpacing = 0.1f })
            cc.addView(tv(m, 16f, T.white, true).apply { setPadding(0, dp(3), 0, 0) })
            r.addView(cc, lp(0, -2, 1f))
            r.addView(tv("Change", 12.5f, T.yellow, true).apply { setPadding(dp(12), dp(7), dp(12), dp(7)); background = rounded(alpha(T.yellow, 26), dpf(10f), alpha(T.yellow, 90), dp(1)) }, lp(-2, -2))
        }
        return r
    }

    // ================= Dashboard =================

    private var actuatorTests: Int? = null
    private var absOthers: Int? = null

    private fun buildDashboard() {
        val (root, body) = shell(appBar(), Tab.HOME)
        body.addView(vehicleCard(), lp(-1, -2).apply { bottomMargin = dp(12) })

        if (!obd.connected) body.addView(banner("OFFLINE", "ELM327 connect karein. VIN, ECU aur fault codes apne-aap detect honge.").apply {
            isClickable = true; setOnClickListener { goTab(Tab.CONNECT) }
        }, lp(-1, -2).apply { bottomMargin = dp(12) })
        updateInfo?.let { u -> body.addView(banner("UPDATE", "Naya version v${u.version} aa gaya hai. Download karne ke liye dabayein.", T.green).apply {
            isClickable = true; setOnClickListener { openUrl(u.apkUrl) }
        }, lp(-1, -2).apply { bottomMargin = dp(12) }) }
        if (!obd.connected) Unit
        else if (!obd.detected) body.addView(banner("DETECTING", "VIN, ECU aur supported sensors padh raha hoon…"), lp(-1, -2).apply { bottomMargin = dp(12) })

        // Hero card (the "COD VALUE AT RISK" card)
        val n = scanResults?.values?.sumOf { it.size }
        val hero = row().apply {
            setPadding(dp(18), dp(18), dp(14), dp(18))
            background = ripple(vgradient(dpf(18f), alpha(T.yellow, 34), T.card).apply { setStroke(dp(1), alpha(T.yellow, 90)) }, dpf(18f))
            isClickable = true
            setOnClickListener { goTab(Tab.SCAN) }
        }
        val hc = col()
        hc.addView(tv("FAULT CODES FOUND", 11f, T.muted, true).apply { letterSpacing = 0.14f })
        hc.addView(tv(n?.toString() ?: "—", 40f, T.yellow, true).apply { setPadding(0, dp(8), 0, dp(6)) })
        hc.addView(tv(if (scanResults == null) "Scan abhi nahi hua" else "Aakhri scan ${ago(scanTime)}", 13.5f, T.white, true))
        val sub = if (obd.detected) listOfNotNull(obd.vin?.let { "VIN …" + it.takeLast(6) }, "${obd.ecus.size.coerceAtLeast(1)} ECU", obd.protocol.substringAfter("AUTO, ").substringBefore(" (").trim()).joinToString(" · ")
                  else if (obd.connected) "Detecting…" else "Not connected"
        hc.addView(tv(sub, 12f, T.muted).apply { setPadding(0, dp(4), 0, 0); maxLines = 2 })
        hero.addView(hc, lp(0, -2, 1f))
        val volts = lastBattery.filter { it.isDigit() || it == '.' }.toFloatOrNull()
        hero.addView(RingView(this).apply {
            value = if (volts != null) "%.1fV".format(volts) else "—"
            caption = "Battery"
            frac = if (volts != null) (volts - 11f) / 3.5f else 0f
            ringColor = if (volts == null) T.yellow else if (volts < 11.8f) T.red else if (volts < 12.3f) T.orange else T.yellow
        }, lp(dp(96), dp(96)))
        body.addView(hero, lp(-1, -2).apply { bottomMargin = dp(14) })

        // 3 x 3 stat grid
        val res = scanResults
        val stored = res?.values?.sumOf { l -> l.count { it.second == "Stored" } }
        val pending = res?.values?.sumOf { l -> l.count { it.second == "Pending" } }
        val perm = res?.values?.sumOf { l -> l.count { it.second == "Permanent" } }
        val liveN = if (obd.detected) livePidsFor(obd.supported).size else null
        grid(body, 3, listOf(
            statTile("All ECU Scan", if (obd.detected) obd.ecus.size.coerceAtLeast(1).toString() else "—", T.yellow, tinted = true) { ensureConnected { goTab(Tab.SCAN) } },
            statTile("Stored", stored?.toString() ?: "—", T.red, glow = (stored ?: 0) > 0) { ensureConnected { goTab(Tab.SCAN) } },
            statTile("Pending", pending?.toString() ?: "—", T.orange, glow = (pending ?: 0) > 0) { ensureConnected { goTab(Tab.SCAN) } },
            statTile("Live Data", liveN?.toString() ?: "—", T.green) { ensureConnected { goTab(Tab.LIVE) } },
            statTile("Freeze Frame", if (freezeLines == null) "—" else if (freezeCode == null) "0" else "1", T.cyan) { ensureConnected { navigate(Screen.FREEZE) } },
            statTile("ECU Info", if (obd.detected) (if (obd.isCan) "CAN" else "K") else "—", T.blue) { ensureConnected { navigate(Screen.ECU_INFO) } },
            statTile("Actuator Test", actuatorTests?.toString() ?: "—", T.purple) { ensureConnected { navigate(Screen.ACTUATOR) } },
            statTile("ABS", absOthers?.toString() ?: "—", T.purple, glow = false) { ensureConnected { navigate(Screen.ABS) } },
            statTile("Permanent", perm?.toString() ?: "—", T.grey) { ensureConnected { goTab(Tab.SCAN) } }
        ))

        // quick chips
        body.addView(chipRow(listOf(
            quickChip("ai", "AI salah", null) { selectedCode = null; navigate(Screen.AI) },
            quickChip("clear", "Clear DTC", null) { ensureConnected { navigate(Screen.CLEAR_DTC) } },
            quickChip("report", "Report", null) { navigate(Screen.REPORT) },
            quickChip("bag", "Products", null) { goTab(Tab.PRODUCTS) },
            quickChip("snow", "Freeze frame", if (freezeCode != null) "1" else null) { ensureConnected { navigate(Screen.FREEZE) } },
            quickChip("bike", "Change bike", null) { pickQuery = ""; backStack.clear(); backStack.addLast(Screen.DASHBOARD); show(Screen.COMPANY) }
        )), lp(-1, -2).apply { topMargin = dp(2) })

        // Fault codes list (the "Live alerts" list)
        val all = res?.flatMap { (ecu, l) -> l.map { Triple(it.first, it.second, ecu) } }.orEmpty()
        body.addView(sectionHead("Fault codes", if (res != null) "View all (${all.size})" else "Scan →") { ensureConnected { goTab(Tab.SCAN) } }, lp(-1, -2))
        when {
            res == null -> body.addView(alertRow("Scan nahi hua", "All ECU Scan chalayein. Har ECU ke codes yahan dikhenge.", "—", T.grey) { ensureConnected { goTab(Tab.SCAN) } }, lp(-1, -2))
            all.isEmpty() -> body.addView(alertRow("Koi fault code nahi", "${res.size} ECU scan hue · sab saaf", ago(scanTime), T.green), lp(-1, -2))
            else -> for ((code, kind, ecu) in all.take(5)) body.addView(alertRow("$code · ${kind.uppercase()}", Data.describe(code), ago(scanTime),
                if (kind == "Stored") T.red else if (kind == "Pending") T.orange else T.purple) { selectedCode = Triple(code, kind, ecu); navigate(Screen.CODE) }, lp(-1, -2).apply { bottomMargin = dp(8) })
        }

        addHomeProducts(body)
        body.addView(footerBrand(), lp(-1, -2))
        setContentView(root)

        if (obd.connected) {
            val wasDetected = obd.detected
            val hadBatt = lastBattery.isNotBlank()
            io.execute {
                if (!obd.detected) obd.autoDetect()
                val b = obd.battery()
                ui.post {
                    if (b.isNotBlank()) lastBattery = b
                    if (screen == Screen.DASHBOARD && ((!wasDetected && obd.detected) || (!hadBatt && b.isNotBlank()))) buildDashboard()
                }
            }
        }
    }

    private fun ago(t: Long): String {
        if (t == 0L) return "—"
        val m = (System.currentTimeMillis() - t) / 60000
        return if (m < 1) "just now" else if (m < 60) "${m}m ago" else "${m / 60}h ago"
    }

    private fun ensureConnected(then: () -> Unit) {
        if (obd.connected) then() else { toast("Pehle adapter connect karein"); goTab(Tab.CONNECT) }
    }

    // ================= Connect =================

    private var connectInfo: TextView? = null

    private fun buildConnect() {
        val (root, body) = shell(appBar(), Tab.CONNECT)
        pageTitle(body, "Connect", "ELM327 Bluetooth ya Wi-Fi adapter.")

        val info = tv(if (obd.connected) "Connected to ${obd.adapterName}" else "Not connected", 13.5f,
            if (obd.connected) T.green else T.muted, true)
        connectInfo = info
        body.addView(card().apply { addView(info) }, lp(-1, -2).apply { bottomMargin = dp(12) })

        val toggle = row().apply { setPadding(dp(4), dp(4), dp(4), dp(4)); background = rounded(T.cardHi, dpf(14f), T.stroke, dp(1)) }
        toggle.addView(modeBtn("Bluetooth", "bt"), lp(0, dp(42), 1f).apply { marginEnd = dp(4) })
        toggle.addView(modeBtn("Wi-Fi", "wifi"), lp(0, dp(42), 1f))
        body.addView(toggle, lp(-1, -2).apply { bottomMargin = dp(4) })

        if (mode == "bt") {
            body.addView(sectionTitle("Paired ELM / OBD adapters"), lp(-1, -2))
            val list = col()
            body.addView(list, lp(-1, -2))
            fillBonded(list)
            body.addView(ghost("Open Bluetooth Settings") {
                try { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) } catch (e: Exception) {}
            }, lp(-1, dp(50)).apply { topMargin = dp(10) })
        } else {
            body.addView(sectionTitle("Adapter IP"), lp(-1, -2))
            val ip = field(prefs().getString("ip", "192.168.0.10") ?: "192.168.0.10")
            body.addView(ip, lp(-1, dp(50)))
            body.addView(sectionTitle("Port"), lp(-1, -2))
            val port = field(prefs().getString("port", "35000") ?: "35000")
            body.addView(port, lp(-1, dp(50)).apply { bottomMargin = dp(14) })
            body.addView(primary("Connect (Wi-Fi)") {
                val ipv = ip.text.toString().trim(); val pv = port.text.toString().trim().toIntOrNull() ?: 35000
                prefs().edit().putString("ip", ipv).putString("port", pv.toString()).putString("mode", "wifi").apply()
                mode = "wifi"
                doConnect { obd.connectWifi(ipv, pv) }
            }, lp(-1, dp(52)))
        }
        if (obd.connected) body.addView(danger("Disconnect") {
            io.execute { obd.close(); ui.post { toast("Disconnected"); show(Screen.CONNECT) } }
        }, lp(-1, dp(50)).apply { topMargin = dp(12) })
        addOnlineSettings(body)
        setContentView(root)
    }

    private fun modeBtn(label: String, m: String): TextView = tv(label, 14f, if (mode == m) T.ink else T.muted, true).apply {
        gravity = Gravity.CENTER; isClickable = true
        background = ripple(if (mode == m) vgradient(dpf(11f), T.yellow, T.yellow2) else rounded(Color.TRANSPARENT, dpf(11f)), dpf(11f))
        setOnClickListener { mode = m; prefs().edit().putString("mode", m).apply(); show(Screen.CONNECT) }
    }

    private fun fillBonded(list: LinearLayout) {
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.BLUETOOTH_CONNECT), 1)
            list.addView(tv("Bluetooth permission needed — allow and reopen.", 12.5f, T.muted), lp(-1, -2))
            return
        }
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) {
            list.addView(tv("Turn on Bluetooth, then reopen this screen.", 12.5f, T.muted), lp(-1, -2)); return
        }
        val bonded = try { adapter.bondedDevices } catch (e: SecurityException) { null }
        if (bonded.isNullOrEmpty()) {
            list.addView(tv("No paired devices. Pair your ELM327 in Settings first.", 12.5f, T.muted), lp(-1, -2)); return
        }
        for (d in bonded) {
            val name = try { d.name ?: "Device" } catch (e: SecurityException) { "Device" }
            val addr = d.address
            val rrow = row().apply {
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = ripple(rounded(T.card, dpf(14f), T.stroke, dp(1)), dpf(14f)); isClickable = true
                setOnClickListener {
                    prefs().edit().putString("mode", "bt").putString("bt", addr).apply(); mode = "bt"
                    doConnect { obd.connectBluetooth(addr) }
                }
            }
            val cc = col()
            cc.addView(tv(name, 15f, T.white, true))
            cc.addView(tv(addr, 11f, T.muted).apply { setPadding(0, dp(3), 0, 0) })
            rrow.addView(cc, lp(0, -2, 1f))
            rrow.addView(tv("Connect", 12.5f, T.ink, true).apply {
                setPadding(dp(12), dp(7), dp(12), dp(7)); background = vgradient(dpf(10f), T.yellow, T.yellow2)
            }, lp(-2, -2))
            list.addView(rrow, lp(-1, -2).apply { bottomMargin = dp(8) })
        }
    }

    private fun doConnect(connector: () -> Boolean) {
        connectInfo?.text = "Connecting…"; connectInfo?.setTextColor(T.yellow)
        io.execute {
            val ok = connector()
            val inited = if (ok) obd.initEngine() else false
            if (ok) ui.post { connectInfo?.text = "Detecting VIN / ECUs…" }
            if (ok && inited) obd.autoDetect()
            ui.post {
                if (ok) {
                    obd.adapterName = "ELM327"
                    scanResults = null; freezeLines = null; freezeCode = null; actuatorLog.clear(); absLog = null; actuatorTests = null; absOthers = null
                    toast(if (inited) "Connected ✓  ${obd.ecus.size.coerceAtLeast(1)} ECU mile" else "Adapter connected (ECU jawab nahi de raha)")
                    backStack.clear(); show(Screen.DASHBOARD)
                } else {
                    connectInfo?.text = "Connection failed — check the adapter"
                    connectInfo?.setTextColor(T.red)
                    toast("Connect nahi hua")
                }
            }
        }
    }

    /** Online settings: code database, app update, AI key, GitHub repo. */
    private fun addOnlineSettings(body: LinearLayout) {
        body.addView(sectionHead("Online"), lp(-1, -2))

        val db = sectionCard("Fault code database")
        val dbInfo = tv("${DtcDb.size} codes · v${DtcDb.version} · ${DtcDb.source}", 13f, T.white, true)
        db.addView(dbInfo)
        db.addView(tv("Codes ki jaankari GitHub se aati hai. Wahan file badlo, sab phones par apne-aap aa jayegi.", 12f, T.muted).apply { setPadding(0, dp(6), 0, dp(10)) })
        db.addView(outline("↻ Codes update karo") {
            dbInfo.text = "Download ho raha hai…"
            net.execute { val m = DtcDb.refresh(this); ui.post { dbInfo.text = "${DtcDb.size} codes · v${DtcDb.version} · ${DtcDb.source}"; toast(m) } }
        }, lp(-1, dp(44)))
        body.addView(db, lp(-1, -2).apply { bottomMargin = dp(10) })

        val up = sectionCard("App update")
        val upInfo = tv("Is phone par: v${appVersion()}" + (updateInfo?.let { "\nNaya: v${it.version}" } ?: ""), 13f, T.white, true)
        up.addView(upInfo)
        val upRow = row().apply { setPadding(0, dp(10), 0, 0) }
        upRow.addView(outline("Update check karo") {
            upInfo.text = "Check ho raha hai…"
            net.execute {
                val (u, m) = Updater.check(this, appVersion())
                ui.post { updateInfo = u; upInfo.text = "Is phone par: v${appVersion()}\n$m"; if (u != null) show(Screen.CONNECT) }
            }
        }, lp(0, dp(44), 1f))
        updateInfo?.let { u -> upRow.addView(primary("Download v${u.version}") { openUrl(u.apkUrl) }, lp(0, dp(44), 1f).apply { marginStart = dp(8) }) }
        up.addView(upRow)
        body.addView(up, lp(-1, -2).apply { bottomMargin = dp(10) })

        val ai = sectionCard("AI salah")
        val has = !prefs().getString("ai_key", "").isNullOrBlank()
        val srv = OnlineConfig.aiUrl(this).isNotBlank()
        ai.addView(tv(when { has -> "Chalu ✓ (is phone ki apni key)"; srv -> "Chalu ✓ (YAGAMI server, key ki zaroorat nahi)"; else -> "YAGAMI server abhi set nahi hua" },
            12.5f, if (has || srv) T.green else T.muted, true))
        ai.addView(tv("Apni Gemini key (optional, sirf advanced use)", 11.5f, T.muted).apply { setPadding(0, dp(10), 0, dp(6)) })
        val key = field("").apply { hint = "AIza…"; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD }
        ai.addView(key, lp(-1, dp(48)))
        val aiRow = row().apply { setPadding(0, dp(10), 0, 0) }
        aiRow.addView(primary("Save key") {
            val k = key.text.toString().trim()
            if (k.length < 20) toast("Poori key paste karein") else { prefs().edit().putString("ai_key", k).apply(); toast("Key save ho gayi"); show(Screen.CONNECT) }
        }, lp(0, dp(44), 1f))
        if (has) aiRow.addView(outline("Hatao") { prefs().edit().remove("ai_key").apply(); show(Screen.CONNECT) }, lp(0, dp(44), 1f).apply { marginStart = dp(8) })
        ai.addView(aiRow)
        body.addView(ai, lp(-1, -2).apply { bottomMargin = dp(10) })

        val pr = sectionCard("Products (Google Sheet)")
        val prInfo = tv(if (ProductDb.items.isEmpty()) "Abhi koi product nahi" else "${ProductDb.items.size} products · update ${ago(ProductDb.updated)}", 13f, T.white, true)
        pr.addView(prInfo)
        pr.addView(tv("Google Drive ki 'YAGAMI Products' sheet se aata hai (link pehle se set hai). Sheet badlo, app mein apne-aap badlega.", 12f, T.muted).apply { setPadding(0, dp(6), 0, dp(10)) })
        val prUrl = field(ProductDb.url(this)).apply { hint = "https://docs.google.com/…output=csv" }
        pr.addView(prUrl, lp(-1, dp(48)))
        val wa = field(prefs().getString("wa_number", "").orEmpty()).apply { hint = "Order WhatsApp number (9876543210)"; inputType = android.text.InputType.TYPE_CLASS_PHONE }
        pr.addView(wa, lp(-1, dp(48)).apply { topMargin = dp(8) })
        val prRow = row().apply { setPadding(0, dp(10), 0, 0) }
        prRow.addView(primary("Save + Refresh") {
            prefs().edit().putString("products_url", prUrl.text.toString().trim()).putString("wa_number", wa.text.toString().trim()).apply()
            prInfo.text = "Download ho raha hai…"
            net.execute { val m = ProductDb.refresh(this); ui.post { prInfo.text = m } }
        }, lp(0, dp(44), 1f))
        pr.addView(prRow)
        body.addView(pr, lp(-1, -2).apply { bottomMargin = dp(10) })

        val nt = sectionCard("Notifications")
        val pushOk = Push.available(this)
        nt.addView(tv(when {
            !pushOk -> "Is build mein Firebase set nahi hai. google-services.json milte hi chalu ho jayega."
            !notifAllowed() -> "Notification permission band hai."
            else -> "Chalu ✓ · topics: all" + (Push.topicFor(brand)?.let { ", $it" } ?: "")
        }, 12.5f, if (pushOk && notifAllowed()) T.green else T.muted, true))
        if (pushOk && !notifAllowed()) nt.addView(outline("Permission do") {
            if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2)
        }, lp(-1, dp(44)).apply { topMargin = dp(10) })
        body.addView(nt, lp(-1, -2).apply { bottomMargin = dp(10) })

        val gh = sectionCard("GitHub repo (codes + updates)")
        val repo = field(OnlineConfig.repo(this))
        gh.addView(repo, lp(-1, dp(48)))
        gh.addView(outline("Save repo") {
            val r = repo.text.toString().trim().removePrefix("https://github.com/").trim('/')
            if (r.count { it == '/' } != 1) toast("owner/repo likhein") else { prefs().edit().putString("repo", r).apply(); toast("Repo save ho gaya") }
        }, lp(-1, dp(44)).apply { topMargin = dp(10) })
        body.addView(gh, lp(-1, -2))
    }

    // ================= Products =================

    private var prodAll = false            // false = only this bike
    private var prodCat: String? = null
    private var prodQuery = ""
    private var selectedProduct: Product? = null

    private fun productImage(p: Product, h: Int, corner: Float): FrameLayout {
        val f = FrameLayout(this).apply { background = rounded(T.cardHi, dpf(corner)); clipToOutline = true }
        f.addView(IconView(this, "bag", T.muted), FrameLayout.LayoutParams(dp(30), dp(30), Gravity.CENTER))
        if (p.image.isNotBlank()) {
            val iv = android.widget.ImageView(this).apply { scaleType = android.widget.ImageView.ScaleType.CENTER_CROP }
            f.addView(iv, FrameLayout.LayoutParams(-1, -1))
            Images.load(this, p.image, iv, dp(h))
        }
        return f
    }

    private fun productCard(p: Product, width: Int = -1): LinearLayout = col().apply {
        background = ripple(rounded(T.card, dpf(16f), T.stroke, dp(1)), dpf(16f)); clipToOutline = true
        isClickable = true; setOnClickListener { selectedProduct = p; navigate(Screen.PRODUCT) }
        addView(productImage(p, 120, 0f), lp(-1, dp(120)))
        val c = col().apply { setPadding(dp(12), dp(10), dp(12), dp(12)) }
        if (p.category.isNotBlank()) c.addView(tv(p.category.uppercase(), 10f, T.muted, true).apply { letterSpacing = 0.1f; maxLines = 1 })
        c.addView(tv(p.name, 14f, T.white, true).apply { maxLines = 2; setPadding(0, dp(3), 0, 0) })
        c.addView(tv(p.price.ifBlank { "Price ke liye poochhein" }, if (p.price.isBlank()) 12f else 16f, T.yellow, true).apply { setPadding(0, dp(6), 0, 0) })
        addView(c, lp(-1, -2))
    }

    private fun waNumber(): String = prefs().getString("wa_number", "").orEmpty().filter { it.isDigit() }

    private fun orderOnWhatsApp(p: Product) {
        val n = waNumber()
        if (n.isBlank()) { toast("WhatsApp number set nahi hai (Connect → Online)"); return }
        val num = if (n.length == 10) "91$n" else n
        val bike = listOfNotNull(brand, model).joinToString(" ")
        val msg = "Namaste YAGAMI, mujhe ye product chahiye:\n${p.name}" + (if (p.price.isNotBlank()) " (${p.price})" else "") + (if (bike.isNotBlank()) "\nBike: $bike" else "")
        openUrl("https://wa.me/$num?text=" + java.net.URLEncoder.encode(msg, "UTF-8"))
    }

    private fun buildProducts() {
        val (root, body) = shell(appBar(), Tab.PRODUCTS)
        val bike = listOfNotNull(brand, model).joinToString(" ")
        pageTitle(body, "Products", if (bike.isBlank()) "YAGAMI ke products" else "$bike ke liye YAGAMI products")
        val all = ProductDb.items
        if (all.isEmpty()) {
            body.addView(banner("SETUP", "Abhi koi product nahi. Google Drive ki 'YAGAMI Products' sheet mein products likho, phir Refresh dabao."), lp(-1, -2).apply { bottomMargin = dp(12) })
            val st = tv("", 13f, T.muted)
            body.addView(primary("↻ Refresh") {
                st.text = "Download ho raha hai…"
                net.execute { val m = ProductDb.refresh(this); ui.post { toast(m); if (screen == Screen.PRODUCTS) buildProducts() } }
            }, lp(-1, dp(50)))
            body.addView(st.apply { setPadding(dp(2), dp(10), 0, 0) }, lp(-1, -2))
            body.addView(ghost("Settings kholo") { goTab(Tab.CONNECT) }, lp(-1, dp(48)).apply { topMargin = dp(8) })
            setContentView(root); return
        }
        val top = row()
        top.addView(segmented(listOf("Is bike ke liye", "Sab products"), if (prodAll || bike.isBlank()) 1 else 0) { prodAll = it == 1; buildProducts() }, lp(-2, -2))
        top.addView(View(this), lp(0, 1, 1f))
        top.addView(outline("↻") {
            net.execute { val m = ProductDb.refresh(this); ui.post { toast(m); if (screen == Screen.PRODUCTS) buildProducts() } }
        }.apply { setPadding(dp(14), dp(8), dp(14), dp(8)) }, lp(-2, -2))
        body.addView(top, lp(-1, -2))
        val cats = all.map { it.category }.filter { it.isNotBlank() }.distinct()
        if (cats.size > 1) body.addView(chipRow(listOf(filterChip("Sab", prodCat == null) { prodCat = null; buildProducts() }) +
            cats.map { c -> filterChip(c, prodCat == c) { prodCat = c; buildProducts() } }), lp(-1, -2).apply { topMargin = dp(10) })
        val gridBox = col()
        fun fill(q: String) {
            gridBox.removeAllViews()
            val list = all.filter { p ->
                (prodAll || bike.isBlank() || p.fits(brand, model)) && (prodCat == null || p.category == prodCat) &&
                    (q.isBlank() || p.name.contains(q, true) || p.category.contains(q, true) || p.description.contains(q, true))
            }
            gridBox.addView(tv("${list.size} product(s)", 12.5f, T.muted).apply { setPadding(dp(2), 0, 0, dp(10)) }, lp(-1, -2))
            if (list.isEmpty()) gridBox.addView(card().apply {
                addView(tv(if (!prodAll && bike.isNotBlank()) "Is bike ke liye koi product nahi mila. 'Sab products' dekho." else "Kuch nahi mila.", 13.5f, T.white))
            }, lp(-1, -2))
            else grid(gridBox, 2, list.map { productCard(it) })
        }
        body.addView(field(prodQuery).apply {
            hint = "⌕  Product dhoondo"
            addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: android.text.Editable?) { prodQuery = s?.toString().orEmpty(); fill(prodQuery) }
            })
        }, lp(-1, dp(48)).apply { topMargin = dp(10); bottomMargin = dp(12) })
        body.addView(gridBox, lp(-1, -2))
        fill(prodQuery)
        if (ProductDb.updated > 0) body.addView(tv("List update: ${ago(ProductDb.updated)}", 11.5f, T.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(10), 0, 0) }, lp(-1, -2))
        setContentView(root)
    }

    private fun buildProduct() {
        val p = selectedProduct ?: return show(Screen.PRODUCTS)
        val (root, body) = shell(detailBar(p.category.ifBlank { "Product" }, p.name, if (p.fits(brand, model) && model != null) "Fits ✓" else null, T.green), Tab.PRODUCTS)
        body.addView(productImage(p, 260, 16f), lp(-1, dp(240)).apply { bottomMargin = dp(12) })
        val c = card()
        c.addView(tv(p.name, 20f, T.white, true))
        c.addView(tv(p.price.ifBlank { "Price ke liye poochhein" }, 22f, T.yellow, true).apply { setPadding(0, dp(8), 0, 0) })
        if (p.description.isNotBlank()) c.addView(tv(p.description, 14f, T.muted).apply { setPadding(0, dp(10), 0, 0) })
        body.addView(c, lp(-1, -2).apply { bottomMargin = dp(10) })
        body.addView(kvGrid(listOf("Category" to p.category.ifBlank { "—" }, "Bikes" to p.bikes.ifBlank { "All" })), lp(-1, -2).apply { bottomMargin = dp(12) })
        if (waNumber().isNotBlank()) body.addView(tv("WhatsApp par order karo", 15.5f, Color.WHITE, true).apply {
            gravity = Gravity.CENTER; isClickable = true
            background = ripple(rounded(Color.parseColor("#1FAE54"), dpf(12f)), dpf(12f))
            setOnClickListener { orderOnWhatsApp(p) }
        }, lp(-1, dp(52)).apply { bottomMargin = dp(10) })
        if (p.link.isNotBlank()) body.addView(ghost("Website par dekho") { openUrl(p.link) }, lp(-1, dp(48)))
        setContentView(root)
    }

    /** Home strip: products that fit the selected bike. */
    private fun addHomeProducts(body: LinearLayout) {
        val fits = ProductDb.items.filter { it.fits(brand, model) }
        if (fits.isEmpty()) return
        body.addView(sectionHead("Products for your bike", "View all (${fits.size})") { goTab(Tab.PRODUCTS) }, lp(-1, -2))
        val r = row().apply { gravity = Gravity.TOP }
        fits.take(8).forEachIndexed { i, p -> r.addView(productCard(p), lp(dp(150), -2).apply { if (i > 0) marginStart = dp(10) }) }
        body.addView(android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(r) }, lp(-1, -2))
    }

    // ================= Code detail =================

    private fun buildCode() {
        val (code, kind, ecu) = selectedCode ?: return show(Screen.SCAN)
        val clr = if (kind == "Stored") T.red else if (kind == "Pending") T.orange else T.purple
        val (root, body) = shell(detailBar("Fault code", code, kind, clr), Tab.SCAN)
        val e = DtcDb.get(code)
        val top = card()
        top.addView(tv(Data.describe(code), 18f, T.white, true))
        top.addView(tv(ecu, 12.5f, T.muted).apply { setPadding(0, dp(4), 0, 0) })
        body.addView(top, lp(-1, -2).apply { bottomMargin = dp(10) })
        if (e == null || (e.causes.isEmpty() && e.checks.isEmpty())) {
            body.addView(banner("INFO", "Is code ki poori jaankari database mein nahi hai. Ye company-specific ho sakta hai. 'AI salah' se poochh sakte ho ya service manual dekhein."), lp(-1, -2).apply { bottomMargin = dp(10) })
        } else {
            val c1 = sectionCard("Sambhavit kaaran")
            e.causes.forEach { c1.addView(tv("•  $it", 14f, T.white).apply { setPadding(0, dp(4), 0, dp(4)) }) }
            body.addView(c1, lp(-1, -2).apply { bottomMargin = dp(10) })
            val c2 = sectionCard("Jaanch kaise karein")
            e.checks.forEachIndexed { i, t -> c2.addView(tv("${i + 1}.  $t", 14f, T.white).apply { setPadding(0, dp(4), 0, dp(4)) }) }
            body.addView(c2, lp(-1, -2).apply { bottomMargin = dp(10) })
        }
        body.addView(tv("Database v${DtcDb.version} · ${DtcDb.source}", 11.5f, T.muted).apply { setPadding(dp(2), 0, 0, dp(10)) }, lp(-1, -2))
        val b = row()
        b.addView(ghost("Freeze frame") { navigate(Screen.FREEZE) }, lp(0, dp(50), 1f).apply { marginEnd = dp(10) })
        b.addView(primary("AI salah") { navigate(Screen.AI) }, lp(0, dp(50), 1f))
        body.addView(b, lp(-1, -2))
        body.addView(danger("Clear codes") { ensureConnected { navigate(Screen.CLEAR_DTC) } }, lp(-1, dp(48)).apply { topMargin = dp(10) })
        setContentView(root)
    }

    // ================= AI salah =================

    private fun aiPrompt(): String {
        val sb = StringBuilder()
        sb.append("Bike: ").append(listOfNotNull(brand, model).joinToString(" ").ifBlank { "pata nahi" }).append('\n')
        sb.append("Protocol: ").append(obd.protocol).append('\n')
        if (lastBattery.isNotBlank()) sb.append("Battery: ").append(lastBattery).append('\n')
        val res = scanResults
        if (res == null) sb.append("Fault codes: scan nahi hua\n") else {
            sb.append("Fault codes:\n")
            for ((ecu, l) in res) {
                if (l.isEmpty()) sb.append("- ").append(ecu).append(": koi code nahi\n")
                for ((c, k) in l) sb.append("- ").append(c).append(" [").append(k).append(", ").append(ecu).append("] ").append(Data.describe(c)).append('\n')
            }
        }
        if (freezeCode != null) {
            sb.append("Freeze frame (").append(freezeCode).append("):\n")
            freezeLines.orEmpty().forEach { (k, v) -> sb.append("- ").append(k).append(": ").append(v).append('\n') }
        }
        if (lastLive.isNotEmpty()) { sb.append("Live data (aakhri reading):\n"); lastLive.forEach { (k, v) -> sb.append("- ").append(k).append(": ").append(v).append('\n') } }
        selectedCode?.let { sb.append("\nKhaas taur par is code ke baare mein batao: ").append(it.first).append('\n') }
        sb.append("\nBatao: 1) sabse sambhavit kaaran kya hai, 2) mechanic kis order mein kya check kare, 3) kya bike chalana safe hai. Chhota rakho.")
        return sb.toString()
    }

    private fun buildAi() {
        val focus = selectedCode?.first
        if (focus != aiFocus) { aiAnswer = null; aiFocus = focus }
        val (root, body) = shell(detailBar("AI salah", focus ?: "Poori bike", "Online", T.green), Tab.HOME)
        val key = prefs().getString("ai_key", "").orEmpty()
        val server = OnlineConfig.aiUrl(this)
        if (key.isBlank() && server.isBlank()) {
            body.addView(banner("SOON", "AI salah abhi chalu nahi hua. Internet on rakhein; YAGAMI server set hote hi apne-aap chalu ho jayega."), lp(-1, -2).apply { bottomMargin = dp(12) })
            body.addView(primary("↻ Check karo") {
                net.execute { OnlineConfig.refreshRemote(this); ui.post { if (screen == Screen.AI) buildAi() } }
            }, lp(-1, dp(50)))
            setContentView(root); return
        }
        if (scanResults == null && focus == null) body.addView(banner("TIP", "Pehle All ECU Scan chalao, taaki AI ko codes mil sakein."), lp(-1, -2).apply { bottomMargin = dp(12) })
        val what = sectionCard("AI ko ye bheja jayega")
        what.addView(tv(aiPrompt().substringBefore("\nBatao:"), 12f, T.muted).apply { typeface = Typeface.MONOSPACE })
        what.addView(tv("Google Gemini (free) ko jayega. Free tier ka data Google apni service sudharne mein use kar sakta hai.", 11.5f, T.muted).apply { setPadding(0, dp(8), 0, 0) })
        body.addView(what, lp(-1, -2).apply { bottomMargin = dp(10) })
        val out = tv(aiAnswer ?: "", 14f, T.white).apply { setTextIsSelectable(true) }
        val outCard = sectionCard("AI ka jawab").apply { addView(out) }
        val ask = primary(if (aiAnswer == null) "AI se salah lo" else "↻ Dobara poochho") {}
        ask.setOnClickListener {
            out.text = "Soch raha hai… (10–20 second)"; out.setTextColor(T.yellow); ask.isEnabled = false
            val prompt = aiPrompt()
            net.execute {
                val ans = try {
                    if (key.isNotBlank()) Ai.ask(key, prompt) else Ai.askServer(server, OnlineConfig.deviceId(this), prompt)
                } catch (e: Exception) { "Internet se nahi mila: ${e.message ?: e.javaClass.simpleName}" }
                ui.post { aiAnswer = ans; ask.isEnabled = true; if (screen == Screen.AI) { out.text = ans; out.setTextColor(T.white) } }
            }
        }
        body.addView(ask, lp(-1, dp(50)).apply { bottomMargin = dp(10) })
        body.addView(outCard, lp(-1, -2))
        body.addView(tv("AI ki salah mechanic ki jaanch ki jagah nahi le sakti. Brakes/ABS ki problem ho to bike na chalayein.", 11.5f, T.muted).apply { setPadding(dp(2), dp(10), dp(2), 0) }, lp(-1, -2))
        body.addView(ghost("Share") {
            val t = "YAGAMI AI salah (${listOfNotNull(brand, model).joinToString(" ")})\n\n" + (aiAnswer ?: "")
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, t) }, "Share"))
        }, lp(-1, dp(48)).apply { topMargin = dp(10) })
        setContentView(root)
    }

    // ================= All-ECU Scan (Read DTC) =================

    private var scanFilter = 0          // 0 all, 1 stored, 2 pending, 3 permanent
    private var ecuFilter: String? = null
    private var scanning = false

    private fun buildScan() {
        val (root, body) = shell(appBar(), Tab.SCAN)
        pageTitle(body, "Fault Codes", "Har ECU ke stored, pending aur permanent codes.")
        val res = scanResults
        if (res == null) {
            body.addView(banner("SCANNING", "Har ECU scan ho raha hai… engine band, ignition ON rakhein."), lp(-1, -2))
            val status = tv("", 13f, T.muted).apply { setPadding(dp(2), dp(12), 0, 0) }
            body.addView(status, lp(-1, -2))
            setContentView(root)
            if (!scanning) runScan(status)
            return
        }
        // filters
        val top = row()
        top.addView(segmented(listOf("All", "Stored", "Pending", "Perm."), scanFilter) { scanFilter = it; buildScan() }, lp(-2, -2))
        top.addView(View(this), lp(0, 1, 1f))
        top.addView(outline("↻ Rescan") { scanResults = null; show(Screen.SCAN) }.apply { setPadding(dp(12), dp(8), dp(12), dp(8)) }, lp(-2, -2))
        body.addView(top, lp(-1, -2))
        if (res.size > 1) body.addView(chipRow(listOf(filterChip("All ECUs", ecuFilter == null) { ecuFilter = null; buildScan() }) +
            res.keys.map { e -> filterChip(e, ecuFilter == e) { ecuFilter = e; buildScan() } }), lp(-1, -2).apply { topMargin = dp(10) })

        val kindOf = listOf(null, "Stored", "Pending", "Permanent")[scanFilter]
        val items = res.flatMap { (ecu, l) -> l.map { Triple(it.first, it.second, ecu) } }
            .filter { (kindOf == null || it.second == kindOf) && (ecuFilter == null || it.third == ecuFilter) }
        body.addView(tv("${items.size} code(s) · ${res.size} ECU scanned · ${ago(scanTime)}", 12.5f, T.muted).apply { setPadding(dp(2), dp(12), 0, dp(10)) }, lp(-1, -2))

        if (items.isEmpty()) {
            val (o, i) = edgeCard(T.green)
            i.addView(tv("ALL CLEAR", 11f, T.green, true).apply { letterSpacing = 0.12f })
            i.addView(tv("Koi fault code nahi mila", 16f, T.white, true).apply { setPadding(0, dp(6), 0, 0) })
            i.addView(tv(res.keys.joinToString(" · "), 12.5f, T.muted).apply { setPadding(0, dp(4), 0, 0) })
            body.addView(o, lp(-1, -2))
        }
        for ((code, kind, ecu) in items) {
            val c = if (kind == "Stored") T.red else if (kind == "Pending") T.orange else T.purple
            val (o, i) = edgeCard(c)
            val h = row()
            h.addView(tv("${kind.uppercase()} · ${ecu.uppercase()}", 11f, c, true).apply { letterSpacing = 0.1f }, lp(0, -2, 1f))
            h.addView(tv(ago(scanTime), 12f, T.muted), lp(-2, -2))
            i.addView(h)
            i.addView(tv(code, 17f, T.white, true).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); setPadding(0, dp(8), 0, 0) })
            i.addView(tv(Data.describe(code), 13f, T.muted).apply { setPadding(0, dp(4), 0, dp(12)) })
            val b = row()
            b.addView(outline("Details") { selectedCode = Triple(code, kind, ecu); navigate(Screen.CODE) }, lp(0, dp(42), 1f).apply { marginEnd = dp(8) })
            b.addView(outline("AI salah") { selectedCode = Triple(code, kind, ecu); navigate(Screen.AI) }, lp(0, dp(42), 1f))
            i.addView(b)
            body.addView(o, lp(-1, -2).apply { bottomMargin = dp(10) })
        }
        if (res.size == 1 && obd.isCan) body.addView(tv("Sirf ek ECU ne generic OBD request ka jawab diya.", 11.5f, T.muted).apply { setPadding(dp(2), dp(4), 0, 0) }, lp(-1, -2))
        val bb = row().apply { setPadding(0, dp(12), 0, 0) }
        bb.addView(ghost("AI salah") { selectedCode = null; navigate(Screen.AI) }, lp(0, dp(50), 1f).apply { marginEnd = dp(10) })
        bb.addView(primary("Share Report") { shareReport() }, lp(0, dp(50), 1f))
        body.addView(bb, lp(-1, -2))
        setContentView(root)
    }

    private fun runScan(status: TextView) {
        scanning = true
        io.execute {
            if (!obd.detected) obd.autoDetect()
            val targets: List<String?> = if (obd.isCan && obd.ecus.size > 1) obd.ecus else listOf(obd.ecus.firstOrNull())
            val res = LinkedHashMap<String, List<Pair<String, String>>>()
            for ((n, addr) in targets.withIndex()) {
                val label = if (addr == null) "Engine ECU" else Elm.ecuLabel(addr)
                ui.post { status.text = "${n + 1}/${targets.size} · $label" }
                val one = ArrayList<Pair<String, String>>()
                obd.readStored(addr).forEach { one.add(it to "Stored") }
                obd.readPending(addr).forEach { c -> if (one.none { it.first == c }) one.add(c to "Pending") }
                obd.readPermanent(addr).forEach { c -> if (one.none { it.first == c }) one.add(c to "Permanent") }
                res[label] = one
            }
            ui.post {
                scanning = false
                scanResults = res; scanTime = System.currentTimeMillis(); scanFilter = 0; ecuFilter = null
                if (screen == Screen.SCAN) buildScan()
            }
        }
    }

    private fun dtcCard(code: String, kind: String): LinearLayout {
        val c = if (kind == "Pending") T.orange else if (kind == "Permanent") T.purple else T.red
        val (o, i) = edgeCard(c)
        i.addView(tv(kind.uppercase(), 11f, c, true).apply { letterSpacing = 0.12f })
        i.addView(tv(code, 17f, T.white, true).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); setPadding(0, dp(8), 0, 0) })
        i.addView(tv(Data.describe(code), 13f, T.muted).apply { setPadding(0, dp(4), 0, 0) })
        return o
    }

    // ================= Clear DTC =================

    private fun buildClearDtc() {
        val (root, body) = shell(detailBar("Clear DTC", "Mode 04", "Confirm", T.orange), Tab.SCAN)
        val warn = card().apply { gravity = Gravity.CENTER_HORIZONTAL; background = vgradient(dpf(16f), alpha(T.red, 34), T.card).apply { setStroke(dp(1), alpha(T.red, 110)) } }
        warn.addView(tv("⚠", 40f, T.orange).apply { gravity = Gravity.CENTER }, lp(-2, -2))
        warn.addView(tv("Are you sure?", 20f, T.white, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0) }, lp(-2, -2))
        warn.addView(tv("Saare stored fault codes aur freeze frame mit jayenge, aur check-engine (MIL) light band ho jayegi. Engine band, ignition ON rakhein.", 13f, T.muted).apply {
            gravity = Gravity.CENTER; setPadding(dp(8), dp(8), dp(8), 0)
        }, lp(-1, -2))
        body.addView(warn, lp(-1, -2).apply { bottomMargin = dp(14) })
        val result = tv("", 13.5f, T.green, true).apply { gravity = Gravity.CENTER }
        val btns = row()
        btns.addView(ghost("Cancel") { onBackPressed() }, lp(0, dp(52), 1f).apply { marginEnd = dp(10) })
        btns.addView(danger("Yes, Clear") {
            result.text = "Clearing…"; result.setTextColor(T.yellow)
            io.execute {
                val reply = obd.clear()
                val ok = reply.joinToString(" ").uppercase().contains("44")
                ui.post {
                    if (ok) { result.text = "✓ Fault codes cleared successfully"; result.setTextColor(T.green); scanResults = null; freezeLines = null; freezeCode = null }
                    else { result.text = "ECU ne clear confirm nahi kiya. Raw: " + reply.joinToString(" ").ifBlank { "no reply" }; result.setTextColor(T.red) }
                }
            }
        }, lp(0, dp(52), 1f))
        body.addView(btns, lp(-1, -2))
        body.addView(result, lp(-1, -2).apply { topMargin = dp(16) })
        setContentView(root)
    }

    // ================= Live Data with graphs =================

    data class LivePid(val key: String, val label: String, val pid: Int, val unit: String, val max: Float, val accent: Int)

    private val allLivePids = listOf(
        LivePid("rpm", "Engine RPM", 0x0C, "rpm", 9000f, T.yellow),
        LivePid("speed", "Speed", 0x0D, "km/h", 160f, T.blue),
        LivePid("coolant", "Engine Temp", 0x05, "°C", 150f, T.red),
        LivePid("throttle", "Throttle", 0x11, "%", 100f, T.green),
        LivePid("iat", "Intake Air", 0x0F, "°C", 100f, T.cyan),
        LivePid("load", "Engine Load", 0x04, "%", 100f, T.purple),
        LivePid("map", "Intake Pressure", 0x0B, "kPa", 120f, T.orange),
        LivePid("timing", "Ignition Timing", 0x0E, "°", 60f, T.yellow),
        LivePid("o2", "O2 Sensor", 0x14, "V", 1.3f, T.green),
        LivePid("stft", "Fuel Trim (ST)", 0x06, "%", 30f, T.cyan),
        LivePid("ecuv", "ECU Voltage", 0x42, "V", 16f, T.blue)
    )

    /** Only the PIDs the ECU says it supports (falls back to the basic six when it reports nothing). */
    private fun livePidsFor(sup: Set<Int>): List<LivePid> =
        if (sup.isEmpty()) allLivePids.take(6) else allLivePids.filter { it.pid in sup }.ifEmpty { allLivePids.take(6) }

    private class LiveCell(val value: TextView, val graph: GraphView)
    private val cells = HashMap<String, LiveCell>()
    private var battView: TextView? = null

    private fun buildLive() {
        cells.clear()
        val (root, body) = shell(appBar(), Tab.LIVE)
        pageTitle(body, "Live Data", listOfNotNull(brand, model).joinToString(" ").ifBlank { "Engine sensors" })
        val pids = livePidsFor(obd.supported)
        body.addView(row().apply {
            addView(badge("● LIVE", T.green), lp(-2, -2))
            addView(tv("  ${pids.size} sensors · updates every second", 11.5f, T.muted), lp(0, -2, 1f))
        }, lp(-1, -2).apply { bottomMargin = dp(10) })
        for (p in pids) {
            val c = card().apply { setPadding(dp(14), dp(12), dp(14), dp(10)) }
            val head = row()
            head.addView(tv(p.label, 12f, T.muted, true), lp(0, -2, 1f))
            val v = tv("—", 22f, p.accent, true)
            head.addView(v, lp(-2, -2))
            head.addView(tv(" ${p.unit}", 11.5f, T.muted), lp(-2, -2))
            c.addView(head)
            val g = GraphView(this, p.accent).apply { fixedMax = p.max * 0.25f }
            c.addView(g, lp(-1, dp(56)).apply { topMargin = dp(8) })
            cells[p.key] = LiveCell(v, g)
            body.addView(c, lp(-1, -2).apply { bottomMargin = dp(10) })
        }
        val bv = tv("Battery: —", 14f, T.white, true).apply { gravity = Gravity.CENTER; setPadding(dp(12), dp(12), dp(12), dp(12)); background = rounded(T.card, dpf(14f), T.stroke, dp(1)) }
        battView = bv
        body.addView(bv, lp(-1, -2))
        body.addView(tv("Engine chalu rakhein. Graph pichhle 60 readings dikhata hai.", 11.5f, T.muted).apply { gravity = Gravity.CENTER; setPadding(0, dp(10), 0, 0) }, lp(-1, -2))
        setContentView(root)
        startLive(pids)
    }

    private fun startLive(pids: List<LivePid>) {
        stopLive()
        var busy = false
        val loop = object : Runnable {
            override fun run() {
                if (!busy) {
                    busy = true
                    io.execute {
                        val vals = HashMap<String, Pair<Float, String>>()
                        for (p in pids) {
                            val pl = obd.livePid("%02X".format(p.pid)) ?: continue
                            val v = computeLive(p.key, pl) ?: continue
                            vals[p.key] = v
                        }
                        val batt = obd.battery()
                        ui.post {
                            busy = false
                            for ((k, v) in vals) cells[k]?.let { it.value.text = v.second; it.graph.add(v.first) }
                            for (p in pids) vals[p.key]?.let { lastLive[p.label] = "${it.second} ${p.unit}" }
                            if (batt.isNotBlank()) { battView?.text = "Battery: $batt"; lastBattery = batt }
                        }
                    }
                }
                ui.postDelayed(this, 1000)
            }
        }
        liveLoop = loop
        ui.postDelayed(loop, 150)
    }

    private fun stopLive() { liveLoop?.let { ui.removeCallbacks(it) }; liveLoop = null }

    private fun computeLive(key: String, p: IntArray): Pair<Float, String>? {
        if (p.isEmpty()) return null
        val a = p[0]; val b = if (p.size > 1) p[1] else 0
        fun f1(v: Float) = "%.1f".format(v)
        return when (key) {
            "rpm" -> { val v = (a * 256 + b) / 4f; v to "${Math.round(v)}" }
            "speed" -> a.toFloat() to "$a"
            "coolant", "iat" -> (a - 40).toFloat() to "${a - 40}"
            "throttle", "load" -> { val v = a * 100f / 255f; v to "${Math.round(v)}" }
            "map" -> a.toFloat() to "$a"
            "timing" -> { val v = a / 2f - 64f; v to f1(v) }
            "o2" -> { val v = a / 200f; v to "%.2f".format(v) }
            "stft" -> { val v = (a - 128) * 100f / 128f; v to f1(v) }
            "ecuv" -> { if (p.size < 2) null else { val v = (a * 256 + b) / 1000f; v to f1(v) } }
            else -> null
        }
    }

    // ================= Freeze Frame =================

    private fun buildFreeze() {
        val (root, body) = shell(detailBar("Freeze frame", "Mode 02", freezeCode, T.red), Tab.HOME)
        val status = tv("❄  Freeze frame padh raha hoon…", 15f, T.cyan, true).apply { setPadding(dp(2), dp(4), 0, dp(10)) }
        body.addView(status, lp(-1, -2))
        val list = col()
        body.addView(list, lp(-1, -2))
        setContentView(root)
        io.execute {
            val code = obd.freezeDtc()
            val rows = ArrayList<Pair<String, String>>()
            if (code != null) {
                for (p in allLivePids) {
                    val pl = obd.freezePid(p.pid) ?: continue
                    val v = computeLive(p.key, pl) ?: continue
                    rows.add(p.label to "${v.second} ${p.unit}")
                }
            }
            freezeCode = code; freezeLines = rows
            ui.post {
                if (screen != Screen.FREEZE) return@post
                if (code == null) {
                    status.text = "Koi freeze frame stored nahi hai"; status.setTextColor(T.muted)
                    list.addView(card().apply {
                        addView(tv("ECU ne mode 02 (freeze frame) ka data nahi diya. Ya to koi fault code nahi hai, ya ye bike freeze frame support nahi karti.", 13f, T.white))
                    }, lp(-1, -2))
                } else {
                    status.text = "Fault: $code"; status.setTextColor(T.red)
                    list.addView(dtcCard(code, "Freeze"), lp(-1, -2).apply { bottomMargin = dp(10) })
                    if (rows.isEmpty()) list.addView(card().apply { addView(tv("Is fault ke saath koi sensor value save nahi hui.", 13f, T.muted)) }, lp(-1, -2))
                    else list.addView(kvGrid(rows), lp(-1, -2))
                }
                body.addView(primary("Share Report") { shareReport() }, lp(-1, dp(48)).apply { topMargin = dp(12) })
            }
        }
    }

    // ================= ECU Info =================

    private fun buildEcuInfo() {
        val (root, body) = shell(detailBar("VIN", obd.vin ?: "ECU Information", if (obd.isCan) "CAN" else "K-line", T.blue), Tab.HOME)
        val c = card()
        body.addView(c, lp(-1, -2))
        c.addView(tv("Reading…", 14f, T.muted))
        setContentView(root)
        io.execute {
            obd.autoDetect()
            val batt = obd.battery()
            ui.post {
                if (screen != Screen.ECU_INFO) return@post
                lastBattery = batt
                c.removeAllViews(); c.setPadding(0, 0, 0, 0); c.background = null
                c.addView(kvGrid(listOf(
                    "VIN" to (obd.vin ?: "Not reported"), "ECU name" to (obd.ecuName ?: "Not reported"),
                    "Calibration" to (obd.calId ?: "Not reported"), "Bus type" to (if (obd.isCan) "CAN" else "K-line / other"),
                    "Protocol" to obd.protocol.ifBlank { "—" }, "Battery" to batt.ifBlank { "—" },
                    "Adapter" to obd.adapterName, "Bike" to listOfNotNull(brand, model).joinToString(" ")
                ), highlight = setOf("Battery")), lp(-1, -2))
                body.addView(sectionTitle("ECUs detected (${obd.ecus.size})"), lp(-1, -2))
                val e = card()
                if (obd.ecus.isEmpty()) e.addView(tv("Headers se ECU address nahi mila (kuch K-line adapters address nahi dikhate).", 12.5f, T.muted))
                for (a in obd.ecus) e.addView(row().apply {
                    setPadding(0, dp(6), 0, dp(6))
                    addView(tv(Elm.ecuLabel(a), 13.5f, T.white, true), lp(0, -2, 1f))
                    addView(badge(a, T.blue), lp(-2, -2))
                })
                body.addView(e, lp(-1, -2))
                body.addView(sectionTitle("Supported live sensors (${obd.supported.size} PIDs)"), lp(-1, -2))
                body.addView(card().apply {
                    addView(tv(livePidsFor(obd.supported).joinToString(" · ") { it.label }, 12.5f, T.white))
                }, lp(-1, -2))
            }
        }
    }

    private fun kv(k: String, v: String): LinearLayout {
        val r = row().apply { setPadding(0, dp(8), 0, dp(8)) }
        r.addView(tv(k, 13f, T.muted, true), lp(dp(110), -2))
        r.addView(tv(v, 13.5f, T.white, true), lp(0, -2, 1f))
        return r
    }

    // ================= Actuator Test =================

    private fun buildActuator() {
        val (root, body) = shell(detailBar("Actuator test", "Mode 08", "Confirm first", T.orange), Tab.HOME)
        val info = card().apply { background = vgradient(dpf(16f), alpha(T.orange, 30), T.card).apply { setStroke(dp(1), alpha(T.orange, 90)) } }
        info.addView(tv("Dhyan rahe", 14f, T.orange, true))
        info.addView(tv("Fan, injector, fuel pump jaise tests har company ke apne commands se chalte hain. Generic ELM327 sirf standard OBD mode 08 bhej sakta hai. App pehle ECU se poochhega ki kaunse tests support hain; jo support nahi, wo nahi chalega. Koi result fake nahi dikhaya jata.", 12.5f, T.white).apply { setPadding(0, dp(6), 0, 0) })
        body.addView(info, lp(-1, -2).apply { bottomMargin = dp(12) })
        val list = col()
        body.addView(list, lp(-1, -2))
        val out = tv(actuatorLog.joinToString("\n"), 12f, T.white).apply { typeface = Typeface.MONOSPACE }
        body.addView(primary("Check supported tests") {
            list.removeAllViews()
            list.addView(tv("ECU se poochh raha hoon…", 13f, T.yellow, true), lp(-1, -2))
            io.execute {
                val (tids, raw) = obd.mode08Supported()
                val tests = tids.filter { it % 0x20 != 0 }
                actuatorTests = tests.size
                actuatorLog.add("0800 → " + raw.joinToString(" ").ifBlank { "no reply" })
                ui.post {
                    list.removeAllViews()
                    out.text = actuatorLog.joinToString("\n")
                    if (tests.isEmpty()) {
                        list.addView(card().apply {
                            addView(tv("Is ECU ne koi standard actuator test (mode 08) support nahi bataya.", 13.5f, T.white, true))
                            addView(tv("Is bike ke actuator tests ke liye company ka service tool chahiye.", 12.5f, T.muted).apply { setPadding(0, dp(6), 0, 0) })
                        }, lp(-1, -2))
                    } else for (t in tests) {
                        val r = row().apply { setPadding(dp(14), dp(12), dp(14), dp(12)); background = rounded(T.card, dpf(14f), T.stroke, dp(1)) }
                        r.addView(tv("Test ID %02X".format(t), 14.5f, T.white, true), lp(0, -2, 1f))
                        r.addView(tv("Run", 12.5f, T.ink, true).apply {
                            setPadding(dp(14), dp(7), dp(14), dp(7)); background = vgradient(dpf(10f), T.yellow, T.yellow2); isClickable = true
                            setOnClickListener { confirmRun(t, out) }
                        }, lp(-2, -2))
                        list.addView(r, lp(-1, -2).apply { bottomMargin = dp(8) })
                    }
                }
            }
        }, lp(-1, dp(50)).apply { bottomMargin = dp(12) })
        body.addView(sectionTitle("ECU replies"), lp(-1, -2))
        body.addView(card().apply { addView(out) }, lp(-1, -2))
        setContentView(root)
    }

    private fun confirmRun(tid: Int, out: TextView) {
        AlertDialog.Builder(this)
            .setTitle("Run test %02X?".format(tid))
            .setMessage("Bike stand par, engine band, ignition ON. Test ke dauran koi part chal sakta hai.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Run") { _, _ ->
                io.execute {
                    val r = obd.mode08Run(tid)
                    actuatorLog.add("08%02X → ".format(tid) + r.joinToString(" ").ifBlank { "no reply" })
                    ui.post { out.text = actuatorLog.joinToString("\n") }
                }
            }.show()
    }

    // ================= ABS =================

    private fun buildAbs() {
        val (root, body) = shell(detailBar("ABS", "Diagnostics", "Read-only", T.purple), Tab.HOME)
        body.addView(tv("((ABS))", 30f, T.purple, true).apply { gravity = Gravity.CENTER; setPadding(0, dp(10), 0, dp(14)) }, lp(-1, -2))
        val out = tv(absLog ?: "", 12.5f, T.white).apply { typeface = Typeface.MONOSPACE }
        body.addView(primary("⌕  Read ABS (real probe)") {
            out.text = "Probing every ECU with headers on…"
            io.execute {
                val raw = obd.absProbe()
                val addrs = Elm.ecuAddresses(raw)
                val others = addrs.filter { Elm.ecuLabel(it).startsWith("ECU ") }
                val txt = if (Elm.isNoData(raw)) "Koi ECU ne jawab nahi diya.\n\nRaw:\n" + raw.joinToString("\n").ifBlank { "(empty)" }
                    else if (others.isEmpty()) "Sirf engine ECU ne jawab diya — ABS unit generic OBD par nahi bol rahi.\n\nZyadatar bikes ki ABS unit alag address/protocol par hoti hai jo generic ELM327 tak nahi pahunchta.\n\nRaw:\n" + raw.joinToString("\n")
                    else "Engine ke alawa ${others.size} ECU ne jawab diya: ${others.joinToString()}\n(Inme ABS ho sakti hai — 'All ECU Scan' inke codes alag dikhata hai.)\n\nRaw:\n" + raw.joinToString("\n")
                absLog = txt
                absOthers = others.size
                ui.post { out.text = txt }
            }
        }, lp(-1, dp(50)).apply { bottomMargin = dp(10) })
        body.addView(card().apply { addView(out) }, lp(-1, -2))
        body.addView(tv("Note: app kabhi ABS result fake nahi karta. Agar ABS unit jawab nahi deti, to uska address generic adapter ke liye available nahi hai.", 11.5f, T.muted).apply { setPadding(dp(2), dp(12), dp(2), 0) }, lp(-1, -2))
        setContentView(root)
    }

    // ================= Report =================

    private fun reportText(): String {
        val df = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.US)
        val sb = StringBuilder()
        sb.append("YAGAMI DIAGNOSTICS — Report\n")
        sb.append(df.format(Date())).append("\n\n")
        sb.append("Bike: ").append(listOfNotNull(brand, model).joinToString(" ").ifBlank { "—" }).append('\n')
        sb.append("VIN: ").append(obd.vin ?: "Not reported").append('\n')
        sb.append("ECU: ").append(obd.ecuName ?: "Not reported").append('\n')
        if (obd.calId != null) sb.append("Calibration: ").append(obd.calId).append('\n')
        sb.append("Protocol: ").append(obd.protocol).append('\n')
        if (lastBattery.isNotBlank()) sb.append("Battery: ").append(lastBattery).append('\n')
        sb.append('\n')
        val res = scanResults
        if (res == null) sb.append("Fault codes: scan nahi kiya\n")
        else {
            sb.append("FAULT CODES (scan ").append(df.format(Date(scanTime))).append(")\n")
            for ((ecu, codes) in res) {
                sb.append("• ").append(ecu).append(": ")
                if (codes.isEmpty()) sb.append("No codes\n") else {
                    sb.append(codes.size).append(" code(s)\n")
                    for ((c, k) in codes) sb.append("   ").append(c).append(" [").append(k).append("] ").append(Data.describe(c)).append('\n')
                }
            }
        }
        if (freezeLines != null) {
            sb.append("\nFREEZE FRAME")
            if (freezeCode == null) sb.append(": none stored\n") else {
                sb.append(" (").append(freezeCode).append(")\n")
                for ((k, v) in freezeLines.orEmpty()) sb.append("   ").append(k).append(": ").append(v).append('\n')
            }
        }
        if (actuatorLog.isNotEmpty()) { sb.append("\nACTUATOR (mode 08)\n"); actuatorLog.forEach { sb.append("   ").append(it).append('\n') } }
        if (absLog != null) sb.append("\nABS\n   ").append(absLog!!.substringBefore("\n\nRaw").replace("\n", " ")).append('\n')
        sb.append("\n— YAGAMI · We Give Best Quality Connector")
        return sb.toString()
    }

    private fun shareReport() {
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "YAGAMI Diagnostic Report")
            putExtra(Intent.EXTRA_TEXT, reportText())
        }
        try { startActivity(Intent.createChooser(i, "Share report")) } catch (e: Exception) { toast("Share nahi ho paya") }
    }

    private fun buildReport() {
        val (root, body) = shell(appBar(), Tab.HOME)
        pageTitle(body, "Report", "WhatsApp, email ya kisi bhi app se bhejein.")
        val total = scanResults?.values?.sumOf { it.size }
        grid(body, 3, listOf(
            statTile("Codes", total?.toString() ?: "—", if ((total ?: 0) > 0) T.red else T.green, (total ?: 0) > 0),
            statTile("ECUs", scanResults?.size?.toString() ?: "—", T.blue),
            statTile("Freeze", if (freezeLines == null) "—" else if (freezeCode == null) "0" else "1", T.cyan)
        ))
        if (scanResults == null) body.addView(card().apply {
            addView(tv("Abhi tak scan nahi hua. Poori report ke liye pehle 'All ECU Scan' chalayein.", 13f, T.white))
        }, lp(-1, -2).apply { bottomMargin = dp(10) })
        val pre = card()
        pre.addView(tv(reportText(), 12f, T.white).apply { typeface = Typeface.MONOSPACE; setTextIsSelectable(true) })
        body.addView(pre, lp(-1, -2))
        val btns = row().apply { setPadding(0, dp(12), 0, 0) }
        btns.addView(ghost("Copy") {
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("YAGAMI report", reportText()))
            toast("Report copy ho gayi")
        }, lp(0, dp(50), 1f).apply { marginEnd = dp(10) })
        btns.addView(primary("Share") { shareReport() }, lp(0, dp(50), 1f))
        body.addView(btns, lp(-1, -2))
        if (obd.connected && scanResults == null) body.addView(ghost("⌕ Run All ECU Scan") { goTab(Tab.SCAN) }, lp(-1, dp(48)).apply { topMargin = dp(10) })
        setContentView(root)
    }

    // ================= helpers =================

    private fun field(value: String): EditText = EditText(this).apply {
        setText(value); textSize = 15f; setSingleLine(true)
        setTextColor(T.white); setHintTextColor(T.muted)
        setPadding(dp(14), 0, dp(14), 0)
        background = rounded(T.cardHi, dpf(12f), T.stroke, dp(1))
    }

    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (screen == Screen.CONNECT) show(Screen.CONNECT)
    }
}
