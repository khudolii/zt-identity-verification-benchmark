# ZT Benchmark — Zero Trust Identity Verification

Experimental comparison of three cross-domain identity verification mechanisms
in a multi-cloud Zero Trust environment.

## Architecture

```
Hetzner VM 1 (IdP)         GCP VM (Resource)            Hetzner VM 2 (Load Gen)
┌──────────────────┐       ┌──────────────────────┐      ┌──────────────────┐
│                  │       │                      │      │                  │
│   Keycloak       │◄──────│   Service B          │◄─────│   k6             │
│   :8080          │       │   :8081              │      │                  │
│                  │       │                      │      │                  │
└──────────────────┘       └──────────────────────┘      └──────────────────┘
  "IdP domain"               "Resource domain"             "Client domain"
  Hetzner Cloud               GCP                           Hetzner Cloud
```

## Scenarios

| # | Endpoint                         | Mechanism                      | Keycloak dependency      |
|---|----------------------------------|--------------------------------|--------------------------|
| 1 | POST /api/resource/introspection | Token Introspection (RFC 7662) | Every request (SPOF)     |
| 2 | POST /api/resource/jwt           | Short-lived JWT (local)        | Startup only (JWKS)      |
| 3 | POST /api/resource/vc            | DID/VC (Ed25519)               | None                     |

## Deployment

All services are deployed automatically via GitHub Actions on push to `master`.
See `.github/workflows/` for details.

### Required GitHub Secrets

| Secret | Used by | Value |
|---|---|---|
| `HETZNER_HOST` | Keycloak deploy, Service B deploy | Hetzner VM 1 IP |
| `HETZNER_USER` | Keycloak deploy | SSH username |
| `HETZNER_SSH_KEY` | Keycloak deploy | Private SSH key |
| `KEYCLOAK_ADMIN` | Keycloak deploy | Admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak deploy | Admin password |
| `GCP_HOST` | Service B deploy | GCP VM IP |
| `GCP_USER` | Service B deploy | SSH username |
| `GCP_SSH_KEY` | Service B deploy | Private SSH key |
| `KEYCLOAK_REALM` | Service B deploy | `zt-benchmark` |
| `KEYCLOAK_CLIENT_ID` | Service B deploy | `service-b` |
| `KEYCLOAK_CLIENT_SECRET` | Service B deploy | `service-b-secret` |
| `TRUSTED_ISSUER_PUBLIC_KEY` | Service B deploy | Base64 key from `generate_vp.py` |

## Setup

### Step 1 — Generate Ed25519 keypair

Run once on your local machine before first deployment:

```bash
pip3 install cryptography
python3 scripts/generate_vp.py
# → creates vp.json (used by k6) and public_key.txt
# → copy public_key.txt content into the TRUSTED_ISSUER_PUBLIC_KEY GitHub secret
```

### Step 2 — Push to master

GitHub Actions will:
1. Build and push `keycloak-zt` image to GHCR → deploy to Hetzner VM 1
2. Build and push `service-b` image to GHCR → deploy to GCP VM

Keycloak starts with the `zt-benchmark` realm pre-configured and `dev/dev` user
provisioned automatically via `init-users.sh`.

### Step 3 — Hetzner VM 2: Install k6

```bash
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6

# Copy vp.json (generated in Step 1) to this machine
scp vp.json <HETZNER_VM2_USER>@<HETZNER_VM2_IP>:~/zt-benchmark/
```

### Step 4 — Run benchmarks

```bash
# Get token from Keycloak (scenarios 1 & 2)
TOKEN=$(curl -s -X POST \
  http://<HETZNER_VM1_IP>:8080/realms/zt-benchmark/protocol/openid-connect/token \
  -d "grant_type=client_credentials&client_id=service-a&client_secret=service-a-secret" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Measure baseline RTT
ping -c 20 <GCP_VM_IP> | tail -1

# Warmup (results discarded)
k6 run --vus 10 --duration 30s \
  -e SERVICE_B_IP=<GCP_VM_IP> -e TOKEN=$TOKEN \
  k6/scenario-1-introspection.js

# Scenario 1: Token Introspection
k6 run --out json=results/introspection.json \
  -e SERVICE_B_IP=<GCP_VM_IP> -e TOKEN=$TOKEN \
  k6/scenario-1-introspection.js

sleep 120

# Scenario 2: JWT
k6 run --out json=results/jwt.json \
  -e SERVICE_B_IP=<GCP_VM_IP> -e TOKEN=$TOKEN \
  k6/scenario-2-jwt.js

sleep 120

# Scenario 3: VC
k6 run --out json=results/vc.json \
  -e SERVICE_B_IP=<GCP_VM_IP> \
  k6/scenario-3-vc.js
```

### Step 5 — Failover test

```bash
# Terminal 1: start failover test
k6 run --out json=results/failover.json \
  -e SERVICE_B_IP=<GCP_VM_IP> -e TOKEN=$TOKEN \
  k6/failover-test.js

# Terminal 2: stop Keycloak mid-test (on Hetzner VM 1)
docker stop keycloak
```

### Step 6 — Generate figures

```bash
pip3 install matplotlib numpy
python3 scripts/plot_results.py \
  --introspection results/introspection.json \
  --jwt results/jwt.json \
  --vc results/vc.json \
  --failover results/failover.json
```

## Local Development

```bash
docker network create zt-local

# Keycloak
docker build -t keycloak-zt ./keycloak
docker run -d --name keycloak --network zt-local -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin \
  keycloak-zt

# Service B (after Keycloak is ready)
docker build -t service-b-zt ./service-b
docker run -d --name service-b --network zt-local -p 8081:8081 \
  -e KEYCLOAK_URL=http://keycloak:8080 \
  -e KEYCLOAK_REALM=zt-benchmark \
  -e KEYCLOAK_CLIENT_ID=service-b \
  -e KEYCLOAK_CLIENT_SECRET=service-b-secret \
  -e TRUSTED_ISSUER_PUBLIC_KEY=$(cat scripts/public_key.txt) \
  service-b-zt

# Get token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/zt-benchmark/protocol/openid-connect/token \
  -d "grant_type=password&client_id=service-a&client_secret=service-a-secret&username=dev&password=dev" \
  | jq -r .access_token)

curl -s -X POST http://localhost:8081/api/resource/introspection -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST http://localhost:8081/api/resource/jwt           -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST http://localhost:8081/api/resource/vc \
  -H "Content-Type: application/json" -d @scripts/vp.json | jq
```

## Project Structure

```
zt-benchmark/
├── .github/workflows/
│   ├── deploy-keycloak.yml            # Build & deploy Keycloak → Hetzner VM 1
│   └── deploy-service-b.yml           # Build & deploy Service B → GCP VM
├── keycloak/
│   ├── Dockerfile                     # Keycloak 24 + baked-in realm
│   ├── realm-export.json              # zt-benchmark realm (clients only)
│   └── init-users.sh                  # Provisions dev/dev via kcadm at startup
├── service-b/                         # Spring Boot resource service (GCP VM)
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/main/java/com/zt/benchmark/
│       ├── controller/ResourceController.java
│       └── service/
│           ├── IntrospectionVerificationService.java  # Scenario 1
│           ├── JwtVerificationService.java            # Scenario 2
│           └── VcVerificationService.java             # Scenario 3
├── k6/                                # Load test scripts (Hetzner VM 2)
│   ├── scenario-1-introspection.js
│   ├── scenario-2-jwt.js
│   ├── scenario-3-vc.js
│   └── failover-test.js
└── scripts/
    ├── generate_vp.py                 # One-time Ed25519 keypair + VP generation
    └── plot_results.py                # Generate figures for paper
```
