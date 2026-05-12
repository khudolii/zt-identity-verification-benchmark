package com.zt.benchmark.service;

import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.SignedJWT;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URL;
import java.time.Instant;
import java.util.Date;

/**
 * Scenario 2: Short-lived JWT with local signature verification.
 *
 * Public key (JWKS) is loaded ONCE at startup from Keycloak.
 * All subsequent verifications are LOCAL — no network calls per request.
 *
 * Keycloak is NOT contacted during verification.
 * If Keycloak goes down after startup: verification continues working.
 *
 * Latency = local RSA signature verification only.
 */
@Service
public class JwtVerificationService {

    @Value("${jwks.uri}")
    private String jwksUri;

    private JWSVerifier verifier;

    /**
     * Load public key from Keycloak JWKS once at startup.
     * After this point, Keycloak is not needed for JWT verification.
     */
    @PostConstruct
    public void init() throws Exception {
        JWKSet jwkSet = JWKSet.load(new URL(jwksUri));
        RSAKey rsaKey = (RSAKey) jwkSet.getKeys().get(0);
        this.verifier = new RSASSAVerifier(rsaKey.toRSAPublicKey());
    }

    /**
     * Verifies JWT signature and expiration LOCALLY.
     * Zero network calls — pure cryptographic verification.
     */
    public boolean verify(String token) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);

            // Local signature verification using cached public key
            if (!jwt.verify(verifier)) {
                return false;
            }

            // Check expiration locally
            Date expiration = jwt.getJWTClaimsSet().getExpirationTime();
            return expiration != null && expiration.toInstant().isAfter(Instant.now());

        } catch (Exception e) {
            return false;
        }
    }
}
