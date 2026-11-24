package com.yagami.diagnostic

/**
 * "Turant salah": offline, rule-based advice built from the fault codes, battery voltage and the code database.
 * No AI, no internet: every line comes from the database or a fixed rule below.
 */
object Advisor {
    data class CodeAdvice(val code: String, val kind: String, val ecu: String, val name: String,
                          val causes: List<String>, val checks: List<String>, val fromDb: Boolean)
    data class Advice(val safety: List<String>, val firstSteps: List<String>, val codes: List<CodeAdvice>, val summary: String)

    /** Group of a code, used when the exact code is not in the database. */
    fun family(code: String): Triple<String, List<String>, List<String>> {
        val c = code.uppercase()
        val sys = c.firstOrNull() ?: 'P'
        val d1 = c.getOrNull(1) ?: '0'
        val d2 = c.getOrNull(2) ?: '0'
        if (d1 != '0' && sys == 'P') return Triple("Company-specific engine code",
            listOf("Ye code har company (Bajaj/TVS/Hero/Honda…) ka alag hota hai"),
            listOf("Bike ke service manual mein ye code dekho", "Company ke authorised service center ke tool se confirm karwao"))
        return when (sys) {
            'C' -> Triple("Chassis / ABS fault", listOf("Wheel speed sensor ya uski wiring", "ABS unit / fuse"), listOf("ABS fuse aur wheel sensors check karo", "Brakes test karke hi bike chalao"))
            'B' -> Triple("Body electrical fault", listOf("Lights/switch/meter ki wiring"), listOf("Related fuse aur connector check karo"))
            'U' -> Triple("Module communication fault", listOf("Module ka connector dhila", "CAN wiring", "Battery voltage kam"), listOf("Battery check karo", "Modules ke connector check karo"))
            else -> when (d2) {
                '0', '1' -> Triple("Fuel / air sensor fault", listOf("Sensor ya uski wiring", "Connector dhila ya corroded"), listOf("Related sensor ka connector check karo", "Live Data mein us sensor ki value dekho"))
                '2' -> Triple("Fuel injector / fuel system fault", listOf("Injector ya uski wiring", "Fuel pump / pressure"), listOf("Injector connector aur resistance check karo", "Fuel pump ki awaaz aur pressure check karo"))
                '3' -> Triple("Ignition / misfire fault", listOf("Spark plug, coil ya pickup", "Wiring"), listOf("Spark plug aur coil check karo", "Pickup coil wiring check karo"))
                '4' -> Triple("Emission control fault", listOf("Exhaust / catalyst / O2 sensor"), listOf("Exhaust leak aur O2 sensor check karo"))
                '5' -> Triple("Speed / idle / voltage fault", listOf("Speed sensor, idle valve ya charging system"), listOf("Live Data mein speed aur idle RPM dekho", "Battery aur charging voltage check karo"))
                '6' -> Triple("ECU / output circuit fault", listOf("ECU ka ground ya supply", "Koi output (relay, pump) ki wiring"), listOf("Battery, fuse aur ECU ground check karo"))
                else -> Triple("Transmission / other fault", listOf("Service manual mein dekhein"), listOf("Service center se confirm karwao"))
            }
        }
    }

    fun volts(battery: String): Float? = battery.filter { it.isDigit() || it == '.' }.toFloatOrNull()

    fun build(codes: List<Triple<String, String, String>>, battery: String, lookup: (String) -> DtcEntry?): Advice {
        val list = codes.map { (code, kind, ecu) ->
            val e = lookup(code)
            if (e != null && e.causes.isNotEmpty()) CodeAdvice(code, kind, ecu, e.name, e.causes, e.checks, true)
            else { val f = family(code); CodeAdvice(code, kind, ecu, e?.name?.ifBlank { null } ?: f.first, f.second, f.third, false) }
        }
        val safety = ArrayList<String>(); val first = ArrayList<String>()
        val v = volts(battery)
        if (v != null && v < 12.0f) {
            safety += "Battery kamzor hai (${"%.1f".format(v)}V). Kam voltage se ECU galat sensor codes bhi daal deta hai."
            first += "Battery charge/check karo (engine band par 12.4V+ hona chahiye, chalu par 13.5–14.5V). Phir codes clear karke dobara scan karo."
        } else if (v != null && v < 12.4f) first += "Battery thodi kam hai (${"%.1f".format(v)}V) — charge kar lo."
        val all = list.map { it.code }
        if (all.any { it.startsWith("C") }) safety += "ABS / brakes ka code hai — brakes test kiye bina bike mat chalao."
        if (all.any { it == "P0217" || it == "P0118" }) safety += "Engine overheat ka code hai — engine garam ho to bike mat chalao."
        if (all.any { it.startsWith("P030") }) safety += "Misfire code hai — lambi/tez ride mat karo, engine aur exhaust ko nuksaan ho sakta hai."
        val sensorCodes = list.count { it.code.startsWith("P0") && it.code.getOrNull(2) in listOf('0', '1', '5') }
        if (sensorCodes >= 2) first += "Ek saath ${sensorCodes} sensor codes hain — common ground, main connector ya battery ki problem ho sakti hai. Pehle ye check karo."
        list.forEach { a -> a.checks.firstOrNull()?.let { first += "${a.code}: $it" } }
        first += "Theek karne ke baad codes clear karo, ek test ride lo aur dobara scan karo. Code wapas aaye tabhi part badlo."
        val summary = when {
            list.isEmpty() -> "Koi fault code nahi hai."
            list.size == 1 -> "1 code: ${list[0].code} — ${list[0].name}"
            else -> "${list.size} codes: " + list.joinToString(", ") { it.code }
        }
        return Advice(safety, first.distinct(), list, summary)
    }
}
