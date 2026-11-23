package com.yagami.diagnostic

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.view.View

/** Original rounded brand emblem (colour + monogram). No real trademark logos. */
class BrandBadge(context: Context, private val label: String, colorHex: String) : View(context) {
    private val base = try { Color.parseColor(colorHex) } catch (e: Exception) { Color.parseColor("#1F6FD6") }
    private val light = blend(base, Color.WHITE, 0.28f)
    private val dark = blend(base, Color.BLACK, 0.18f)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = blend(base, Color.WHITE, 0.5f) }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val s = Math.min(w, h); val pad = s * 0.08f
        val rect = RectF((w - s) / 2 + pad, (h - s) / 2 + pad, (w + s) / 2 - pad, (h + s) / 2 - pad)
        fill.shader = LinearGradient(0f, rect.top, 0f, rect.bottom, intArrayOf(light, base, dark), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
        stroke.strokeWidth = s * 0.04f
        val rad = s * 0.28f
        c.drawRoundRect(rect, rad, rad, fill)
        c.drawRoundRect(rect, rad, rad, stroke)
        text.textSize = s * (if (label.length >= 3) 0.26f else 0.38f)
        val fm = text.fontMetrics
        c.drawText(label, w / 2f, h / 2f - (fm.ascent + fm.descent) / 2f, text)
    }

    private fun blend(a: Int, b: Int, t: Float): Int {
        val r = (Color.red(a) * (1 - t) + Color.red(b) * t).toInt()
        val g = (Color.green(a) * (1 - t) + Color.green(b) * t).toInt()
        val bl = (Color.blue(a) * (1 - t) + Color.blue(b) * t).toInt()
        return Color.rgb(r, g, bl)
    }
}
