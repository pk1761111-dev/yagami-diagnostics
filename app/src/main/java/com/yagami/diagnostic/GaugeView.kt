package com.yagami.diagnostic

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/** Small semicircular gauge for a live value (0..max), with the number and unit in the middle. */
class GaugeView(context: Context, private val accent: Int) : View(context) {
    var value: Float = 0f
        set(v) { field = v; invalidate() }
    var max: Float = 100f
    var label: String = ""
    var unit: String = ""
    var display: String = "0"

    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.parseColor("#2A2A2F"); strokeCap = Paint.Cap.ROUND }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = accent; strokeCap = Paint.Cap.ROUND }
    private val num = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#F4F3EE"); textAlign = Paint.Align.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD }
    private val sub = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#8E8D95"); textAlign = Paint.Align.CENTER }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val sw = Math.min(w, h) * 0.09f
        track.strokeWidth = sw; arc.strokeWidth = sw
        val pad = sw + h * 0.06f
        val r = RectF(pad, pad, w - pad, h * 2f - pad)
        val cx = w / 2f
        // 180° sweep (bottom half hidden): start 150, sweep 240
        val start = 150f; val sweep = 240f
        c.drawArc(RectF(pad, pad, w - pad, h * 1.7f - pad), start, sweep, false, track)
        val frac = if (max <= 0f) 0f else Math.max(0f, Math.min(1f, value / max))
        c.drawArc(RectF(pad, pad, w - pad, h * 1.7f - pad), start, sweep * frac, false, arc)
        num.textSize = h * 0.30f
        c.drawText(display, cx, h * 0.58f, num)
        sub.textSize = h * 0.12f
        c.drawText(unit, cx, h * 0.74f, sub)
    }
}
