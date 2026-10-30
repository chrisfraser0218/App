package com.finsight;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

/** Only a verified session or the internal recurring worker supplies this identity. */
final class CurrentIdentity {
    record Owner(UUID userId, UUID accountId, String username, long credentialVersion,
                 Instant authenticatedAt) implements Serializable {}
    private static final ThreadLocal<Owner> worker = new ThreadLocal<>();
    static Owner owner() {
        var background = worker.get();
        if (background != null) return background;
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && auth.getPrincipal() instanceof Owner owner) return owner;
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Log in to continue");
    }
    static UUID userId() { return owner().userId(); }
    static UUID accountId() { return owner().accountId(); }
    static void processAccount(UUID user, UUID account, Runnable operation) {
        var previous=worker.get();
        worker.set(new Owner(user, account, "worker", -1, Instant.EPOCH));
        try { operation.run(); } finally { if(previous==null)worker.remove();else worker.set(previous); }
    }
    private CurrentIdentity() {}
}
