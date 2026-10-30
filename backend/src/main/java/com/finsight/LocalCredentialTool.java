package com.finsight;

import java.sql.DriverManager;
import java.util.Arrays;

/** Deliberate local-console provisioning only. No HTTP reset/claim endpoint. */
public final class LocalCredentialTool {
    public static void main(String[] args) throws Exception {
        var console = System.console();
        if (console == null) throw new IllegalStateException("An interactive local terminal is required");
        String username = AuthenticationService.username(console.readLine("Legacy account username: "));
        char[] first = console.readPassword("New password (12–1024 characters): ");
        char[] second = console.readPassword("Confirm password: ");
        try {
            if (!Arrays.equals(first,second)) throw new IllegalArgumentException("Passwords do not match");
            String hash = LocalPasswords.encode(new String(first));
            String url=System.getenv("DB_URL");
            if(url==null||!url.matches("jdbc:postgresql://(?:127\\.0\\.0\\.1|localhost):55432/finsight_demo"))throw new IllegalStateException("Unexpected credential endpoint");
            url=url.replace("://localhost:","://127.0.0.1:");
            try(var connection=DriverManager.getConnection(url,System.getenv("DB_USERNAME"),System.getenv("DB_PASSWORD"))) {
                try(var check=connection.createStatement();var result=check.executeQuery("SELECT current_database(),host(inet_server_addr()),inet_server_port()")) {
                    if(!result.next()||!"finsight_demo".equals(result.getString(1))||!"127.0.0.1".equals(result.getString(2))||result.getInt(3)!=55432)
                        throw new IllegalStateException("Refusing an unexpected personal database");
                }
                connection.setAutoCommit(false);
                try(var query=connection.prepareStatement("UPDATE users SET username=?,password_hash=?,credential_version=credential_version+1 WHERE id=? AND username IS NULL AND password_hash IS NULL")) {
                    query.setString(1,username);query.setString(2,hash);query.setObject(3,DemoIdentity.USER_ID);
                    if(query.executeUpdate()!=1) throw new IllegalStateException("Refused: legacy credentials already configured or identity missing");
                    connection.commit();
                } catch(Exception e) { connection.rollback(); throw new IllegalStateException("Credential provisioning failed; no changes committed"); }
            }
            console.printf("Legacy login configured. Financial records were not changed.%n");
        } finally { Arrays.fill(first,'\0'); Arrays.fill(second,'\0'); }
    }
}
