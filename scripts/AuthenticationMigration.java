import java.sql.DriverManager;
import org.flywaydb.core.Flyway;

/** Maintenance-only source launcher: no web server, seeder, AI, backup or recurring worker. */
class AuthenticationMigration {
    public static void main(String[] args) throws Exception {
        String url=System.getenv("DB_URL"),user=System.getenv("DB_USERNAME"),password=System.getenv("DB_PASSWORD");
        if(url==null||!url.matches("jdbc:postgresql://(?:127\\.0\\.0\\.1|localhost):55432/finsight_demo"))
            throw new IllegalStateException("Unexpected migration endpoint");
        url=url.replace("://localhost:","://127.0.0.1:");
        try(var connection=DriverManager.getConnection(url,user,password);var statement=connection.createStatement()) {
            try(var rows=statement.executeQuery("SELECT current_database(),host(inet_server_addr()),inet_server_port()")) {
                if(!rows.next()||!"finsight_demo".equals(rows.getString(1))||!"127.0.0.1".equals(rows.getString(2))||rows.getInt(3)!=55432)
                    throw new IllegalStateException("Unexpected migration storage");
            }
            try(var rows=statement.executeQuery("SELECT count(*) FROM flyway_schema_history WHERE success=FALSE OR version NOT IN ('1','2','3','4','5','6')")) {
                rows.next();if(rows.getInt(1)!=0)throw new IllegalStateException("Expected unchanged V1–V6 history");
            }
        }
        var flyway=Flyway.configure().dataSource(url,user,password).locations("classpath:db/migration").validateOnMigrate(true).target("7").load();
        var result=flyway.migrate();
        if(result.migrationsExecuted!=1||!"7".equals(result.targetSchemaVersion))
            throw new IllegalStateException("Unexpected migration result; retain backup and inspect privately");
    }
}
