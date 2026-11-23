package com.yagami.diagnostic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductsTest {
    private val csv = "Name,Price,Category,Bikes,Image,Description,Link\n" +
        "\"Harness, main\",₹1450,Wiring,Pulsar NS200; Dominar 400,,\"Full loom\nwith fuse box\",\n" +
        "O2 connector,₹120,Connectors,All,https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view,,\n" +
        "Apache loom,₹999,Wiring,TVS,,,\n,,,,,,\n"

    @Test fun parsesQuotedCommasAndNewlines() {
        val p = ProductDb.fromCsv(csv)
        assertEquals(3, p.size)
        assertEquals("Harness, main", p[0].name)
        assertEquals("Full loom\nwith fuse box", p[0].description)
    }

    @Test fun bikeMatching() {
        val p = ProductDb.fromCsv(csv)
        assertTrue(p[0].fits("Bajaj", "Pulsar NS200"))
        assertFalse(p[0].fits("TVS", "Apache RTR 160 4V"))
        assertTrue(p[1].fits("Honda", "Activa 6G"))           // All
        assertTrue(p[2].fits("TVS", "Apache RTR 160 4V"))     // brand match
    }

    @Test fun hindiHeadersWork() =
        assertEquals("Cable", ProductDb.fromCsv("Naam,Daam,Bike\nCable,₹50,All\n")[0].name)

    @Test fun driveLinkToDirect() =
        assertEquals("https://drive.google.com/uc?export=view&id=1AbCdEfGhIjKlMnOp",
            ProductDb.directImage("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"))
}
