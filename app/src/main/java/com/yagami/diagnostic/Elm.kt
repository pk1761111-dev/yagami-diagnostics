package com.yagami.diagnostic

/** ELM327 / OBD-II response parsing: DTCs, VIN, ECU addresses, PIDs, freeze frame. Pure logic, no Android. */
object Elm {

    private const val HEX = "0123456789ABCDEF"

    /** SAE J2012 two-byte DTC -> code string, e.g. 0x01,0x33 -> "P0133". */
    fun dtcFromBytes(a: Int, b: Int): String {
        val letters = charArrayOf('P', 'C', 'B', 'U')
        val l = letters[(a shr 6) and 0x3]
        val d1 = (a shr 4) and 0x3
        val d2 = a and 0xF
        val d3 = (b shr 4) and 0xF
        val d4 = b and 0xF
        return "%c%d%X%X%X".format(l, d1, d2, d3, d4)
    }

    private fun isJunk(up: String): Boolean =
        up.contains("NO DATA") || up.contains("UNABLE") || up.contains("SEARCHING") ||
            up.contains("ERROR") || up.contains("STOPPED") || up.contains("?") || up == ">" || up == "OK"

    /** Hex bytes of one ELM line (spaces on or off), dropping frame indices like "0:" and ISO-TP length tokens. */
    fun lineBytes(raw: String): List<Int> {
        val up = raw.trim().uppercase()
        if (up.isEmpty() || isJunk(up)) return emptyList()
        val out = ArrayList<Int>()
        for (tok0 in up.split(Regex("\\s+"))) {
            var tok = tok0
            if (tok.endsWith(":")) continue
            if (tok.length == 3 && tok.all { it.isDigit() }) continue      // ISO-TP length like "014"
            if (tok.length > 2 && tok.contains(":")) tok = tok.substringAfter(":")
            if (tok.isEmpty() || !tok.all { it in HEX }) continue
            if (tok.length % 2 != 0) continue
            var k = 0
            while (k + 1 < tok.length) { out.add(tok.substring(k, k + 2).toInt(16)); k += 2 }
        }
        return out
    }

    private fun bytesOf(lines: List<String>): List<Int> = lines.flatMap { lineBytes(it) }

    /** True if the ELM protocol number (ATDPN, e.g. "A6") is a CAN protocol. */
    fun isCanProtocol(dpn: String): Boolean {
        val c = dpn.trim().uppercase().lastOrNull() ?: return false
        return c in "6789ABC"
    }

    /**
     * Decode DTCs from a mode 03/07/0A reply.
     * CAN: one message with a count byte after 43. K-line/J1850: one or more frames, each "43 + 3 DTCs", no count byte.
     */
    fun parseDtcs(lines: List<String>, mode: Int, isCan: Boolean = true): List<String> {
        val resp = mode + 0x40
        val out = ArrayList<String>()
        val frames = lines.map { lineBytes(it) }.filter { it.isNotEmpty() }
        val startsWithResp = frames.count { it.first() == resp }
        if (!isCan || startsWithResp > 1) {
            for (f in frames) {
                if (f.first() != resp) continue
                var i = 1
                // a CAN single-frame line can still carry a count byte; only skip it on CAN
                if (isCan && i < f.size && f[i] <= 20 && (f.size - i - 1) >= f[i] * 2 && (f.size - i - 1) % 2 == 0) i++
                while (i + 1 < f.size) {
                    val a = f[i]; val b = f[i + 1]; i += 2
                    if (a == 0 && b == 0) continue
                    out.add(dtcFromBytes(a, b))
                }
            }
            return out.distinct()
        }
        val bytes = frames.flatten()
        var i = bytes.indexOf(resp)
        if (i < 0) return emptyList()
        i++
        if (i < bytes.size) {
            val cnt = bytes[i]
            val remaining = bytes.size - (i + 1)
            if (cnt in 0..40 && remaining >= cnt * 2) i++
        }
        while (i + 1 < bytes.size) {
            val a = bytes[i]; val b = bytes[i + 1]; i += 2
            if (a == 0 && b == 0) continue
            out.add(dtcFromBytes(a, b))
        }
        return out.distinct()
    }

    /** True if the reply clearly means "no ECU answer / can't communicate". */
    fun isNoData(lines: List<String>): Boolean {
        val j = lines.joinToString(" ").uppercase()
        return j.contains("NO DATA") || j.contains("UNABLE TO CONNECT") || j.contains("CAN ERROR") ||
            j.contains("BUS INIT") || j.isBlank()
    }

    /** ASCII text from a mode 09 reply (49 <pid> [count] ...). */
    fun parseMode09Ascii(lines: List<String>, pid: Int): String? {
        val bytes = bytesOf(lines)
        var i = 0
        while (i + 1 < bytes.size && !(bytes[i] == 0x49 && bytes[i + 1] == pid)) i++
        if (i + 1 >= bytes.size) return null
        i += 2
        if (i < bytes.size && bytes[i] <= 0x05) i++
        val sb = StringBuilder()
        while (i < bytes.size) {
            val c = bytes[i]; i++
            if (c == 0x49 && i < bytes.size && bytes[i] == pid) { i++; if (i < bytes.size && bytes[i] <= 0x05) i++; continue }
            if (c in 0x20..0x7E) sb.append(c.toChar())
        }
        val s = sb.toString().trim()
        return s.ifBlank { null }
    }

    /** VIN from a mode 09 PID 02 reply, 17 chars. */
    fun parseVin(lines: List<String>): String? {
        val vin = parseMode09Ascii(lines, 0x02)?.filter { it.isLetterOrDigit() } ?: return null
        return if (vin.length >= 11) vin.takeLast(17) else null
    }

    /** Payload bytes after "<resp> <pid>" (mode 01: 41 PID ..; mode 02: 42 PID FRAME ..). */
    fun modePayload(lines: List<String>, resp: Int, pid: Int, skip: Int = 0): IntArray? {
        val bytes = bytesOf(lines)
        var i = 0
        while (i + 1 < bytes.size) {
            if (bytes[i] == resp && bytes[i + 1] == pid) {
                val from = i + 2 + skip
                if (from > bytes.size) return null
                return bytes.subList(from, bytes.size).toIntArray()
            }
            i++
        }
        return null
    }

    fun pidPayload(lines: List<String>, pid: Int): IntArray? = modePayload(lines, 0x41, pid)

    /** Supported PIDs from a bitmap reply (e.g. 0100 -> 41 00 b1 b2 b3 b4). Mode resp byte = 0x41 or 0x48 etc. */
    fun supportedFromBitmap(lines: List<String>, resp: Int, base: Int): Set<Int> {
        val p = modePayload(lines, resp, base) ?: return emptySet()
        if (p.size < 4) return emptySet()
        val out = HashSet<Int>()
        for (byteIdx in 0 until 4) for (bit in 0 until 8) {
            if ((p[byteIdx] shr (7 - bit)) and 1 == 1) out.add(base + byteIdx * 8 + bit + 1)
        }
        return out
    }

    /**
     * ECU addresses that answered a headers-on request.
     * CAN 11-bit "7E8 06 41 00 ..", CAN 29-bit "18 DA F1 10 .." or "18DAF110 ..", K-line/J1850 "48 6B 10 41 ..".
     */
    fun ecuAddresses(lines: List<String>): List<String> {
        val out = LinkedHashSet<String>()
        for (raw in lines) {
            val up = raw.trim().uppercase()
            if (up.isEmpty() || isJunk(up)) continue
            val toks = up.split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (toks.isEmpty()) continue
            val t0 = toks[0]
            when {
                t0.length == 3 && t0.all { it in HEX } -> out.add(t0)                         // 11-bit CAN
                t0.length == 8 && t0.all { it in HEX } -> out.add(t0)                         // 29-bit, spaces off
                t0 == "18" && toks.size > 3 && toks[1] == "DA" -> out.add("18DA" + toks[2] + toks[3])
                toks.size > 3 && t0.length == 2 && toks[3].startsWith("4") && toks.all { it.length == 2 && it.all { c -> c in HEX } } -> out.add(toks[2]) // K-line source
            }
        }
        return out.toList()
    }

    /** Human label for an ECU address. Only the engine address is named; others are shown as found. */
    fun ecuLabel(addr: String): String = when {
        addr == "7E8" -> "Engine ECU (7E8)"
        addr.length == 8 && addr.endsWith("10") -> "Engine ECU ($addr)"
        addr == "10" -> "Engine ECU (10)"
        else -> "ECU $addr"
    }

    /** Human name for an ATDPN protocol number (e.g. "A6" -> ISO 15765-4 CAN 11/500). */
    fun protocolName(dpn: String): String = when (dpn.trim().uppercase().lastOrNull()) {
        '1' -> "SAE J1850 PWM"; '2' -> "SAE J1850 VPW"; '3' -> "ISO 9141-2 (K-line)"
        '4' -> "ISO 14230-4 KWP (5 baud)"; '5' -> "ISO 14230-4 KWP (fast)"
        '6' -> "ISO 15765-4 CAN 11/500"; '7' -> "ISO 15765-4 CAN 29/500"
        '8' -> "ISO 15765-4 CAN 11/250"; '9' -> "ISO 15765-4 CAN 29/250"
        'A' -> "SAE J1939 CAN"; 'B', 'C' -> "User CAN"
        else -> "—"
    }

    fun isHex(s: String): Boolean = s.isNotEmpty() && s.all { it.uppercaseChar() in HEX }
}
