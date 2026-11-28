"""Cross-language checks for encrypted-call recording: the agent must produce exactly
what the backend (apps/backend/src/services/recordingEncryptionService.ts) accepts.

Run from python-agent/:  python -m unittest tests.test_recording_crypto
"""
import base64
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from infra.recording_crypto import (
    chunk_aad,
    completion_proof,
    decrypt_live_object,
    encrypt_live_object,
    manifest_aad,
)
from infra.recording_session import _unseal

SESSION = "0123456789abcdef"

# Generated with Node's crypto exactly as the backend does (see recordingEncryptionService.test.ts).
NODE_CHUNK_VECTOR = bytes.fromhex("01" + "01" * 12 + "1e84e5dbff9f837ea4a736e17d79c6dcfe0140d3f197ea0edf04")

# callEncryptionService.sealToAgent(info "xyne-agent-recording-key:v1", aad "call-vector|rec-vector")
# of a chunk key of 0x09 * 32, to the agent key whose private scalar is 0x05 * 32.
NODE_SEALED_KEY = {
    "ephemeralPublicKey": "WB39gxVkGeeVeL7pbvfWOKuK0XpH7+NQpSICmAT27DY=",
    "nonce": "NibgL5bmIih+P94H",
    "ciphertext": "u3DXXzxaUgP3DvB5uP+fdJRnqRPEXWkI7n4pZk+SIw/JcX3d1EALotE42iEjWFUW",
}
NODE_AGENT_PUBLIC_KEY = "UKYUCbHd0DJemxa3AOcZ6XcsBwALG9d4bpB8ZT0gSV0="
NODE_COMPLETION_PROOF = "f8DRlad55ScXJ34Eki2aGfl1T6wOEeypJPonMp6EOQo="


class LiveObjectTest(unittest.TestCase):
    def test_matches_the_backend_byte_for_byte(self):
        blob = encrypt_live_object(b"\x07" * 32, chunk_aad("rec-vector", SESSION, 2, 5), b"hello opus", nonce=b"\x01" * 12)
        self.assertEqual(blob, NODE_CHUNK_VECTOR)

    def test_round_trip_and_binding(self):
        key = b"\x11" * 32
        aad = chunk_aad("rec-1", SESSION, 0, 0)
        blob = encrypt_live_object(key, aad, b"ogg")
        self.assertEqual(decrypt_live_object(key, aad, blob), b"ogg")
        for other in (chunk_aad("rec-1", SESSION, 0, 1), chunk_aad("rec-2", SESSION, 0, 0), manifest_aad("rec-1", SESSION)):
            with self.assertRaises(Exception):
                decrypt_live_object(key, other, blob)

    def test_fresh_nonce_per_object(self):
        key = b"\x11" * 32
        aad = manifest_aad("rec-1", SESSION)
        self.assertNotEqual(encrypt_live_object(key, aad, b"x"), encrypt_live_object(key, aad, b"x"))

    def test_rejects_bad_keys(self):
        with self.assertRaises(ValueError):
            encrypt_live_object(b"short", b"aad", b"x")


class SealedKeyTest(unittest.TestCase):
    def test_unseals_what_the_backend_sealed(self):
        private_key = X25519PrivateKey.from_private_bytes(b"\x05" * 32)
        public = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.assertEqual(base64.b64encode(public).decode(), NODE_AGENT_PUBLIC_KEY)
        self.assertEqual(_unseal(private_key, NODE_SEALED_KEY, b"call-vector|rec-vector"), b"\x09" * 32)

    def test_refuses_another_recording(self):
        private_key = X25519PrivateKey.from_private_bytes(b"\x05" * 32)
        with self.assertRaises(Exception):
            _unseal(private_key, NODE_SEALED_KEY, b"call-vector|rec-other")

    def test_completion_proof_matches_the_backend(self):
        proof = completion_proof(b"\x09" * 32, "rec-vector", SESSION)
        self.assertEqual(base64.b64encode(proof).decode(), NODE_COMPLETION_PROOF)


if __name__ == "__main__":
    unittest.main()
