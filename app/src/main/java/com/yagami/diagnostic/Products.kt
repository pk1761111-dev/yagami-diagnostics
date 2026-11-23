package com.yagami.diagnostic

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.ImageView
import java.io.File
import java.util.concurrent.Executors

data class Product(
    val name: String, val price: String, val category: String, val bikes: String,
    val image: String, val description: String, val link: String
) {
    /** Blank / "All" = fits every bike; otherwise matches if any listed name matches the brand or model. */
    fun fits(brand: String?, model: String?): Boolean {
        val list = bikes.split(';', ',', '|').map { it.trim() }.filter { it.isNotEmpty() }
        if (list.isEmpty() || list.any { it.equals("all", true) || it.equals("sab", true) }) return true
        return list.any { b ->
            (model != null && (model.contains(b, true) || b.contains(model, true))) ||
                (brand != null && b.equals(brand, true))
        }
    }
}

/** Minimal CSV reader (quotes, commas and new lines inside quotes). */
object Csv {
    fun parse(text: String): List<List<String>> {
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>(); val cell = StringBuilder()
        var q = false; var i = 0
        val t = text.removePrefix("﻿")
        while (i < t.length) {
            val c = t[i]
            if (q) {
                if (c == '"') { if (i + 1 < t.length && t[i + 1] == '"') { cell.append('"'); i++ } else q = false }
                else cell.append(c)
            } else when (c) {
                '"' -> q = true
                ',' -> { row.add(cell.toString()); cell.clear() }
                '\r' -> {}
                '\n' -> { row.add(cell.toString()); cell.clear(); rows.add(row); row = ArrayList() }
                else -> cell.append(c)
            }
            i++
        }
        if (cell.isNotEmpty() || row.isNotEmpty()) { row.add(cell.toString()); rows.add(row) }
        return rows.filter { r -> r.any { it.isNotBlank() } }
    }
}

/** Product list from a published Google Sheet (CSV). Cached on the phone for offline use. */
object ProductDb {
    @Volatile var items: List<Product> = emptyList(); private set
    @Volatile var updated: Long = 0; private set

    /** YAGAMI Products sheet in the owner's Google Drive (must be shared "Anyone with the link → Viewer"). */
    const val DEFAULT_URL = "https://docs.google.com/spreadsheets/d/1ueCaltQ9WVP4FaT219AL40yueLH_bFPijYBwsIhPL7w/export?format=csv"
    fun url(ctx: Context): String = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE).getString("products_url", null)?.ifBlank { null } ?: DEFAULT_URL
    private fun cache(ctx: Context) = File(ctx.filesDir, "products.csv")

    fun fromCsv(text: String): List<Product> {
        val rows = Csv.parse(text)
        if (rows.isEmpty()) return emptyList()
        val head = rows[0].map { it.trim().lowercase() }
        fun idx(vararg names: String) = head.indexOfFirst { h -> names.any { h == it || h.startsWith(it) } }
        val iName = idx("name", "naam", "product"); val iPrice = idx("price", "daam", "rate")
        val iCat = idx("category", "type"); val iBikes = idx("bikes", "bike", "model")
        val iImg = idx("image", "photo"); val iDesc = idx("description", "details", "info"); val iLink = idx("link", "url")
        if (iName < 0) return emptyList()
        fun g(r: List<String>, i: Int) = if (i >= 0 && i < r.size) r[i].trim() else ""
        return rows.drop(1).map { r -> Product(g(r, iName), g(r, iPrice), g(r, iCat), g(r, iBikes), g(r, iImg), g(r, iDesc), g(r, iLink)) }
            .filter { it.name.isNotBlank() && !it.name.startsWith("EXAMPLE", true) }
    }

    fun init(ctx: Context) {
        try { val f = cache(ctx); if (f.exists()) { items = fromCsv(f.readText()); updated = f.lastModified() } } catch (e: Exception) {}
    }

    /** Downloads the sheet. Returns a message for the user. */
    fun refresh(ctx: Context): String {
        val u = url(ctx)
        if (u.isBlank()) return "Products sheet ka link set nahi hai."
        return try {
            val (code, body) = Net.get(u)
            if (code != 200 || body.trimStart().startsWith("<")) "Sheet nahi khuli. Google Sheet ko Share → 'Anyone with the link' → Viewer karein."
            else {
                val list = fromCsv(body)
                if (list.isEmpty()) "Sheet mili, par 'name' column ya products nahi mile."
                else { cache(ctx).writeText(body); items = list; updated = System.currentTimeMillis(); "${list.size} products update ho gaye" }
            }
        } catch (e: Exception) { "Internet se nahi mila: ${e.message ?: e.javaClass.simpleName}" }
    }

    /** Google Drive share links → direct image links. Other links unchanged. */
    fun directImage(u: String): String {
        val m = Regex("drive\\.google\\.com/(?:file/d/|open\\?id=|uc\\?.*id=)([A-Za-z0-9_-]{10,})").find(u) ?: return u
        return "https://drive.google.com/uc?export=view&id=${m.groupValues[1]}"
    }
}

/** Small image loader: memory + disk cache, downsampled decode. */
object Images {
    private val pool = Executors.newFixedThreadPool(3)
    private val mem = object : LruCache<String, Bitmap>(12 * 1024 * 1024) { override fun sizeOf(k: String, v: Bitmap) = v.byteCount }

    fun load(ctx: Context, url: String, into: ImageView, maxPx: Int) {
        if (url.isBlank()) return
        val u = ProductDb.directImage(url)
        into.tag = u
        mem.get(u)?.let { into.setImageBitmap(it); return }
        val file = File(ctx.cacheDir, "img_" + u.hashCode().toUInt().toString(16))
        pool.execute {
            val bmp = try {
                if (!file.exists()) {
                    val c = java.net.URL(u).openConnection() as java.net.HttpURLConnection
                    c.connectTimeout = 10000; c.readTimeout = 15000; c.instanceFollowRedirects = true
                    c.setRequestProperty("User-Agent", "YAGAMI-Diagnostics")
                    if (c.responseCode == 200) c.inputStream.use { inp -> file.outputStream().use { inp.copyTo(it) } }
                    c.disconnect()
                }
                if (file.exists()) decode(file, maxPx) else null
            } catch (e: Exception) { null }
            if (bmp != null) {
                mem.put(u, bmp)
                into.post { if (into.tag == u) into.setImageBitmap(bmp) }
            }
        }
    }

    private fun decode(f: File, maxPx: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.path, o)
        var s = 1
        while (o.outWidth / (s * 2) >= maxPx && o.outHeight / (s * 2) >= maxPx) s *= 2
        return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s })
    }
}
