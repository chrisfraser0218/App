package com.finsight;

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

/** Standard Argon2id with 19 MiB memory, two iterations and a unique 16-byte salt. */
final class LocalPasswords {
    private static final Argon2PasswordEncoder ARGON2 = new Argon2PasswordEncoder(16,32,1,19456,2);
    private static final java.util.concurrent.Semaphore slots=new java.util.concurrent.Semaphore(2);
    private static <T> T bounded(java.util.function.Supplier<T> operation) {
        boolean acquired=false;
        try {
            acquired=slots.tryAcquire(2,java.util.concurrent.TimeUnit.SECONDS);
            if(!acquired)throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,"Authentication is busy. Try again shortly");
            return operation.get();
        } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new IllegalStateException("Authentication interrupted");}
        finally {if(acquired)slots.release();}
    }
    static String encode(String password) { validate(password); return bounded(()->ARGON2.encode(password)); }
    static boolean matches(String password, String encoded) {
        if (password == null || password.length() > 1024 || encoded == null || !encoded.startsWith("$argon2id$")) return false;
        return bounded(()->ARGON2.matches(password, encoded));
    }
    static void validate(String password) {
        if (password == null || password.codePointCount(0, password.length()) < 12 || password.length() > 1024)
            throw new IllegalArgumentException("Use a password of 12–1024 characters");
    }
    private LocalPasswords() {}
}
