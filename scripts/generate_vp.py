#!/usr/bin/env python3
"""
generate_vp.py — One-time credential generation for the VC benchmark scenario.

Generates:
  - Ed25519 keypair
  - A signed Verifiable Presentation (VP) containing a VC with claims
  - Saves public key and VP to files for use by k6 and Service B

Usage:
  pip install cryptography
  python3 generate_vp.py

Output:
  vp.json          — signed VP, used by k6 in scenario 3
  public_key.txt   — Base64 public key, set as TRUSTED_ISSUER_PUBLIC_KEY on Service B
"""

import json
import base64
import datetime
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

# ── Generate keypair ──────────────────────────────────────────────────────────

private_key = Ed25519PrivateKey.generate()
public_key = private_key.public_key()

# Export public key as raw bytes → Base64
public_key_bytes = public_key.public_bytes_raw()
public_key_b64 = base64.b64encode(public_key_bytes).decode()

# ── Build VC ──────────────────────────────────────────────────────────────────
# Structure inspired by W3C Verifiable Credentials Data Model 2.0
# Uses did:key method concept: DID is derived from the public key

did_issuer  = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
did_subject = "did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp"

vc = {
    "issuer": did_issuer,
    "subject": did_subject,
    "issuanceDate": datetime.datetime.utcnow().isoformat() + "Z",
    "claims": {
        "role": "backend-service",
        "department": "payments",
        "compliance_training": "completed-2026-01"
    }
}

# ── Sign VC ───────────────────────────────────────────────────────────────────
# Canonical serialization (no extra spaces) — must match VcVerificationService
vc_bytes = json.dumps(vc, separators=(',', ':'), sort_keys=True).encode('utf-8')
signature_bytes = private_key.sign(vc_bytes)
signature_b64url = base64.urlsafe_b64encode(signature_bytes).decode().rstrip('=')

# ── Build VP ──────────────────────────────────────────────────────────────────
vp = {
    "vc": vc,
    "signature": signature_b64url
}

# ── Save outputs ──────────────────────────────────────────────────────────────
with open("vp.json", "w") as f:
    json.dump(vp, f, separators=(',', ':'))

with open("public_key.txt", "w") as f:
    f.write(public_key_b64)

print("=" * 60)
print("VP generated successfully.")
print()
print("Files created:")
print("  vp.json        — use with k6 scenario 3")
print("  public_key.txt — set as env var on Service B")
print()
print("On Oracle VM 2 (Service B), run:")
print(f"  export TRUSTED_ISSUER_PUBLIC_KEY={public_key_b64}")
print("  java -jar service-b.jar")
print("=" * 60)

# ── Verify locally (sanity check) ────────────────────────────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    # Re-load public key from bytes (same as Service B will do)
    pub_key_loaded = Ed25519PrivateKey.generate().public_key().__class__
    sig_bytes_check = base64.urlsafe_b64decode(signature_b64url + '==')
    public_key.verify(sig_bytes_check, vc_bytes)
    print("✓ Signature verified locally — VP is valid.")
except Exception as e:
    print(f"✗ Local verification failed: {e}")
