/**
 * YAGAMI AI salah server (free, runs in your Google account).
 * The Gemini key lives in Script Properties (GEMINI_KEY), never in the app.
 *
 * Setup: Project Settings → Script properties → add GEMINI_KEY = <key from aistudio.google.com>
 * Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy → copy the /exec URL.
 */
var MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];
var PER_DEVICE_PER_DAY = 20;   // one phone cannot use up the whole free quota
var TOTAL_PER_DAY = 400;       // stays inside the Gemini free tier

var SYSTEM = 'Tum ek anubhavi Indian two-wheeler mechanic ho. Hinglish (Roman Hindi) mein, chhote points mein jawab do. ' +
  'Sirf diye gaye data par bharosa karo; jo data nahi hai uska andaza mat lagao aur saaf bolo ki pakka nahi keh sakte. ' +
  'Safety wali baat (brakes, ABS, fuel leak, overheating) sabse pehle likho.';

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return out({ ok: true, service: 'YAGAMI AI salah' }); }

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  var prompt = String(body.prompt || '').slice(0, 6000);
  var device = String(body.device || 'unknown').slice(0, 64);
  if (!prompt) return out({ ok: false, error: 'empty prompt' });

  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) return out({ ok: false, error: 'Server par GEMINI_KEY set nahi hai.' });

  // daily limits
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd');
  var counts = JSON.parse(props.getProperty('counts') || '{}');
  if (counts.day !== day) counts = { day: day, total: 0, dev: {} };
  if (counts.total >= TOTAL_PER_DAY) { lock.releaseLock(); return out({ ok: false, limit: true, error: 'Aaj ki AI limit poori ho gayi. Kal try karein.' }); }
  if ((counts.dev[device] || 0) >= PER_DEVICE_PER_DAY) { lock.releaseLock(); return out({ ok: false, limit: true, error: 'Is phone ki aaj ki AI limit poori ho gayi. Kal try karein.' }); }
  counts.total++; counts.dev[device] = (counts.dev[device] || 0) + 1;
  props.setProperty('counts', JSON.stringify(counts));
  lock.releaseLock();

  var payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.4 }
  };
  var last = '';
  for (var i = 0; i < MODELS.length; i++) {
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODELS[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = r.getResponseCode();
    if (code === 200) {
      var j = JSON.parse(r.getContentText());
      var parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      var text = parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('').trim();
      return out({ ok: true, text: text || 'AI ne khaali jawab diya.', model: MODELS[i] });
    }
    last = 'HTTP ' + code;
    if (code === 429) return out({ ok: false, limit: true, error: 'Gemini free limit abhi poori hai. Thodi der baad try karein.' });
    if (code !== 404) break;
  }
  return out({ ok: false, error: 'AI se jawab nahi mila (' + last + ')' });
}
