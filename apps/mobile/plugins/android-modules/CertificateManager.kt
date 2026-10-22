package net.juspay.xynespaces.certificate

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import net.juspay.xynespaces.BuildConfig
import java.io.ByteArrayInputStream
import java.security.*
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

class CertificateManager private constructor() {

    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "ClientIdentity"
        private const val EC_KEY_SIZE = 384
        private const val PREFS_NAME = "mtls_enrollment_prefs"
        private const val PREF_ENROLLED = "enrollment_complete"

        @Volatile
        private var INSTANCE: CertificateManager? = null

        fun getInstance(): CertificateManager {
            return INSTANCE
                ?: throw IllegalStateException("CertificateManager not initialized. Call initialize() first.")
        }

        fun initialize(context: Context): CertificateManager {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: CertificateManager().also { INSTANCE = it }
            }
        }

        fun getInstanceOrNull(): CertificateManager? = INSTANCE
    }

    private var prefs: SharedPreferences? = null

    private fun getKeyStore(): KeyStore {
        return KeyStore.getInstance(KEYSTORE_PROVIDER).apply {
            load(null)
        }
    }

    fun isEnrolled(ctx: Context): Boolean {
        if (!BuildConfig.MTLS_ENABLED) {
            return true
        }

        try {
            val keyStore = getKeyStore()
            val hasKey = keyStore.containsAlias(KEY_ALIAS)
            if (!hasKey) return false

            val keyEntry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            val hasCert = keyEntry?.certificate != null
            val hasCertChain = keyEntry?.certificateChain?.isNotEmpty() == true
            val enrollmentFlagSet = getPrefs(ctx).getBoolean(PREF_ENROLLED, false)

            return hasCert && hasCertChain && enrollmentFlagSet
        } catch (e: Exception) {
            Log.e("CertificateManager", "Enrollment check error: ${e.message}", e)
            throw e
        }
    }

    fun hasPrivateKey(): Boolean {
        if (!BuildConfig.MTLS_ENABLED) {
            return false
        }

        try {
            val keyStore = getKeyStore()
            return keyStore.containsAlias(KEY_ALIAS)
        } catch (e: Exception) {
            Log.e("CertificateModule", "Check private key error: ${e.message}", e)
            throw e
        }
    }

    fun generateCSR(ctx: Context, deviceInfo: Map<String, String>): Pair<String, Map<String, String>> {
        if (!BuildConfig.MTLS_ENABLED) {
            throw IllegalStateException("mTLS enrollment is disabled for this build")
        }

        try {
            val keyStore = getKeyStore()

            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS)
            }
            getPrefs(ctx).edit().putBoolean(PREF_ENROLLED, false).apply()

            val keyPairGenerator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                KEYSTORE_PROVIDER
            )

            val keyPurposes = KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY

            val keyGenSpec = KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                keyPurposes
            )
                .setKeySize(EC_KEY_SIZE)
                .setDigests(
                    KeyProperties.DIGEST_SHA384,
                    KeyProperties.DIGEST_SHA256,
                    KeyProperties.DIGEST_NONE
                )
                .setUserAuthenticationRequired(false)
                .build()

            keyPairGenerator.initialize(keyGenSpec)
            val keyPair = keyPairGenerator.generateKeyPair()

            val subject = org.bouncycastle.asn1.x500.X500Name(
                "CN=lotus-android-${deviceInfo["device_fingerprint"]}, " +
                        "O=Juspay, OU=Lotus, C=IN"
            )

            val csrBuilder = org.bouncycastle.pkcs.jcajce.JcaPKCS10CertificationRequestBuilder(
                subject,
                keyPair.public
            )
            val signer = org.bouncycastle.operator.jcajce.JcaContentSignerBuilder("SHA384withECDSA")
                .build(keyPair.private)
            val csr = csrBuilder.build(signer)

            val csrPem = convertToPEM(csr.encoded, "CERTIFICATE REQUEST")

            return Pair(csrPem, deviceInfo)
        } catch (e: Exception) {
            Log.e("CertificateManager", "CSR generation error: ${e.message}", e)
            throw e
        }
    }

    fun storeCertificate(ctx: Context, certificatePem: String, caChainPem: String?): Boolean {
        if (!BuildConfig.MTLS_ENABLED) {
            throw IllegalStateException("mTLS enrollment is disabled for this build")
        }

        try {
            val keyStore = getKeyStore()
            val certFactory = CertificateFactory.getInstance("X.509")

            val deviceCertificate = certFactory.generateCertificate(
                ByteArrayInputStream(certificatePem.toByteArray())
            ) as X509Certificate

            val certificateChain = mutableListOf<X509Certificate>()
            certificateChain.add(deviceCertificate)

            if (!caChainPem.isNullOrEmpty()) {
                try {
                    val cleanedPem = caChainPem.trim()
                        .replace("\r\n", "\n")
                        .replace("\r", "\n")

                    val caInputStream = ByteArrayInputStream(cleanedPem.toByteArray(Charsets.UTF_8))
                    val caCertificates = certFactory.generateCertificates(caInputStream)
                    val caCertList = caCertificates.filterIsInstance<X509Certificate>()

                    if (caCertList.isNotEmpty()) {
                        certificateChain.addAll(caCertList)
                    }
                } catch (e: Exception) {
                    Log.w("CertificateManager", "Failed to parse CA chain: ${e.message}")
                }
            }

            if (!keyStore.containsAlias(KEY_ALIAS)) {
                throw Exception("Private key alias not found in keystore. Please generate CSR first.")
            }

            val privateKeyEntry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
                ?: throw Exception("Private key entry not found")

            val privateKey = privateKeyEntry.privateKey
            val certificatePublicKey = deviceCertificate.publicKey

            if (certificatePublicKey.algorithm != "EC") {
                throw Exception("Certificate must use EC key algorithm, got: ${certificatePublicKey.algorithm}")
            }

            if (privateKey.algorithm != "EC") {
                throw Exception("Private key must use EC algorithm, got: ${privateKey.algorithm}")
            }

            try {
                val testData = "test-signature-validation".toByteArray()
                val signature = Signature.getInstance("SHA384withECDSA")
                signature.initSign(privateKey)
                signature.update(testData)
                val signatureBytes = signature.sign()

                val verify = Signature.getInstance("SHA384withECDSA")
                verify.initVerify(deviceCertificate.publicKey)
                verify.update(testData)

                if (!verify.verify(signatureBytes)) {
                    throw Exception("Certificate public key does not match private key!")
                }
            } catch (e: Exception) {
                throw Exception("Public/Private key mismatch: ${e.message}")
            }

            keyStore.setKeyEntry(
                KEY_ALIAS,
                privateKeyEntry.privateKey,
                null,
                certificateChain.toTypedArray()
            )

            getPrefs(ctx).edit().putBoolean(PREF_ENROLLED, true).apply()

            val verifyKeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply {
                load(null)
            }
            val verifyEntry = verifyKeyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            if (verifyEntry?.certificate == null) {
                throw Exception("Certificate verification failed after storage")
            }

            return true
        } catch (e: Exception) {
            Log.e("CertificateManager", "Certificate storage error: ${e.message}", e)
            throw e
        }
    }

    fun getCertificate(): String? {
        if (!BuildConfig.MTLS_ENABLED) {
            return null
        }

        try {
            val keyStore = getKeyStore()
            val keyEntry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
            val cert = keyEntry?.certificate as? X509Certificate ?: return null
            return convertToPEM(cert.encoded, "CERTIFICATE")
        } catch (e: Exception) {
            throw e
        }
    }

    fun clearCertificates(ctx: Context): Boolean {
        try {
            val keyStore = getKeyStore()
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS)
            }
            getPrefs(ctx).edit().putBoolean(PREF_ENROLLED, false).apply()
            return true
        } catch (e: Exception) {
            throw e
        }
    }

    fun getDeviceInfo(): Map<String, String> {
        val deviceFingerprint = generateDeviceId()
        val deviceName = "${android.os.Build.MANUFACTURER}-${android.os.Build.MODEL}"

        return mapOf(
            "device_name" to deviceName,
            "platform" to "MOBILE",
            "os_type" to "Android",
            "os_version" to android.os.Build.VERSION.RELEASE,
            "device_fingerprint" to deviceFingerprint
        )
    }

    private fun generateDeviceId(): String {
        val deviceIdSource =
            "${android.os.Build.MANUFACTURER}-${android.os.Build.MODEL}-${android.os.Build.SERIAL ?: "unknown"}"
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(deviceIdSource.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }.substring(0, 32)
    }

    private fun convertToPEM(der: ByteArray, type: String): String {
        val base64 = Base64.encodeToString(der, Base64.NO_WRAP)
        val pemBuilder = StringBuilder()
        pemBuilder.append("-----BEGIN $type-----\n")

        var index = 0
        while (index < base64.length) {
            val end = minOf(index + 64, base64.length)
            pemBuilder.append(base64.substring(index, end))
            pemBuilder.append("\n")
            index = end
        }
        pemBuilder.append("-----END $type-----\n")
        return pemBuilder.toString()
    }

    private fun getPrefs(ctx: Context): SharedPreferences {
        return prefs ?: ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).also { prefs = it }
    }
}
