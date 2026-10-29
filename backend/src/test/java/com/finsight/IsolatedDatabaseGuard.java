package com.finsight;

import java.sql.DriverManager;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

/** Runs before Flyway/seeding or fixture deletes, so a misconfigured test cannot use personal data. */
class IsolatedDatabaseGuard implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override public void initialize(ConfigurableApplicationContext context) {
        var environment = context.getEnvironment();
        String url = environment.getRequiredProperty("spring.datasource.url");
        if (url.startsWith("jdbc:h2:mem:")) return;
        if (!url.startsWith("jdbc:postgresql:")) throw refused();
        try (var connection = DriverManager.getConnection(url,
                environment.getRequiredProperty("spring.datasource.username"),
                environment.getProperty("spring.datasource.password", ""));
             var statement = connection.createStatement();
             var result = statement.executeQuery("SELECT current_database(), current_setting('data_directory')")) {
            if (!result.next() || !allowsPostgres(result.getString(1), result.getString(2),
                    Boolean.parseBoolean(System.getenv("CI")))) throw refused();
        } catch (Exception error) {
            // No URLs, credentials, server messages, or financial content in the failure.
            throw refused();
        }
    }

    static boolean allowsPostgres(String database, String directory, boolean ci) {
        if (!database.equals("finsight_verification")) return false;
        boolean temporaryVerification = directory.startsWith("/tmp/finsight-isolated-verification-")
            || directory.startsWith("/private/tmp/finsight-isolated-verification-");
        boolean ephemeralCi = ci && directory.startsWith("/var/lib/postgresql/");
        return temporaryVerification || ephemeralCi;
    }

    private static IllegalStateException refused() {
        return new IllegalStateException("Refusing tests outside an explicitly isolated synthetic verification database");
    }
}
