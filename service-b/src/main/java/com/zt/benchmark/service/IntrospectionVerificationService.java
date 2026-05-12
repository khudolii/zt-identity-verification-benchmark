package com.zt.benchmark.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

/**
 * Scenario 1: Centralized Token Introspection (RFC 7662).
 *
 * Every request triggers an HTTP call to Keycloak (Oracle VM 1).
 * This models the centralized IdP dependency — the SPOF problem.
 *
 * Latency = local processing + network RTT to Keycloak + Keycloak processing.
 * When Keycloak is unavailable: 100% failure rate (failover test).
 */
@Service
public class IntrospectionVerificationService {

    private final WebClient webClient;
    private final String introspectionUrl;
    private final String clientId;
    private final String clientSecret;

    public IntrospectionVerificationService(
            @Value("${keycloak.url}") String keycloakUrl,
            @Value("${keycloak.realm}") String realm,
            @Value("${keycloak.client-id}") String clientId,
            @Value("${keycloak.client-secret}") String clientSecret) {

        this.webClient = WebClient.builder().build();
        this.introspectionUrl = keycloakUrl + "/realms/" + realm
                + "/protocol/openid-connect/token/introspect";
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    /**
     * Calls Keycloak introspection endpoint for every single request.
     * No caching — simulates strict Zero Trust continuous verification.
     */
    public boolean verify(String token) {
        try {
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("token", token);
            form.add("client_id", clientId);
            form.add("client_secret", clientSecret);

            Map<?, ?> response = webClient.post()
                    .uri(introspectionUrl)
                    .body(BodyInserters.fromFormData(form))
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();

            return response != null && Boolean.TRUE.equals(response.get("active"));
        } catch (Exception e) {
            // Keycloak unreachable — SPOF demonstrated
            return false;
        }
    }
}
