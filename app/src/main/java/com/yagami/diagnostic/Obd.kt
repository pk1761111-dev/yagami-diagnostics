package com.yagami.diagnostic

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

/**
 * ELM327 transport (Bluetooth SPP or Wi-Fi TCP) plus the OBD-II command helpers.
 * All blocking — call from a background thread. Nothing here is faked: every reply is the
 * adapter's real text, and when an ECU does not answer the caller is told plainly.
 */
class Obd {
    private val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    private var btSocket: BluetoothSocket? = null
    private var tcp: Socket? = null
    private var input: InputStream? = null
    private var output: OutputStream? = null

    @Volatile var connected = false
        private set
    @Volatile var protocol = "—"
    @Volatile var adapterName = "ELM327"

    // -------- Connect --------

    fun connectWifi(ip: String, port: Int): Boolean {
        close()
        return try {
            val s = Socket()
            s.connect(InetSocketAddress(ip, port), 6000)
            s.soTimeout = 4000
            tcp = s; input = s.getInputStream(); output = s.getOutputStream()
            connected = true
            true
        } catch (e: Exception) { connected = false; false }
    }

    fun connectBluetooth(address: String): Boolean {
        close()
        val adapter = BluetoothAdapter.getDefaultAdapter() ?: return false
        val device: BluetoothDevice = try { adapter.getRemoteDevice(address) } catch (e: Exception) { return false }
        try { adapter.cancelDiscovery() } catch (e: Exception) {}
        // Primary: secure RFCOMM to SPP UUID
        try {
            val sock = device.createRfcommSocketToServiceRecord(SPP)
            sock.connect()
            bind(sock); return true
        } catch (e: Exception) {
            try { btSocket?.close() } catch (ignored: Exception) {}
        }
        // Fallback 1: insecure RFCOMM
        try {
            val sock = device.createInsecureRfcommSocketToServiceRecord(SPP)
            sock.connect()
            bind(sock); return true
        } catch (e: Exception) {}
        // Fallback 2: reflection channel 1
        try {
            val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
            val sock = m.invoke(device, 1) as BluetoothSocket
            sock.connect()
            bind(sock); return true
        } catch (e: Exception) {}
        connected = false
        return false
    }

    private fun bind(sock: BluetoothSocket) {
        btSocket = sock
        input = sock.inputStream
        output = sock.outputStream
        connected = true
    }

    fun close() {
        connected = false
        try { input?.close() } catch (e: Exception) {}
        try { output?.close() } catch (e: Exception) {}
        try { btSocket?.close() } catch (e: Exception) {}
        try { tcp?.close() } catch (e: Exception) {}
        input = null; output = null; btSocket = null; tcp = null
    }

    // -------- Transact --------

    /** Send one command, read until the ELM '>' prompt (or timeout). Returns the response lines. */
    fun transact(cmd: String, timeoutMs: Long = 4000): List<String> {
        val out = output ?: return emptyList()
        val inp = input ?: return emptyList()
        try {
            // drain stale bytes
            while (inp.available() > 0) inp.read()
            out.write((cmd + "\r").toByteArray())
            out.flush()
        } catch (e: Exception) { connected = false; return emptyList() }

        val sb = StringBuilder()
        val deadline = System.currentTimeMillis() + timeoutMs
        val buf = ByteArray(256)
        var gotPrompt = false
        while (System.currentTimeMillis() < deadline) {
            try {
                if (inp.available() > 0) {
                    val n = inp.read(buf)
                    if (n > 0) {
                        for (k in 0 until n) {
                            val c = buf[k].toInt().toChar()
                            if (c == '>') { gotPrompt = true } else sb.append(c)
                        }
                        if (gotPrompt) break
                    }
                } else {
                    Thread.sleep(15)
                }
            } catch (e: Exception) {
                if (sb.isNotEmpty()) break
                Thread.sleep(15)
            }
        }
        return sb.toString().split('\r', '\n').map { it.trim() }.filter { it.isNotEmpty() }
    }

    // -------- High level --------

    @Volatile var isCan = true
    @Volatile var ecus: List<String> = emptyList()
    @Volatile var vin: String? = null
    @Volatile var ecuName: String? = null
    @Volatile var calId: String? = null
    @Volatile var supported: Set<Int> = emptySet()
    @Volatile var detected = false

    /** Reset and configure the adapter, then probe the engine ECU. Returns true if an ECU answered. */
    fun initEngine(): Boolean {
        transact("ATZ", 3000); Thread.sleep(200)
        // Spaces ON: the parser reads space-separated bytes.
        transact("ATE0"); transact("ATL0"); transact("ATS1"); transact("ATH0")
        transact("ATSP0")
        val probe = transact("0100", 8000)
        val dpn = transact("ATDPN").joinToString("")
        isCan = Elm.isCanProtocol(dpn)
        // Some clones answer ATDP with just "AUTO," — fall back to the protocol number.
        val dp = transact("ATDP").joinToString(" ").trim()
        protocol = if (dp.length > 8 && !dp.endsWith(",")) dp else Elm.protocolName(dpn)
        detected = false
        return !Elm.isNoData(probe) && probe.joinToString(" ").uppercase().contains("41")
    }

    /** Auto detection: every ECU that answers, VIN, ECU name, calibration ID and supported live PIDs. */
    fun autoDetect() {
        transact("ATH1")
        ecus = Elm.ecuAddresses(transact("0100", 6000))
        transact("ATH0")
        vin = Elm.parseVin(transact("0902", 6000))
        ecuName = Elm.parseMode09Ascii(transact("090A", 5000), 0x0A)
        calId = Elm.parseMode09Ascii(transact("0904", 5000), 0x04)
        val sup = HashSet<Int>()
        sup += Elm.supportedFromBitmap(transact("0100", 4000), 0x41, 0x00)
        if (0x20 in sup) sup += Elm.supportedFromBitmap(transact("0120", 4000), 0x41, 0x20)
        if (0x40 in sup) sup += Elm.supportedFromBitmap(transact("0140", 4000), 0x41, 0x40)
        supported = sup
        detected = true
    }

    private fun canFilter(addr: String?) {
        if (addr != null && isCan && (addr.length == 3 || addr.length == 8)) transact("ATCRA$addr") else transact("ATAR")
    }

    fun readStored(addr: String? = null): List<String> { canFilter(addr); val r = Elm.parseDtcs(transact("03", 6000), 0x03, isCan); canFilter(null); return r }
    fun readPending(addr: String? = null): List<String> { canFilter(addr); val r = Elm.parseDtcs(transact("07", 6000), 0x07, isCan); canFilter(null); return r }
    fun readPermanent(addr: String? = null): List<String> { canFilter(addr); val r = Elm.parseDtcs(transact("0A", 6000), 0x0A, isCan); canFilter(null); return r }
    fun readVin(): String? = Elm.parseVin(transact("0902", 6000))

    /** Mode 04 clears stored DTCs + turns off the MIL. Returns the raw reply for honest reporting. */
    fun clear(): List<String> = transact("04", 6000)

    fun livePid(pid: String): IntArray? = Elm.pidPayload(transact("01$pid", 2500), pid.takeLast(2).toInt(16))

    /** Freeze frame (mode 02, frame 0): the DTC that stored it, plus values for the given PIDs. */
    fun freezeDtc(): String? {
        val p = Elm.modePayload(transact("020200", 5000), 0x42, 0x02, skip = 1) ?: return null
        if (p.size < 2 || (p[0] == 0 && p[1] == 0)) return null
        return Elm.dtcFromBytes(p[0], p[1])
    }
    fun freezePid(pid: Int): IntArray? = Elm.modePayload(transact("02%02X00".format(pid), 4000), 0x42, pid, skip = 1)

    /** Mode 08 (on-board system test / actuator control) supported test IDs. Empty = ECU does not offer it. */
    fun mode08Supported(): Pair<Set<Int>, List<String>> {
        val raw = transact("0800", 5000)
        return Elm.supportedFromBitmap(raw, 0x48, 0x00) to raw
    }
    fun mode08Run(tid: Int): List<String> = transact("08%02X0000000000".format(tid), 6000)

    fun battery(): String = transact("ATRV", 2000).joinToString("").replace(">", "").trim()

    /** ABS: headers-on read-only probe across every ECU that answers. Returns raw lines; never fakes a result. */
    fun absProbe(): List<String> {
        transact("ATH1")
        val r = transact("0100", 6000) + transact("03", 6000)
        transact("ATH0")
        return r
    }
}
