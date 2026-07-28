package com.example.app

// Stub — Manifest n'est pas disponible dans un projet JVM console
object Manifest {
    object permission {
        const val INTERNET                = "android.permission.INTERNET"
        const val ACCESS_NETWORK_STATE    = "android.permission.ACCESS_NETWORK_STATE"
        const val CAMERA                  = "android.permission.CAMERA"
        const val ACCESS_FINE_LOCATION    = "android.permission.ACCESS_FINE_LOCATION"
        const val ACCESS_COARSE_LOCATION  = "android.permission.ACCESS_COARSE_LOCATION"
        const val ACCESS_BACKGROUND_LOCATION = "android.permission.ACCESS_BACKGROUND_LOCATION"
        const val READ_EXTERNAL_STORAGE   = "android.permission.READ_EXTERNAL_STORAGE"
        const val WRITE_EXTERNAL_STORAGE  = "android.permission.WRITE_EXTERNAL_STORAGE"
        const val RECORD_AUDIO            = "android.permission.RECORD_AUDIO"
        const val READ_CONTACTS           = "android.permission.READ_CONTACTS"
        const val READ_PHONE_STATE        = "android.permission.READ_PHONE_STATE"
        const val POST_NOTIFICATIONS      = "android.permission.POST_NOTIFICATIONS"
        const val FOREGROUND_SERVICE      = "android.permission.FOREGROUND_SERVICE"
        const val RECEIVE_BOOT_COMPLETED  = "android.permission.RECEIVE_BOOT_COMPLETED"
        const val READ_MEDIA_IMAGES       = "android.permission.READ_MEDIA_IMAGES"
        const val VIBRATE                 = "android.permission.VIBRATE"
        const val BLUETOOTH               = "android.permission.BLUETOOTH"
        const val BLUETOOTH_CONNECT       = "android.permission.BLUETOOTH_CONNECT"
        const val NFC                     = "android.permission.NFC"
        const val USE_BIOMETRIC           = "android.permission.USE_BIOMETRIC"
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Permission description hover
//
// Hover sur Manifest.permission.XXX → description en anglais de la permission.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Constantes de permissions requises ────────────────────────────────────

object RequiredPermissions {
    val CAMERA            = Manifest.permission.CAMERA
    val LOCATION_FINE     = Manifest.permission.ACCESS_FINE_LOCATION
    val LOCATION_COARSE   = Manifest.permission.ACCESS_COARSE_LOCATION
    val INTERNET          = Manifest.permission.INTERNET
    val NETWORK_STATE     = Manifest.permission.ACCESS_NETWORK_STATE
    val STORAGE_READ      = Manifest.permission.READ_EXTERNAL_STORAGE
    val STORAGE_WRITE     = Manifest.permission.WRITE_EXTERNAL_STORAGE
    val MICROPHONE        = Manifest.permission.RECORD_AUDIO
    val CONTACTS          = Manifest.permission.READ_CONTACTS
    val PHONE_STATE       = Manifest.permission.READ_PHONE_STATE
    val NOTIFICATIONS     = Manifest.permission.POST_NOTIFICATIONS
    val MEDIA_IMAGES      = Manifest.permission.READ_MEDIA_IMAGES
    val BLUETOOTH         = Manifest.permission.BLUETOOTH
    val BLUETOOTH_CONNECT = Manifest.permission.BLUETOOTH_CONNECT
    val NFC               = Manifest.permission.NFC
    val BIOMETRIC         = Manifest.permission.USE_BIOMETRIC
}

// ── 2. Groupes de permissions par feature ────────────────────────────────────

val cameraFeaturePermissions = listOf(
    Manifest.permission.CAMERA,
    Manifest.permission.RECORD_AUDIO,
)

val locationFeaturePermissions = listOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
    Manifest.permission.ACCESS_BACKGROUND_LOCATION,
)

val storagePermissions = listOf(
    Manifest.permission.READ_EXTERNAL_STORAGE,
    Manifest.permission.WRITE_EXTERNAL_STORAGE,
    Manifest.permission.READ_MEDIA_IMAGES,
)

// ── 3. Param par défaut ───────────────────────────────────────────────────────

fun requestPermission(
    permission: String = Manifest.permission.INTERNET,
    rationale: String = "Required for network access",
) = Unit

fun checkAndRequest(perm: String = Manifest.permission.CAMERA) = Unit

// ── 4. when ──────────────────────────────────────────────────────────────────

fun permissionLabel(perm: String): String = when (perm) {
    Manifest.permission.CAMERA               -> "Camera"
    Manifest.permission.ACCESS_FINE_LOCATION -> "GPS Location"
    Manifest.permission.RECORD_AUDIO         -> "Microphone"
    Manifest.permission.READ_CONTACTS        -> "Contacts"
    Manifest.permission.INTERNET             -> "Internet"
    Manifest.permission.POST_NOTIFICATIONS   -> "Notifications"
    Manifest.permission.BLUETOOTH_CONNECT    -> "Bluetooth"
    Manifest.permission.USE_BIOMETRIC        -> "Biometrics"
    else                                     -> "Unknown permission"
}

// ── 5. Vérification runtime ───────────────────────────────────────────────────

private fun isGranted(@Suppress("UNUSED_PARAMETER") perm: String): Boolean = true  // stub

fun hasAllPermissions(): Boolean =
    isGranted(Manifest.permission.CAMERA) &&
    isGranted(Manifest.permission.ACCESS_FINE_LOCATION) &&
    isGranted(Manifest.permission.INTERNET)

fun hasAnyMediaPermission(): Boolean =
    isGranted(Manifest.permission.READ_MEDIA_IMAGES) ||
    isGranted(Manifest.permission.READ_EXTERNAL_STORAGE)

// ── 6. Sealed class de résultat ───────────────────────────────────────────────

sealed class PermissionResult(val permission: String) {
    class Granted(permission: String) : PermissionResult(permission)
    class Denied(permission: String, val canAskAgain: Boolean) : PermissionResult(permission)
    class PermanentlyDenied(permission: String) : PermissionResult(permission)
}

fun handleResult(result: PermissionResult) = when (result) {
    is PermissionResult.Granted           -> println("${result.permission} granted")
    is PermissionResult.Denied            -> println("${result.permission} denied, retry=${result.canAskAgain}")
    is PermissionResult.PermanentlyDenied -> println("${result.permission} permanently denied")
}

// ── 7. Map permission → icône ─────────────────────────────────────────────────

val permissionIcons = mapOf(
    Manifest.permission.CAMERA               to "camera",
    Manifest.permission.ACCESS_FINE_LOCATION to "location",
    Manifest.permission.RECORD_AUDIO         to "mic",
    Manifest.permission.INTERNET             to "wifi",
    Manifest.permission.POST_NOTIFICATIONS   to "bell",
    Manifest.permission.USE_BIOMETRIC        to "fingerprint",
    Manifest.permission.BLUETOOTH_CONNECT    to "bluetooth",
    Manifest.permission.NFC                  to "nfc",
)
