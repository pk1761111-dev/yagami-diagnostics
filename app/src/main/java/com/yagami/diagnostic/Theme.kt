package com.yagami.diagnostic

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** YAGAMI Diagnostics dark-navy + yellow theme and small view helpers (programmatic UI, no XML). */
object T {
    // Same palette as YAGAMI AI Shipping Control
    val bg = Color.parseColor("#0A0A0B")          // page background
    val bg2 = Color.parseColor("#0E0E10")         // bars (top / bottom nav)
    val card = Color.parseColor("#121214")        // card (s1)
    val cardHi = Color.parseColor("#1A1A1D")      // raised card (s2)
    val s3 = Color.parseColor("#232327")          // buttons (s3)
    val stroke = Color.parseColor("#2A2A2F")      // card border (line)
    val strokeHi = Color.parseColor("#3A3A40")
    val white = Color.parseColor("#F4F3EE")
    val muted = Color.parseColor("#8E8D95")
    val yellow = Color.parseColor("#FFD60A")      // primary accent
    val yellow2 = Color.parseColor("#FFB800")
    val ink = Color.parseColor("#0A0A0B")         // text on yellow
    val blue = Color.parseColor("#4DA3FF")
    val green = Color.parseColor("#30D158")
    val red = Color.parseColor("#FF453A")
    val orange = Color.parseColor("#FF9F0A")
    val cyan = Color.parseColor("#40C8E0")
    val purple = Color.parseColor("#BF5AF2")
    val grey = Color.parseColor("#8E8E93")
}

/** Colour with alpha 0..255. */
fun alpha(c: Int, a: Int): Int = Color.argb(a, Color.red(c), Color.green(c), Color.blue(c))

fun Context.dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
fun Context.dpf(v: Float): Float = v * resources.displayMetrics.density

fun Context.tv(text: CharSequence, size: Float, color: Int, bold: Boolean = false): TextView =
    TextView(this).apply {
        this.text = Lang.tr(text)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTextColor(color)
        if (bold) typeface = android.graphics.Typeface.DEFAULT_BOLD
        includeFontPadding = false
    }

fun rounded(color: Int, radius: Float, stroke: Int? = null, strokeW: Int = 2): GradientDrawable =
    GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
        if (stroke != null) setStroke(strokeW, stroke)
    }

fun Context.ripple(content: GradientDrawable, radius: Float): RippleDrawable =
    RippleDrawable(ColorStateList.valueOf(Color.argb(60, 255, 255, 255)),
        content, rounded(Color.WHITE, radius))

fun vgradient(radius: Float, vararg colors: Int): GradientDrawable =
    GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, colors).apply { cornerRadius = radius }

fun Context.row(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
fun Context.col(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

fun lp(w: Int, h: Int, weight: Float = 0f): LinearLayout.LayoutParams =
    LinearLayout.LayoutParams(w, h, weight)
