package com.finsight;

import javax.sql.DataSource;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/** PostgreSQL-only role regression: authentication must not need global settings or cluster privileges. */
@SpringBootTest @ActiveProfiles("test") @ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
class LeastPrivilegeAuthenticationTest {
    @Autowired DataSource dataSource;
    @Test void registrationAndLoginWorkWithoutGlobalSettingsPrivileges()throws Exception {
        try(var c=dataSource.getConnection()) {
            assumeTrue(c.getMetaData().getDatabaseProductName().equals("PostgreSQL"),"Native PostgreSQL role semantics only");
            // Capture transport metadata before SET ROLE; restricted roles cannot read global settings.
            int configuredPort;
            String configuredHost;
            try (var s=c.createStatement(); var r=s.executeQuery("SELECT inet_server_port(), host(inet_server_addr())")) {
                r.next(); configuredPort=r.getInt(1); configuredHost=r.getString(2);
            }
            String suffix=UUID.randomUUID().toString().replace("-","");
            String schema="auth_role_"+suffix,role="finsight_auth_"+suffix;
            var source=new SingleConnectionDataSource(c,true);
            Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).load().migrate();
            try(var s=c.createStatement()) {
                s.execute("CREATE ROLE "+role+" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE");
                s.execute("GRANT USAGE ON SCHEMA "+schema+" TO "+role);
                s.execute("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "+schema+" TO "+role);
                s.execute("SET ROLE "+role);c.setSchema(schema);
                var jdbc=new JdbcTemplate(source);
                assertThatThrownBy(()->jdbc.queryForObject("SELECT current_setting('data_directory')",String.class)).isInstanceOf(org.springframework.dao.DataAccessException.class);
                assertThat(jdbc.queryForObject("SELECT inet_server_port()",Integer.class)).isEqualTo(configuredPort);
                assertThat(jdbc.queryForObject("SELECT host(inet_server_addr())",String.class)).isEqualTo(configuredHost);
                var authentication=new AuthenticationService(jdbc);
                String name="synthetic_owner",password="Synthetic least privilege password";
                var owner=authentication.register(name,password,password);
                assertThat(authentication.login(name,password).userId()).isEqualTo(owner.userId());
                assertThat(authentication.valid(owner)).isTrue();
                assertThat(jdbc.queryForObject("SELECT starting_balance FROM accounts WHERE user_id=?",java.math.BigDecimal.class,owner.userId())).isEqualByComparingTo("0.00");
                s.execute("RESET ROLE");c.setSchema("public");
            } finally {try(var s=c.createStatement()){s.execute("RESET ROLE");c.setSchema("public");}}
        }
    }
}
