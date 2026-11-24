package com.yagami.diagnostic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class OnlineTest {
    @Test fun versionCompare() {
        assertTrue(Updater.newer("v2.3.1", "2.3.0"))
        assertTrue(Updater.newer("v2.10.0", "2.9.9"))
        assertFalse(Updater.newer("v2.3.0", "2.3.0"))
        assertFalse(Updater.newer("v2.2.9", "2.3.0"))
    }

    @Test fun bundledDatabaseParses() {
        val (v, m) = DtcDb.parse(File("src/main/assets/dtc_codes.json").readText())
        assertEquals("2026-11-24", v)
        assertTrue(m.size >= 140)
        val e = m["P0133"]!!
        assertTrue(e.name.contains("O2") && e.causes.isNotEmpty() && e.checks.isNotEmpty())
    }

    @Test fun onlineCopyMatchesBundled() =
        assertEquals(File("../dtc/dtc_codes.json").readText(), File("src/main/assets/dtc_codes.json").readText())

    @Test fun geminiRequestAndAnswer() {
        val req = org.json.JSONObject(Ai.request("P0133 kya hai?"))
        assertEquals("P0133 kya hai?", req.getJSONArray("contents").getJSONObject(0).getJSONArray("parts").getJSONObject(0).getString("text"))
        val resp = """{"candidates":[{"content":{"parts":[{"text":"soch","thought":true},{"text":"O2 sensor "},{"text":"check karo"}]}}]}"""
        assertEquals("O2 sensor check karo", Ai.answerText(resp))
        assertEquals("", Ai.answerText("""{"candidates":[]}"""))
    }
}
