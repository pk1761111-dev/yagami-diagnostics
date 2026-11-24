package com.yagami.diagnostic

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class LangTest {
    private fun map(c: String): Map<String, String> {
        val s = JSONObject(File("src/main/assets/lang/$c.json").readText()).getJSONObject("strings")
        return s.keys().asSequence().associateWith { s.getString(it) }
    }
    @After fun reset() = Lang.setForTest("hinglish", emptyMap())

    @Test fun hindiExactPatternsAndNesting() {
        Lang.setForTest("hi", map("hi"), map("en"))
        assertEquals("पहले एडाप्टर कनेक्ट करें", Lang.tr("Pehle adapter connect karein"))
        assertEquals("सब देखें (4)", Lang.tr("View all (4)"))
        assertEquals("P0501 — व्हीकल स्पीड सेंसर रेंज / परफ़ॉर्मेंस", Lang.tr("P0501 — Vehicle speed sensor range / performance"))
        assertEquals("O2 सेंसर हीटर सर्किट लो (बैंक 1 सेंसर 2)", Lang.tr("O2 sensor heater circuit low (Bank 1 Sensor 2)"))
        assertEquals("•  सेंसर ख़राब", Lang.tr("•  Sensor kharab"))
        assertEquals("2.  एयर फ़िल्टर जाँचें", Lang.tr("2.  Air filter check karo"))
        assertEquals("बैटरी कमज़ोर है (11.8V)। कम वोल्टेज से ECU ग़लत सेंसर कोड भी डाल देता है।", Lang.tr("Battery kamzor hai (11.8V). Kam voltage se ECU galat sensor codes bhi daal deta hai."))
        assertEquals("TVS Apache", Lang.tr("TVS Apache"))           // data stays as is
        assertEquals("सिलेंडर 3 मिसफ़ायर", Lang.tr("Cylinder 3 misfire"))
        assertEquals("P0053 — O2 सेंसर हीटर रेज़िस्टेंस (बैंक 1 सेंसर 1)", Lang.tr("P0053 — O2 sensor heater resistance (Bank 1 Sensor 1)"))
        assertEquals("3.  P0501: बाइक चलाते हुए लाइव डेटा में स्पीड देखें — मीटर के बराबर होनी चाहिए",
            Lang.tr("3.  P0501: Bike chalate hue Live Data mein Speed dekho — meter ke barabar honi chahiye"))
    }

    @Test fun englishAndHinglish() {
        Lang.setForTest("en", map("en"))
        assertEquals("Connect the adapter first", Lang.tr("Pehle adapter connect karein"))
        assertEquals("Home", Lang.tr("Home"))
        Lang.setForTest("hinglish", emptyMap())
        assertEquals("Pehle adapter connect karein", Lang.tr("Pehle adapter connect karein"))
    }

    @Test fun hindiCoversEveryDatabasePhrase() {
        val hi = map("hi"); Lang.setForTest("hi", hi, map("en"))
        val db = DtcDb.parse(File("src/main/assets/dtc_codes.json").readText()).second
        val missing = db.values.flatMap { listOf(it.name) + it.causes + it.checks }.distinct().filter { Lang.tr(it) == it && it.any { c -> c.isLowerCase() } }
        assertTrue("untranslated: $missing", missing.isEmpty())
    }
}
