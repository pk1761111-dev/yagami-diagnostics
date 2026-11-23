package com.yagami.diagnostic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ElmTest {
    @Test fun canSingleFrameDtcs() =
        assertEquals(listOf("P0133", "P0300"), Elm.parseDtcs(listOf("43 02 01 33 03 00"), 0x03, true))

    @Test fun spacesOffStillParses() =
        assertEquals(listOf("P0133"), Elm.parseDtcs(listOf("4301013300000000"), 0x03, true))

    @Test fun canMultiFrameDtcs() =
        assertEquals(listOf("P0133", "P0300", "P0171", "C0035"),
            Elm.parseDtcs(listOf("00A", "0: 43 04 01 33 03 00", "1: 01 71 40 35 00 00 00"), 0x03, true))

    @Test fun kLineFramesNoCountByte() =
        assertEquals(listOf("P0133", "P0300", "P0171"),
            Elm.parseDtcs(listOf("43 01 33 03 00 00 00", "43 01 71 00 00 00 00"), 0x03, false))

    @Test fun noCodes() = assertTrue(Elm.parseDtcs(listOf("43 00"), 0x03, true).isEmpty())

    @Test fun vinCan() = assertEquals("MD2A11CZ5KCK12345",
        Elm.parseVin(listOf("014", "0: 49 02 01 4D 44 32", "1: 41 31 31 43 5A 35 4B", "2: 43 4B 31 32 33 34 35")))

    @Test fun ecuAddressesCan() = assertEquals(listOf("7E8", "7E9"),
        Elm.ecuAddresses(listOf("7E8 06 41 00 BE 3F A8 13", "7E9 06 41 00 98 18 80 11")))

    @Test fun ecuAddressesKline() = assertEquals(listOf("10"),
        Elm.ecuAddresses(listOf("48 6B 10 41 00 BE 3F A8 13 C4")))

    @Test fun ecuAddresses29bit() = assertEquals(listOf("18DAF110"),
        Elm.ecuAddresses(listOf("18 DA F1 10 06 41 00 BE 3F A8 13")))

    @Test fun supportedPids() {
        val s = Elm.supportedFromBitmap(listOf("41 00 BE 3F A8 13"), 0x41, 0x00)
        assertTrue(0x0C in s && 0x0D in s && 0x05 in s && 0x20 in s && 0x02 !in s)
    }

    @Test fun freezeFramePayload() {
        val p = Elm.modePayload(listOf("42 0C 00 1A F8"), 0x42, 0x0C, skip = 1)!!
        assertEquals(listOf(0x1A, 0xF8), p.toList())
    }

    @Test fun noDataPayload() = assertNull(Elm.pidPayload(listOf("NO DATA"), 0x0C))

    @Test fun canProtocolDetect() {
        assertTrue(Elm.isCanProtocol("A6")); assertTrue(!Elm.isCanProtocol("A5")); assertTrue(!Elm.isCanProtocol("3"))
    }
}
