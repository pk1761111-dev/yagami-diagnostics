package com.yagami.diagnostic

/** Static data: brands, models, brand accent colours and DTC descriptions. */
object Data {

    // brand -> (accent colour hex, two-letter monogram)
    val brandStyle: Map<String, Pair<String, String>> = linkedMapOf(
        "TVS" to ("#1C8CF0" to "TVS"),
        "Bajaj" to ("#1F6FD6" to "BJ"),
        "Hero" to ("#E5323B" to "HE"),
        "Honda" to ("#E5323B" to "HO"),
        "Yamaha" to ("#2E63D6" to "YA"),
        "Suzuki" to ("#1E5AA8" to "SZ"),
        "Royal Enfield" to ("#B5742B" to "RE"),
        "KTM" to ("#F26B1F" to "KTM"),
        "Kawasaki" to ("#2E9E3E" to "KA"),
        "Jawa" to ("#8A2A2A" to "JW"),
        "Yezdi" to ("#3B3B3B" to "YZ"),
        "Harley-Davidson" to ("#E35205" to "HD"),
        "Others" to ("#7A8594" to "…")
    )

    val brands: Map<String, List<String>> = linkedMapOf(
        "TVS" to listOf("Apache RTR 160 4V", "Apache RTR 160 2V", "Apache RTR 180", "Apache RTR 200 4V",
            "Apache RR 310", "Ntorq 125", "Jupiter 125", "Raider 125", "Sport", "Star City Plus", "Radeon", "XL100"),
        "Bajaj" to listOf("Pulsar 150", "Pulsar 125", "Pulsar NS160", "Pulsar NS200", "Pulsar N160", "Pulsar N250",
            "Pulsar RS200", "Pulsar 220F", "Platina 110", "CT 110", "Avenger 160", "Avenger 220", "Dominar 250", "Dominar 400"),
        "Hero" to listOf("Splendor Plus", "Splendor iSmart", "HF Deluxe", "Passion Pro", "Glamour 125", "Super Splendor",
            "Xtreme 160R", "Xtreme 125R", "Xpulse 200", "Destini 125", "Maestro Edge 125", "Pleasure Plus"),
        "Honda" to listOf("Activa 6G", "Activa 125", "Dio", "Dio 125", "Shine 125", "SP 125", "Unicorn", "Hornet 2.0",
            "CB350", "H'ness CB350", "CB350RS", "CB300R", "SP 160", "Livo"),
        "Yamaha" to listOf("FZ-S FI", "FZ-X", "FZ 25", "MT-15", "R15 V4", "R15 V3", "Fascino 125", "RayZR 125", "Aerox 155"),
        "Suzuki" to listOf("Gixxer 150", "Gixxer SF 150", "Gixxer 250", "Gixxer SF 250", "Access 125", "Burgman Street 125", "Avenis 125", "Intruder 150"),
        "Royal Enfield" to listOf("Classic 350", "Bullet 350", "Hunter 350", "Meteor 350", "Himalayan 411", "Himalayan 450", "Continental GT 650", "Interceptor 650", "Scram 411"),
        "KTM" to listOf("Duke 125", "Duke 200", "Duke 250", "Duke 390", "RC 125", "RC 200", "RC 390", "Adventure 390"),
        "Kawasaki" to listOf("Ninja 300", "Ninja 400", "Z650", "W175", "Ninja 650"),
        "Jawa" to listOf("Jawa 42", "Jawa Classic", "Perak"),
        "Yezdi" to listOf("Roadster", "Scrambler", "Adventure"),
        "Harley-Davidson" to listOf("X440"),
        "Others" to listOf("Other model")
    )

    /** Common OBD-II / manufacturer DTC descriptions for display. */
    val dtcInfo: Map<String, String> = mapOf(
        "P0030" to "O2 sensor heater control circuit",
        "P0031" to "O2 sensor heater circuit low",
        "P0032" to "O2 sensor heater circuit high",
        "P0105" to "MAP sensor circuit fault",
        "P0106" to "MAP sensor range / performance",
        "P0107" to "MAP sensor circuit low",
        "P0108" to "MAP sensor circuit high",
        "P0110" to "Intake air temp sensor circuit",
        "P0112" to "Intake air temp sensor low",
        "P0113" to "Intake air temp sensor high",
        "P0115" to "Engine coolant temp sensor circuit",
        "P0117" to "Coolant temp sensor low",
        "P0118" to "Coolant temp sensor high",
        "P0120" to "Throttle position sensor circuit",
        "P0122" to "Throttle position sensor low",
        "P0123" to "Throttle position sensor high",
        "P0130" to "O2 sensor circuit fault",
        "P0131" to "O2 sensor low voltage",
        "P0132" to "O2 sensor high voltage",
        "P0133" to "O2 sensor slow response",
        "P0134" to "O2 sensor no activity",
        "P0171" to "Fuel system too lean",
        "P0172" to "Fuel system too rich",
        "P0201" to "Injector circuit cylinder 1",
        "P0217" to "Engine overheat",
        "P0230" to "Fuel pump primary circuit",
        "P0261" to "Injector 1 circuit low",
        "P0262" to "Injector 1 circuit high",
        "P0300" to "Random / multiple misfire",
        "P0301" to "Cylinder 1 misfire",
        "P0335" to "Crankshaft position sensor",
        "P0340" to "Camshaft position sensor",
        "P0351" to "Ignition coil circuit",
        "P0500" to "Vehicle speed sensor",
        "P0505" to "Idle air control system",
        "P0560" to "System voltage fault",
        "P0562" to "System voltage low (battery)",
        "P0563" to "System voltage high",
        "P0601" to "ECU memory checksum error",
        "P0650" to "MIL control circuit",
        "C0031" to "Front wheel speed sensor circuit",
        "C0034" to "Rear wheel speed sensor circuit",
        "C0040" to "ABS modulator fault"
    )

    fun describe(code: String): String {
        DtcDb.get(code)?.name?.takeIf { it.isNotBlank() }?.let { return it }
        dtcInfo[code]?.let { return it }
        if (code.length == 5) return Advisor.family(code).first
        return when {
            code.length >= 2 && code[1] != '0' -> "Manufacturer-specific code — see service manual"
            code.startsWith("P") -> "Engine / powertrain fault"
            code.startsWith("C") -> "Chassis fault (ABS / brakes)"
            code.startsWith("B") -> "Body electrical fault"
            else -> "Network / communication fault"
        }
    }
}
