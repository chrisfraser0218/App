package com.finsight;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.dao.DuplicateKeyException;

@Service
class AuthenticationService {
    private final JdbcTemplate jdbc;
    private final String dummy = LocalPasswords.encode(UUID.randomUUID().toString());
    AuthenticationService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    static String username(String value) {
        if (value == null || !value.matches("[A-Za-z][A-Za-z0-9_]{2,31}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Use 3–32 letters, digits or underscores, starting with a letter");
        return value.toLowerCase(Locale.ROOT);
    }
    @Transactional
    CurrentIdentity.Owner register(String raw, String password, String confirmation) {
        String name = username(raw);
        try { LocalPasswords.validate(password); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage()); }
        if (!password.equals(confirmation)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Passwords do not match");
        UUID user = UUID.randomUUID(), account = UUID.randomUUID();
        String hash = LocalPasswords.encode(password);
        try {
            jdbc.update("INSERT INTO users(id,display_name,username,password_hash,credential_version) VALUES (?,?,?,?,1)", user, raw, name, hash);
        } catch (DuplicateKeyException e) { throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is unavailable"); }
        jdbc.update("INSERT INTO accounts(id,user_id,name,currency,starting_balance) VALUES (?,?,?,'USD',0.00)", account, user, "Personal account");
        return new CurrentIdentity.Owner(user, account, name, 1, Instant.now());
    }
    CurrentIdentity.Owner login(String raw, String password) {
        // Invalid and absent names run the same expensive password verification.
        String name = raw == null ? "" : raw.toLowerCase(Locale.ROOT);
        var rows = name.matches("[a-z][a-z0-9_]{2,31}") ? jdbc.queryForList(
            "SELECT u.id,u.username,u.password_hash,u.credential_version,a.id AS account_id FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.username=? ORDER BY a.id", name) : List.<Map<String,Object>>of();
        var row = rows.size() == 1 ? rows.getFirst() : null;
        String hash = row == null || row.get("password_hash") == null ? dummy : (String) row.get("password_hash");
        boolean valid = LocalPasswords.matches(password, hash);
        if (!valid || row == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid username or password");
        return new CurrentIdentity.Owner((UUID)row.get("id"), (UUID)row.get("account_id"), name,
            ((Number)row.get("credential_version")).longValue(), Instant.now());
    }
    boolean valid(CurrentIdentity.Owner owner) {
        if (owner.authenticatedAt().plus(Duration.ofHours(12)).isBefore(Instant.now())) return false;
        return jdbc.queryForObject("SELECT count(*) FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=? AND a.id=? AND u.credential_version=? AND u.username=? AND u.password_hash IS NOT NULL",
            Integer.class, owner.userId(), owner.accountId(), owner.credentialVersion(), owner.username()) == 1;
    }
}
