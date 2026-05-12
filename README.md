# ZT Benchmark — Zero Trust Identity Verification

Experimental comparison of three cross-domain identity verification mechanisms
in a multi-cloud Zero Trust environment.

## Architecture

```
Oracle VM 1 (IdP)          Oracle VM 2 (Resource)       GCP (Load Generator)
┌──────────────────┐       ┌──────────────────────┐      ┌──────────────────┐
│                  │       │                      │      │                  │
│   Keycloak       │◄──────│   Service B          │◄─────│   k6             │
│   :8080          │       │   :8081              │      │                  │
│                  │       │                      │      │                  │
└──────────────────┘       └──────────────────────┘      └──────────────────┘
  "IdP domain"               "Resource domain"             "Client domain"
  Oracle Cloud                Oracle Cloud                     GCP
```

## Scenarios

| # | Endpoint                   | Mechanism               | Keycloak dependency      |
|---|----------------------------|-------------------------|--------------------------|
| 1 | POST /api/resource/introspection | Token Introspection (RFC 7662) | Every request (SPOF) |
| 2 | POST /api/resource/jwt     | Short-lived JWT (local) | Startup only (JWKS)      |
| 3 | POST /api/resource/vc      | DID/VC (Ed25519)        | None                     |

## Setup

### Step 1 — Oracle VM 1: Deploy Keycloak

```bash
# Install Docker
sudo apt-get update && sudo apt-get install -y docker.io
sudo systemctl start docker

# Open port 8080 in Oracle Security List (console)

# Run Keycloak
docker run -d -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  -v $(pwd)/keycloak/realm-export.json:/opt/keycloak/data/import/realm-export.json \
  quay.io/keycloak/keycloak:24.0 start-dev --import-realm

# Verify
curl http://localhost:8080/health/ready
```

### Step 2 — Oracle VM 2: Deploy Service B

```bash
# Install Java 21 and Maven
sudo apt-get install -y openjdk-21-jdk maven

# Open port 8081 in Oracle Security List (console)

# Build
cd service-b
mvn clean package -DskipTests

# Run (replace values with your actual IPs and generated public key)
export KEYCLOAK_URL=http://<ORACLE_VM1_IP>:8080
export TRUSTED_ISSUER_PUBLIC_KEY=<base64_key_from_generate_vp.py>
java -Xmx512m -jar target/service-b-0.0.1-SNAPSHOT.jar
```

### Step 3 — GCP VM: Generate VP and run k6

```bash
# Install Python deps
pip3 install cryptography

# Generate Ed25519 keypair and signed VP
python3 scripts/generate_vp.py
# → creates vp.json and public_key.txt
# → copy public_key.txt content to Oracle VM 2 as TRUSTED_ISSUER_PUBLIC_KEY

# Install k6
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6

# Get token from Keycloak
TOKEN=$(curl -s -X POST \
  http://<ORACLE_VM1_IP>:8080/realms/zt-benchmark/protocol/openid-connect/token \
  -d "grant_type=client_credentials&client_id=service-a&client_secret=service-a-secret" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Measure baseline RTT
ping -c 20 <ORACLE_VM2_IP> | tail -1
```

### Step 4 — Run benchmarks

```bash
# Warmup (results discarded)
k6 run --vus 10 --duration 30s \
  -e SERVICE_B_IP=<ORACLE_VM2_IP> -e TOKEN=$TOKEN \
  k6/scenario-1-introspection.js

# Scenario 1: Token Introspection
k6 run --out json=results/introspection.json \
  -e SERVICE_B_IP=<ORACLE_VM2_IP> -e TOKEN=$TOKEN \
  k6/scenario-1-introspection.js

# Wait 2 minutes between tests
sleep 120

# Scenario 2: JWT
k6 run --out json=results/jwt.json \
  -e SERVICE_B_IP=<ORACLE_VM2_IP> -e TOKEN=$TOKEN \
  k6/scenario-2-jwt.js

sleep 120

# Scenario 3: VC
k6 run --out json=results/vc.json \
  -e SERVICE_B_IP=<ORACLE_VM2_IP> \
  k6/scenario-3-vc.js
```

### Step 5 — Failover test

```bash
# Terminal 1: start failover test
k6 run --out json=results/failover.json \
  -e SERVICE_B_IP=<ORACLE_VM2_IP> -e TOKEN=$TOKEN \
  k6/failover-test.js

# Terminal 2: stop Keycloak after ~60 seconds
# (on Oracle VM 1)
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

## Project Structure

```
zt-benchmark/
├── README.md
├── keycloak/
│   └── realm-export.json          # Keycloak realm with service-a / service-b clients
├── service-b/                     # Spring Boot resource service (Oracle VM 2)
│   ├── pom.xml
│   └── src/main/java/com/zt/benchmark/
│       ├── ServiceBApplication.java
│       ├── controller/
│       │   └── ResourceController.java    # 3 endpoints
│       └── service/
│           ├── IntrospectionVerificationService.java  # Scenario 1
│           ├── JwtVerificationService.java            # Scenario 2
│           └── VcVerificationService.java             # Scenario 3
├── k6/
│   ├── scenario-1-introspection.js
│   ├── scenario-2-jwt.js
│   ├── scenario-3-vc.js
│   └── failover-test.js
├── scripts/
│   ├── generate_vp.py             # One-time VP generation (run on GCP)
│   └── plot_results.py            # Generate figures for paper
└── results/                       # k6 JSON output (created at runtime)
```
