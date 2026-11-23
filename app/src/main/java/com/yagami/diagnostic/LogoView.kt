package com.yagami.diagnostic

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/** YAGAMI triangle emblem (original): a yellow triangular ring + inner triangle, with a soft glow. */
class LogoView(context: Context) : View(context) {
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FFD60A") }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#66FFD60A"); style = Paint.Style.STROKE
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat(); val h = height.toFloat()
        val s = Math.min(w, h)
        val cx = w / 2f; val top = (h - s) / 2f + s * 0.12f; val bot = (h - s) / 2f + s * 0.86f
        fun tri(scale: Float): Path {
            val p = Path()
            val half = s * 0.40f * scale
            val ty = cx * 0f // unused
            val apexY = top + (bot - top) * (1 - scale) / 2f
            val baseY = bot - (bot - top) * (1 - scale) / 2f
            p.moveTo(cx, apexY)
            p.lineTo(cx + half, baseY)
            p.lineTo(cx - half, baseY)
            p.close()
            return p
        }
        // outer ring via evenodd (outer triangle - inner triangle)
        val ring = Path().apply {
            fillType = Path.FillType.EVEN_ODD
            addPath(tri(1f)); addPath(tri(0.52f))
        }
        glow.strokeWidth = s * 0.04f
        c.drawPath(tri(1f), glow)
        c.drawPath(ring, fill)
        c.drawPath(tri(0.26f), fill)
    }
}
