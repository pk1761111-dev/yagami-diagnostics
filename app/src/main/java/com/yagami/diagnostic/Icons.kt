package com.yagami.diagnostic

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View

/** Line icons drawn on a 24x24 grid (same look as the Shipping Control nav icons). */
class IconView(context: Context, private val kind: String, var color: Int) : View(context) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height) / 24f
        c.save()
        c.translate((width - 24 * s) / 2f, (height - 24 * s) / 2f)
        c.scale(s, s)
        p.color = color; p.strokeWidth = 1.8f; p.style = Paint.Style.STROKE
        val path = Path()
        when (kind) {
            "home" -> { path.moveTo(3f, 11f); path.lineTo(12f, 3.5f); path.lineTo(21f, 11f)
                path.moveTo(5.5f, 9.5f); path.lineTo(5.5f, 20f); path.lineTo(18.5f, 20f); path.lineTo(18.5f, 9.5f)
                path.moveTo(10f, 20f); path.lineTo(10f, 14f); path.lineTo(14f, 14f); path.lineTo(14f, 20f) }
            "scan" -> { c.drawCircle(10.5f, 10.5f, 6.5f, p); path.moveTo(15.5f, 15.5f); path.lineTo(20.5f, 20.5f) }
            "live" -> { path.moveTo(2.5f, 12f); path.lineTo(7f, 12f); path.lineTo(9.5f, 6f); path.lineTo(13.5f, 18f); path.lineTo(16f, 12f); path.lineTo(21.5f, 12f) }
            "report" -> { path.moveTo(6f, 3f); path.lineTo(14.5f, 3f); path.lineTo(19f, 7.5f); path.lineTo(19f, 21f); path.lineTo(6f, 21f); path.close()
                path.moveTo(14.5f, 3f); path.lineTo(14.5f, 7.5f); path.lineTo(19f, 7.5f)
                path.moveTo(9f, 12f); path.lineTo(16f, 12f); path.moveTo(9f, 16f); path.lineTo(14f, 16f) }
            "connect" -> { // bluetooth rune
                path.moveTo(7f, 7.5f); path.lineTo(16.5f, 16f); path.lineTo(12f, 20.5f); path.lineTo(12f, 3.5f); path.lineTo(16.5f, 8f); path.lineTo(7f, 16.5f) }
            "bell" -> { path.moveTo(6f, 16.5f); path.lineTo(6f, 11f); path.cubicTo(6f, 7.5f, 8.5f, 5f, 12f, 5f); path.cubicTo(15.5f, 5f, 18f, 7.5f, 18f, 11f)
                path.lineTo(18f, 16.5f); path.lineTo(19.5f, 18f); path.lineTo(4.5f, 18f); path.close()
                path.moveTo(10f, 20.5f); path.lineTo(14f, 20.5f); path.moveTo(12f, 3f); path.lineTo(12f, 5f) }
            "back" -> { path.moveTo(19f, 12f); path.lineTo(5f, 12f); path.moveTo(11f, 6f); path.lineTo(5f, 12f); path.lineTo(11f, 18f) }
            "warn" -> { path.moveTo(12f, 3.5f); path.lineTo(21.5f, 20f); path.lineTo(2.5f, 20f); path.close(); path.moveTo(12f, 10f); path.lineTo(12f, 14f); path.moveTo(12f, 17f); path.lineTo(12f, 17.2f) }
            "snow" -> { for (k in 0 until 3) { c.save(); c.rotate(k * 60f, 12f, 12f); c.drawLine(12f, 3f, 12f, 21f, p); c.drawLine(9.5f, 5f, 12f, 7f, p); c.drawLine(14.5f, 5f, 12f, 7f, p); c.drawLine(9.5f, 19f, 12f, 17f, p); c.drawLine(14.5f, 19f, 12f, 17f, p); c.restore() } }
            "chip" -> { c.drawRoundRect(RectF(6f, 6f, 18f, 18f), 2f, 2f, p); c.drawRect(RectF(9.5f, 9.5f, 14.5f, 14.5f), p)
                for (k in listOf(9f, 12f, 15f)) { c.drawLine(k, 3f, k, 6f, p); c.drawLine(k, 18f, k, 21f, p); c.drawLine(3f, k, 6f, k, p); c.drawLine(18f, k, 21f, k, p) } }
            "gear" -> { c.drawCircle(12f, 12f, 3.2f, p); c.drawCircle(12f, 12f, 7f, p)
                for (k in 0 until 8) { c.save(); c.rotate(k * 45f, 12f, 12f); c.drawLine(12f, 2.5f, 12f, 5f, p); c.restore() } }
            "abs" -> { c.drawCircle(12f, 12f, 6.5f, p); path.addArc(RectF(2.5f, 2.5f, 21.5f, 21.5f), 130f, 100f); path.addArc(RectF(2.5f, 2.5f, 21.5f, 21.5f), -50f, 100f) }
            "clear" -> { path.moveTo(4f, 7f); path.lineTo(20f, 7f); path.moveTo(9f, 7f); path.lineTo(9f, 4f); path.lineTo(15f, 4f); path.lineTo(15f, 7f)
                path.moveTo(6f, 7f); path.lineTo(7f, 20.5f); path.lineTo(17f, 20.5f); path.lineTo(18f, 7f); path.moveTo(10f, 11f); path.lineTo(10f, 17f); path.moveTo(14f, 11f); path.lineTo(14f, 17f) }
            "ai" -> { path.moveTo(12f, 3f); path.cubicTo(12.6f, 8.2f, 15.8f, 11.4f, 21f, 12f); path.cubicTo(15.8f, 12.6f, 12.6f, 15.8f, 12f, 21f)
                path.cubicTo(11.4f, 15.8f, 8.2f, 12.6f, 3f, 12f); path.cubicTo(8.2f, 11.4f, 11.4f, 8.2f, 12f, 3f); path.close()
                path.moveTo(19f, 3f); path.lineTo(19f, 6f); path.moveTo(17.5f, 4.5f); path.lineTo(20.5f, 4.5f) }
            "bike" -> { c.drawCircle(5.5f, 16f, 3.5f, p); c.drawCircle(18.5f, 16f, 3.5f, p)
                path.moveTo(5.5f, 16f); path.lineTo(9.5f, 10f); path.lineTo(14.5f, 10f); path.lineTo(18.5f, 16f)
                path.moveTo(9.5f, 10f); path.lineTo(12f, 16f); path.lineTo(14.5f, 10f)
                path.moveTo(14.5f, 10f); path.lineTo(13.5f, 6.5f); path.lineTo(16f, 6.5f) }
            "bag" -> { path.moveTo(4.5f, 8f); path.lineTo(19.5f, 8f); path.lineTo(18.5f, 20.5f); path.lineTo(5.5f, 20.5f); path.close()
                path.moveTo(8.5f, 10.5f); path.lineTo(8.5f, 7f); path.cubicTo(8.5f, 4.8f, 10f, 3.5f, 12f, 3.5f); path.cubicTo(14f, 3.5f, 15.5f, 4.8f, 15.5f, 7f); path.lineTo(15.5f, 10.5f) }
            "share" -> { c.drawCircle(18f, 5.5f, 2.5f, p); c.drawCircle(6f, 12f, 2.5f, p); c.drawCircle(18f, 18.5f, 2.5f, p)
                path.moveTo(8.2f, 10.8f); path.lineTo(15.8f, 6.7f); path.moveTo(8.2f, 13.2f); path.lineTo(15.8f, 17.3f) }
        }
        c.drawPath(path, p)
        c.restore()
    }
}

/** Yellow hexagon with a "Y" inside: the YAGAMI mark used on the Shipping Control header. */
class HexLogo(context: Context) : View(context) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; color = T.yellow; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height).toFloat()
        val cx = width / 2f; val cy = height / 2f; val r = s * 0.44f
        p.strokeWidth = s * 0.075f
        val hex = Path()
        for (k in 0 until 6) {
            val a = Math.toRadians((60.0 * k) - 90.0)
            val x = cx + r * Math.cos(a).toFloat(); val y = cy + r * Math.sin(a).toFloat()
            if (k == 0) hex.moveTo(x, y) else hex.lineTo(x, y)
        }
        hex.close()
        c.drawPath(hex, p)
        p.strokeWidth = s * 0.085f
        val y = Path()
        y.moveTo(cx - r * 0.42f, cy - r * 0.42f); y.lineTo(cx, cy + r * 0.02f); y.lineTo(cx + r * 0.42f, cy - r * 0.42f)
        y.moveTo(cx, cy + r * 0.02f); y.lineTo(cx, cy + r * 0.5f)
        c.drawPath(y, p)
    }
}

/** Ring progress with a big centre value and a small caption (the "12% RTO rate" ring). */
class RingView(context: Context) : View(context) {
    var frac = 0f; var value = "—"; var caption = ""; var ringColor = T.yellow
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = T.s3; strokeCap = Paint.Cap.ROUND }
    private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val big = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = T.white; textAlign = Paint.Align.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD }
    private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = T.muted; textAlign = Paint.Align.CENTER }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height).toFloat(); val sw = s * 0.09f
        track.strokeWidth = sw; arc.strokeWidth = sw; arc.color = ringColor
        val r = RectF(sw, sw, s - sw, s - sw)
        c.drawArc(r, 0f, 360f, false, track)
        c.drawArc(r, -90f, 360f * frac.coerceIn(0f, 1f), false, arc)
        big.textSize = s * 0.2f; small.textSize = s * 0.1f
        c.drawText(value, s / 2f, s / 2f + s * 0.04f, big)
        c.drawText(caption, s / 2f, s / 2f + s * 0.2f, small)
    }
}
