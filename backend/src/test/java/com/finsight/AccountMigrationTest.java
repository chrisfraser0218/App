package com.finsight;

import java.sql.*;
import java.util.*;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.assertj.core.api.Assertions.*;

/** Applies the actual V6 -> V7 upgrade to a separate synthetic schema, never financial restore copies. */
@SpringBootTest @ActiveProfiles("test") @ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
class AccountMigrationTest {
    @Autowired DataSource dataSource;
    @Test void additiveAuthenticationUpgradeRetainsEveryExistingColumnValueAndAppliedMigration() throws Exception {
        String schema="auth_upgrade_"+UUID.randomUUID().toString().replace("-","");
        try(var connection=dataSource.getConnection()) {
            var isolated=new SingleConnectionDataSource(connection,true);
            Flyway.configure().dataSource(isolated).schemas(schema).defaultSchema(schema).target("6").load().migrate();
            connection.setSchema(schema);
            try(var s=connection.createStatement()) {
                s.executeUpdate("INSERT INTO users(id,email,display_name) VALUES ('00000000-0000-0000-0000-000000000001','synthetic@migration.local','Synthetic legacy')");
                s.executeUpdate("INSERT INTO accounts(id,user_id,name,currency,starting_balance) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Synthetic legacy','USD',123.45)");
                s.executeUpdate("INSERT INTO categories(id,user_id,name,type) VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Synthetic category','EXPENSE')");
                s.executeUpdate("INSERT INTO transactions(id,user_id,account_id,category_id,description,amount,type,transaction_date) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','Synthetic record',12.34,'EXPENSE',DATE '2026-01-01')");
                s.executeUpdate("INSERT INTO forecast_preferences(account_id,user_id,low_balance_threshold) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',17.89)");
            }
            var before=snapshot(connection);
            Flyway.configure().dataSource(isolated).schemas(schema).defaultSchema(schema).load().migrate();
            connection.setSchema(schema);
            for(var table:before.entrySet()) {
                String query=table.getKey().equals("flyway_schema_history")?"SELECT * FROM \"flyway_schema_history\" WHERE \"version\" IS NULL OR \"version\"<='6' ORDER BY \"installed_rank\"":
                    table.getKey().equals("users")?"SELECT id,email,display_name,password_hash,created_at FROM users ORDER BY id":"SELECT * FROM "+table.getKey();
                assertThat(rows(connection,query)).as(table.getKey()).isEqualTo(table.getValue());
            }
            try(var s=connection.createStatement();var r=s.executeQuery("SELECT username,credential_version FROM users")) {
                assertThat(r.next()).isTrue();assertThat(r.getString(1)).isNull();assertThat(r.getLong(2)).isZero();
            }
        }
        // Retain the synthetic schema as migration evidence; do not clean financial databases or restore copies.
    }
    private Map<String,List<List<String>>> snapshot(Connection connection)throws SQLException {
        var result=new LinkedHashMap<String,List<List<String>>>();
        for(String table:List.of("users","accounts","categories","transactions","category_predictions","category_prediction_feedback","recurring_rules","recurring_occurrences","recurring_prediction_feedback","planned_transactions","forecast_preferences","savings_goals","savings_entries","savings_corrections","savings_schedules","flyway_schema_history"))
            result.put(table,rows(connection,"SELECT * FROM "+(table.equals("flyway_schema_history")?"\"flyway_schema_history\"":table)));
        return result;
    }
    private List<List<String>> rows(Connection c,String query)throws SQLException {
        var values=new ArrayList<List<String>>();
        try(var s=c.createStatement();var r=s.executeQuery(query)) {
            while(r.next()){var row=new ArrayList<String>();for(int i=1;i<=r.getMetaData().getColumnCount();i++)row.add(r.getString(i));values.add(row);}
        }
        values.sort(Comparator.comparing(Object::toString));return values;
    }
}
