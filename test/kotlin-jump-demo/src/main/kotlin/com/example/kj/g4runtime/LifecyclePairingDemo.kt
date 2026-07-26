package com.example.kj.g4runtime

import com.example.kj.stubs.BroadcastReceiver
import com.example.kj.stubs.DemoActivity
import com.example.kj.stubs.Intent
import com.example.kj.stubs.IntentFilter
import com.example.kj.stubs.LocationListener
import com.example.kj.stubs.WakeLock

/**
 * KJ-016: Lifecycle Pairing.
 * Expected per scenario:
 *  1. batteryReceiver: full onStart/onStop pair → paired gutter, NO warning.
 *  2. gpsListener: requestLocationUpdates in onResume, NEVER removed → warning
 *     "removeUpdates missing in onPause" on the request line.
 *  3. wakeLock: release done in a helper called by onDestroy (one level of
 *     indirection) → NO warning.
 */
class BattleActivity : DemoActivity() {

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(intent: Intent) {}
    }

    private val gpsListener = object : LocationListener {
        override fun onLocationChanged(lat: Double, lon: Double) {}
    }

    private val wakeLock = WakeLock()

    override fun onCreate() {
        wakeLock.acquire()
    }

    override fun onStart() {
        // Scenario 1: opening half, the mirror exists in onStop.
        registerReceiver(batteryReceiver, IntentFilter("BATTERY_CHANGED"))
    }

    override fun onResume() {
        // Scenario 2: ⚠ warning expected, no removeUpdates in onPause.
        requestLocationUpdates(gpsListener)
    }

    override fun onStop() {
        unregisterReceiver(batteryReceiver)
    }

    override fun onDestroy() {
        releaseResources()
    }

    // Scenario 3: indirection, the provider must follow one call level.
    private fun releaseResources() {
        wakeLock.release()
    }
}
