package com.yagami.diagnostic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AdvisorTest {
    private val db = DtcDb.parse(File("src/main/assets/dtc_codes.json").readText()).second

    @Test fun screenshotCase() {
        val a = Advisor.build(listOf(Triple("P0501", "Stored", "Engine ECU (7E8)"), Triple("P0053", "Stored", "Engine ECU (7E8)")), "11.8V") { db[it] }
        assertTrue(a.codes.all { it.fromDb })
        assertEquals("Vehicle speed sensor range / performance", a.codes[0].name)
        assertTrue(a.codes[1].name.startsWith("O2 sensor heater resistance"))
        assertTrue(a.safety.any { it.contains("11.8V") })
        assertTrue(a.firstSteps.first().startsWith("Battery"))
        assertTrue(a.firstSteps.any { it.startsWith("Ek saath 2 sensor codes") })
    }

    @Test fun unknownCodeUsesFamily() {
        val a = Advisor.build(listOf(Triple("P1238", "Stored", "Engine ECU")), "12.6V") { null }
        assertEquals("Company-specific engine code", a.codes[0].name)
        val b = Advisor.build(listOf(Triple("P0399", "Stored", "Engine ECU")), "") { null }
        assertEquals("Ignition / misfire fault", b.codes[0].name)
        assertTrue(Advisor.build(listOf(Triple("C0099", "Stored", "ECU 7E9")), "") { null }.safety.any { it.contains("brakes") })
    }

    @Test fun protocolNames() {
        assertEquals("ISO 15765-4 CAN 11/500", Elm.protocolName("A6"))
        assertEquals("ISO 14230-4 KWP (fast)", Elm.protocolName("5"))
    }
}
