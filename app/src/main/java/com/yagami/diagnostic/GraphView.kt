package com.yagami.diagnostic

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.view.View

/** Rolling line graph of the last N live readings, filled under the line (Shipping Control style). */
class GraphView(context: Context, private val accent: Int, private val maxPoints: Int = 60) : View(context) {
    private val pts = ArrayDeque<Float>()
    var fixedMax: Float = 0f

    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = accent; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.ROUND }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = T.stroke; strokeWidth = 1f }

    fun add(v: Float) {
        pts.addLast(v)
        while (pts.size > maxPoints) pts.removeFirst()
        invalidate()
    }

    fun clear() { pts.clear(); invalidate() }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        for (k in 1..3) c.drawLine(0f, h * k / 4f, w, h * k / 4f, grid)
        if (pts.size < 2) return
        val mx = maxOf(fixedMax, pts.maxOrNull() ?: 1f, 1f)
        val mn = minOf(0f, pts.minOrNull() ?: 0f)
        val range = (mx - mn).takeIf { it > 0f } ?: 1f
        val step = w / (maxPoints - 1)
        val x0 = w - step * (pts.size - 1)
        val p = Path()
        pts.forEachIndexed { i, v ->
            val x = x0 + i * step
            val y = h - (v - mn) / range * (h * 0.9f) - h * 0.05f
            if (i == 0) p.moveTo(x, y) else p.lineTo(x, y)
        }
        val area = Path(p).apply { lineTo(w, h); lineTo(x0, h); close() }
        fill.shader = LinearGradient(0f, 0f, 0f, h, alpha(accent, 90), alpha(accent, 0), Shader.TileMode.CLAMP)
        c.drawPath(area, fill)
        line.strokeWidth = resources.displayMetrics.density * 2f
        c.drawPath(p, line)
    }
}
