package net.juspay.xynespaces.transitkey

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import android.util.Log
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.math.BigInteger
import java.security.GeneralSecurityException
import java.security.InvalidKeyException
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.UnrecoverableKeyException
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.Executors
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The transit key on Android, an ECDH P-256 key that needs no user authentication (so it never
 * prompts) and is per app, so each build flavor has its own:
 *
 * - The Keystore key: in StrongBox when the phone has one, else the TEE. It cannot be exported
 *   and ECDH runs inside the Keystore; only the 32-byte shared secret comes out.
 * - The wrapped key, whenever the Keystore key fails (on Android 11 and older the Keystore cannot
 *   do key agreement at all): a key made in software, stored in no-backup app storage encrypted
 *   with an AES key that lives in the Keystore. It is decrypted only for each ECDH and is useless
 *   off this phone.
 */
class TransitKeyModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    wrappedKeyFile = File(reactContext.applicationContext.noBackupFilesDir, WRAPPED_KEY_FILE)
  }

  override fun getName(): String = NAME

  /**
   * Resolves `{ publicKey: base64 65-byte point, storage }`, storage being
   * "strongbox" | "tee" | "software" (the Keystore key) or "wrapped".
   */
  @ReactMethod
  fun getPublicKey(promise: Promise) {
    executor.execute {
      try {
        val key = checkedKey()
        val result = Arguments.createMap()
        result.putString("publicKey", base64(key.publicPoint))
        result.putString("storage", key.storage)
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject(ERROR_CODE, error.message ?: error.javaClass.simpleName, error)
      }
    }
  }

  /** ECDH with a server's base64 uncompressed P-256 point; resolves the base64 32-byte secret. */
  @ReactMethod
  fun deriveSharedSecret(serverPoint: String, promise: Promise) {
    executor.execute {
      try {
        val point = Base64.decode(serverPoint, Base64.NO_WRAP)
        val serverKey = serverPublicKey(point)
        val secret = checkedKey().agree(serverKey)
        try {
          promise.resolve(base64(secret))
        } finally {
          secret.fill(0)
        }
      } catch (error: Exception) {
        promise.reject(ERROR_CODE, error.message ?: error.javaClass.simpleName, error)
      }
    }
  }

  private interface TransitKey {
    /** 0x04 ‖ X ‖ Y. */
    val publicPoint: ByteArray
    val storage: String

    /** ECDH: the 32-byte X coordinate, big-endian, as WebCrypto and CryptoKit give it. */
    fun agree(serverKey: PublicKey): ByteArray
  }

  /** The key held by the Keystore, which runs the ECDH itself. */
  private class KeystoreKey(
    private val privateKey: PrivateKey,
    override val publicPoint: ByteArray,
    override val storage: String,
  ) : TransitKey {
    override fun agree(serverKey: PublicKey): ByteArray =
      KeyAgreement.getInstance("ECDH", KEYSTORE_PROVIDER).run {
        init(privateKey)
        doPhase(serverKey, true)
        generateSecret()
      }
  }

  /** A software key stored encrypted under the Keystore's AES key, decrypted for each ECDH. */
  private class WrappedKey(
    override val publicPoint: ByteArray,
    private val iv: ByteArray,
    private val ciphertext: ByteArray,
  ) : TransitKey {
    override val storage = "wrapped"

    override fun agree(serverKey: PublicKey): ByteArray {
      val cipher = Cipher.getInstance(AES_GCM)
      cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
      // The public point is authenticated with the private key, so neither can be swapped.
      cipher.updateAAD(publicPoint)
      val encoded = cipher.doFinal(ciphertext)
      val privateKey = try {
        KeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_EC)
          .generatePrivate(PKCS8EncodedKeySpec(encoded))
      } finally {
        encoded.fill(0)
      }
      return KeyAgreement.getInstance("ECDH").run {
        init(privateKey)
        doPhase(serverKey, true)
        generateSecret()
      }
    }
  }

  /** A stored wrapped key that cannot be parsed. */
  private class CorruptKeyFile : GeneralSecurityException("Stored transit key file is corrupt")

  private class SelfCheckFailed :
    GeneralSecurityException("Transit key agreement self-check failed")

  companion object {
    const val NAME = "LotusTransitKey"
    private const val TAG = "TransitKey"
    private const val ERROR_CODE = "TRANSIT_KEY_ERROR"
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val KEY_ALIAS = "xyne_transit_key"
    private const val WRAPPING_KEY_ALIAS = "xyne_transit_wrapping_key"
    private const val WRAPPED_KEY_FILE = "transit-key.bin"
    private const val WRAPPED_KEY_VERSION: Byte = 1
    private const val AES_GCM = "AES/GCM/NoPadding"
    private const val GCM_IV_LEN = 12
    private const val GCM_TAG_BITS = 128
    private const val COORD_LEN = 32
    private const val POINT_LEN = 1 + 2 * COORD_LEN

    /** DER header of a P-256 SubjectPublicKeyInfo; the 65-byte uncompressed point follows. */
    private val P256_SPKI_PREFIX = byteArrayOf(
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x02,
      0x01, 0x06, 0x08, 0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x03, 0x01, 0x07, 0x03,
      0x42, 0x00,
    )

    /** One thread for every key call, so two calls never create the key twice. */
    private val executor = Executors.newSingleThreadExecutor()

    /** The key, checked once per process; shared by every module instance (JS reloads). */
    @Volatile private var cached: TransitKey? = null

    private lateinit var wrappedKeyFile: File

    private fun checkedKey(): TransitKey {
      cached?.let { return it }
      // The Keystore key whenever it works; the wrapped key whenever it does not, on any phone.
      val key = try {
        keystoreKey()
      } catch (error: Exception) {
        Log.w(TAG, "Keystore key unavailable; using a wrapped key", error)
        wrappedKey()
      }
      cached = key
      return key
    }

    /** The key failed itself (invalidated, unreadable or wrong), not the Keystore around it. */
    private fun isKeyFailure(error: Exception): Boolean =
      error is InvalidKeyException || error is UnrecoverableKeyException ||
        error is BadPaddingException || error is CorruptKeyFile || error is SelfCheckFailed

    /**
     * Runs ECDH once with a throwaway software key and checks both sides agree, so a key that
     * cannot do key agreement (or a Keystore that gets it wrong) is caught here, not by the
     * server.
     */
    private fun selfChecked(key: TransitKey): TransitKey {
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC)
      generator.initialize(ECGenParameterSpec("secp256r1"))
      val probe = generator.generateKeyPair()
      val ours = key.agree(probe.public)
      val theirs = KeyAgreement.getInstance("ECDH").run {
        init(probe.private)
        doPhase(serverPublicKey(key.publicPoint), true)
        generateSecret()
      }
      val matches = ours.contentEquals(theirs)
      ours.fill(0)
      theirs.fill(0)
      if (!matches) throw SelfCheckFailed()
      return key
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }

    // Keystore key (Android 12+)

    private fun keystoreKey(): TransitKey {
      // Key agreement came to the Keystore in Android 12; before that this tier fails here, as
      // it would on any Keystore that cannot do it, instead of calling APIs the phone lacks.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        throw UnsupportedOperationException("This Keystore cannot do key agreement")
      }
      val stored = storedKeystoreKey() ?: return newKeystoreKey()
      return try {
        selfChecked(stored)
      } catch (error: Exception) {
        // Only a key that is itself broken is replaced, never one hit by a passing error.
        if (!isKeyFailure(error)) throw error
        Log.w(TAG, "Stored transit key is unusable; creating a new one", error)
        keyStore().deleteEntry(KEY_ALIAS)
        newKeystoreKey()
      }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun storedKeystoreKey(): TransitKey? {
      val entry = keyStore().getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry ?: return null
      return keystoreKey(entry.privateKey, entry.certificate.publicKey)
    }

    /** A new key in StrongBox, else the TEE: some StrongBox chips cannot do key agreement. */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun newKeystoreKey(): TransitKey {
      try {
        return selfChecked(generateKeystoreKey(strongBox = true))
      } catch (error: Exception) {
        if (error !is StrongBoxUnavailableException) {
          Log.i(TAG, "StrongBox key unavailable; using the TEE", error)
        }
        keyStore().deleteEntry(KEY_ALIAS)
      }
      return selfChecked(generateKeystoreKey(strongBox = false))
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun generateKeystoreKey(strongBox: Boolean): TransitKey {
      val generator =
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER)
      generator.initialize(
        KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_AGREE_KEY)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setIsStrongBoxBacked(strongBox)
          .build()
      )
      val pair = generator.generateKeyPair()
      return keystoreKey(pair.private, pair.public)
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun keystoreKey(privateKey: PrivateKey, publicKey: PublicKey): TransitKey {
      val info = KeyFactory.getInstance(privateKey.algorithm, KEYSTORE_PROVIDER)
        .getKeySpec(privateKey, KeyInfo::class.java)
      val storage = when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        else -> "software"
      }
      return KeystoreKey(privateKey, uncompressedPoint(publicKey as ECPublicKey), storage)
    }

    // Wrapped key (older Android)

    private fun wrappedKey(): TransitKey {
      val stored = try {
        readWrappedKey()
      } catch (error: CorruptKeyFile) {
        Log.w(TAG, "Stored transit key file is corrupt; creating a new one", error)
        deleteWrappedKey()
        null
      }
      if (stored != null) {
        try {
          return selfChecked(stored)
        } catch (error: Exception) {
          if (!isKeyFailure(error)) throw error
          Log.w(TAG, "Stored transit key is unusable; creating a new one", error)
          deleteWrappedKey()
        }
      }
      return selfChecked(createWrappedKey())
    }

    /** File: version (1) ‖ public point (65) ‖ IV (12) ‖ AES-GCM ciphertext of the PKCS#8. */
    private fun readWrappedKey(): WrappedKey? {
      if (!wrappedKeyFile.exists()) return null
      val bytes = wrappedKeyFile.readBytes()
      val header = 1 + POINT_LEN + GCM_IV_LEN
      if (bytes.size <= header || bytes[0] != WRAPPED_KEY_VERSION) throw CorruptKeyFile()
      return WrappedKey(
        publicPoint = bytes.copyOfRange(1, 1 + POINT_LEN),
        iv = bytes.copyOfRange(1 + POINT_LEN, header),
        ciphertext = bytes.copyOfRange(header, bytes.size),
      )
    }

    private fun createWrappedKey(): WrappedKey {
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC)
      generator.initialize(ECGenParameterSpec("secp256r1"))
      val pair = generator.generateKeyPair()
      val point = uncompressedPoint(pair.public as ECPublicKey)

      val cipher = Cipher.getInstance(AES_GCM)
      // The Keystore picks a fresh random IV for every encryption.
      cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
      cipher.updateAAD(point)
      val encoded = pair.private.encoded
      val ciphertext = try {
        cipher.doFinal(encoded)
      } finally {
        encoded.fill(0)
      }
      val key = WrappedKey(point, cipher.iv, ciphertext)

      // Written whole, then renamed, so a crash never leaves half a key file.
      val temp = File(wrappedKeyFile.parentFile, "$WRAPPED_KEY_FILE.tmp")
      temp.writeBytes(byteArrayOf(WRAPPED_KEY_VERSION) + point + cipher.iv + ciphertext)
      if (!temp.renameTo(wrappedKeyFile)) {
        temp.delete()
        throw IllegalStateException("Cannot store the transit key")
      }
      return key
    }

    private fun deleteWrappedKey() {
      wrappedKeyFile.delete()
      keyStore().deleteEntry(WRAPPING_KEY_ALIAS)
    }

    /** The Keystore AES-256-GCM key that encrypts the stored key; created on first use. */
    private fun wrappingKey(): SecretKey {
      (keyStore().getKey(WRAPPING_KEY_ALIAS, null) as? SecretKey)?.let { return it }
      val generator =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
      generator.init(
        KeyGenParameterSpec.Builder(
          WRAPPING_KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build()
      )
      return generator.generateKey()
    }

    // Encoding

    /** A server's 65-byte uncompressed point (0x04 ‖ X ‖ Y); one off the curve is refused. */
    private fun serverPublicKey(point: ByteArray): PublicKey {
      require(point.size == POINT_LEN && point[0] == 0x04.toByte()) {
        "serverPoint must be a 65-byte uncompressed P-256 point"
      }
      return KeyFactory.getInstance(KeyProperties.KEY_ALGORITHM_EC)
        .generatePublic(X509EncodedKeySpec(P256_SPKI_PREFIX + point))
    }

    private fun uncompressedPoint(key: ECPublicKey): ByteArray =
      byteArrayOf(0x04) + coordinate(key.w.affineX) + coordinate(key.w.affineY)

    /** A coordinate as exactly 32 big-endian bytes (BigInteger adds or drops leading zeros). */
    private fun coordinate(value: BigInteger): ByteArray {
      val bytes = value.toByteArray()
      return when {
        bytes.size == COORD_LEN -> bytes
        bytes.size > COORD_LEN -> bytes.copyOfRange(bytes.size - COORD_LEN, bytes.size)
        else -> ByteArray(COORD_LEN - bytes.size) + bytes
      }
    }

    private fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
  }
}
