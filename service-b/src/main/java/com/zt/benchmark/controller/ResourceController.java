package com.zt.benchmark.controller;

import com.zt.benchmark.service.IntrospectionVerificationService;
import com.zt.benchmark.service.JwtVerificationService;
import com.zt.benchmark.service.VcVerificationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Three endpoints — each models a different architectural approach to
 * cross-domain identity verification under Zero Trust.
 *
 * All endpoints return the same response structure so k6 can measure
 * pure verification latency consistently across scenarios.
 */
@RestController
@RequestMapping("/api/resource")
public class ResourceController {

    private final IntrospectionVerificationService introspectionService;
    private final JwtVerificationService jwtService;
    private final VcVerificationService vcService;

    public ResourceController(
            IntrospectionVerificationService introspectionService,
            JwtVerificationService jwtService,
            VcVerificationService vcService) {
        this.introspectionService = introspectionService;
        this.jwtService = jwtService;
        this.vcService = vcService;
    }

    /**
     * Scenario 1: Token Introspection (RFC 7662).
     * Contacts Keycloak on every request — centralized dependency.
     */
    @PostMapping("/introspection")
    public ResponseEntity<Map<String, String>> introspection(
            @RequestHeader("Authorization") String authHeader) {
        boolean allowed = introspectionService.verify(extractToken(authHeader));
        return buildResponse(allowed, "introspection");
    }

    /**
     * Scenario 2: Local JWT verification.
     * No external calls — public key cached at startup.
     */
    @PostMapping("/jwt")
    public ResponseEntity<Map<String, String>> jwt(
            @RequestHeader("Authorization") String authHeader) {
        boolean allowed = jwtService.verify(extractToken(authHeader));
        return buildResponse(allowed, "jwt");
    }

    /**
     * Scenario 3: Verifiable Credential verification.
     * Ed25519 signature checked locally — fully decentralized.
     */
    @PostMapping("/vc")
    public ResponseEntity<Map<String, String>> vc(
            @RequestBody String vpJson) {
        boolean allowed = vcService.verify(vpJson);
        return buildResponse(allowed, "vc");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String extractToken(String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
        return authHeader;
    }

    private ResponseEntity<Map<String, String>> buildResponse(
            boolean allowed, String scenario) {
        if (allowed) {
            return ResponseEntity.ok(Map.of(
                    "status", "allowed",
                    "scenario", scenario
            ));
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                "status", "denied",
                "scenario", scenario
        ));
    }
}
