package in.yagami.crm;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * YAGAMI CRM Android app.
 * A thin, secure shell around the YAGAMI CRM server: all data lives on the server so every
 * phone sees the same customers and payments. The server address is entered once on first launch.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "yagami";
    private static final String KEY_URL = "server_url";
    private static final int FILE_REQ = 41;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String serverHost = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A1020);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // alert sounds
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " YagamiApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "YG");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, ua, disposition, mime));

        String saved = prefs().getString(KEY_URL, null);
        if (saved != null) serverHost = Uri.parse(saved).getHost();
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else openApp();
    }

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private void openApp() {
        String url = prefs().getString(KEY_URL, null);
        if (url == null) {
            serverHost = null;
            web.loadUrl("file:///android_asset/setup.html");
        } else {
            serverHost = Uri.parse(url).getHost();
            web.loadUrl(url);
        }
    }

    /** Called from the setup / offline pages and from the web app's menu. */
    private class Bridge {
        @JavascriptInterface
        public String saveServer(String raw) {
            String u = raw == null ? "" : raw.trim();
            if (!u.startsWith("http")) u = "https://" + u;
            while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
            Uri p = Uri.parse(u);
            if (!"https".equals(p.getScheme()) || p.getHost() == null || !p.getHost().contains(".")) {
                return "Sahi https link daalein, jaise yagami-crm.onrender.com";
            }
            prefs().edit().putString(KEY_URL, p.getScheme() + "://" + p.getHost() + "/").apply();
            runOnUiThread(MainActivity.this::openApp);
            return "";
        }

        @JavascriptInterface
        public String currentServer() { return prefs().getString(KEY_URL, ""); }

        @JavascriptInterface
        public void changeServer() {
            prefs().edit().remove(KEY_URL).apply();
            runOnUiThread(MainActivity.this::openApp);
        }

        @JavascriptInterface
        public void retry() { runOnUiThread(MainActivity.this::openApp); }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme();
            boolean inside = ("https".equals(scheme) && serverHost != null && serverHost.equals(u.getHost()))
                    || "file".equals(scheme);
            if (inside) return false;
            // tel:, WhatsApp (wa.me), maps, other websites -> open in the right phone app
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, "Is link ke liye koi app nahi mila", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                Intent pick = params.createIntent();
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp", "application/pdf"});
                pick.setType("*/*");
                startActivityForResult(Intent.createChooser(pick, "Payment proof chunein"), FILE_REQ);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        } else super.onActivityResult(requestCode, resultCode, data);
    }

    /** CSV reports and data backups: saved to the phone's Downloads folder using the login cookie. */
    private void download(String url, String ua, String disposition, String mime) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) r.addRequestHeader("Cookie", cookie);
            r.addRequestHeader("User-Agent", ua);
            String name = URLUtil.guessFileName(url, disposition, mime);
            r.setTitle(name);
            r.setMimeType(mime);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Download ho raha hai: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Download nahi ho paya", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
