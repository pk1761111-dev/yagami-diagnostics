package com.yagami.diagnostic

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Push notifications through Firebase Cloud Messaging. Works only when the build has google-services.json. */
object Push {
    const val CHANNEL = "yagami_news"

    fun available(ctx: Context): Boolean = try { FirebaseApp.getApps(ctx).isNotEmpty() || FirebaseApp.initializeApp(ctx) != null } catch (e: Exception) { false }

    fun channel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "YAGAMI offers & news", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "YAGAMI ki taraf se offers, naye products aur zaroori khabar"
            })
        }
    }

    fun topicFor(brand: String?): String? = brand?.lowercase()?.replace(Regex("[^a-z0-9]"), "")?.takeIf { it.isNotEmpty() }?.let { "bike_$it" }

    /** Everyone gets "all"; plus one topic for the selected company (e.g. bike_bajaj) so offers can be targeted. */
    fun subscribe(ctx: Context, brand: String?) {
        if (!available(ctx)) return
        try {
            val fm = FirebaseMessaging.getInstance()
            fm.subscribeToTopic("all")
            val prefs = ctx.getSharedPreferences("yagami", Context.MODE_PRIVATE)
            val old = prefs.getString("push_topic", null)
            val new = topicFor(brand)
            if (old != null && old != new) fm.unsubscribeFromTopic(old)
            if (new != null) fm.subscribeToTopic(new)
            prefs.edit().putString("push_topic", new).apply()
        } catch (e: Exception) {}
    }

    fun show(ctx: Context, title: String, body: String, screen: String?) {
        channel(ctx)
        val open = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (screen != null) putExtra("screen", screen)
        }
        val pi = PendingIntent.getActivity(ctx, title.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = android.app.Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_yagami)
            .setColor(T.yellow)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(android.app.Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try { ctx.getSystemService(NotificationManager::class.java).notify(System.currentTimeMillis().toInt(), n) } catch (e: SecurityException) {}
    }
}

/** Receives messages while the app is open (when closed, Android shows them itself). */
class YagamiMessaging : FirebaseMessagingService() {
    override fun onMessageReceived(m: RemoteMessage) {
        val title = m.notification?.title ?: m.data["title"] ?: "YAGAMI"
        val body = m.notification?.body ?: m.data["body"] ?: return
        Push.show(this, title, body, m.data["screen"])
    }

    override fun onNewToken(token: String) {
        Push.subscribe(this, getSharedPreferences("yagami", MODE_PRIVATE).getString("brand", null))
    }
}
