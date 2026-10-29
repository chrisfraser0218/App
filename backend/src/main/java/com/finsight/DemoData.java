package com.finsight;
import org.springframework.boot.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
@Component
class DemoData implements ApplicationRunner {
    private final JdbcTemplate jdbc;
    DemoData(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Override @Transactional public void run(ApplicationArguments args) {
        // Account existence marks initial setup. Never recreate deleted demo transactions on restart.
        if (jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id = ?", Integer.class, DemoIdentity.ACCOUNT_ID) > 0) return;
        jdbc.update("INSERT INTO users (id,email,display_name) VALUES (?,?,?)", DemoIdentity.USER_ID, "demo@finsight.local", "Alex Morgan (Demo)");
        jdbc.update("INSERT INTO accounts (id,user_id,name,currency,starting_balance) VALUES (?,?,?,?,?)", DemoIdentity.ACCOUNT_ID, DemoIdentity.USER_ID, "Everyday account", "USD", new BigDecimal("2500.00"));
        String[] names = {"Salary", "Freelance", "Housing", "Groceries", "Dining", "Transport", "Shopping", "Subscriptions", "Health", "Other"};
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            UUID id = UUID.randomUUID(); ids.add(id);
            jdbc.update("INSERT INTO categories (id,user_id,name,type) VALUES (?,?,?,?)", id, DemoIdentity.USER_ID, names[i], i < 2 ? "INCOME" : "EXPENSE");
        }
        LocalDate today = LocalDate.now();
        Object[][] samples = {{"Monthly salary", "4200.00", 0}, {"Apartment rent", "1450.00", 2}, {"Weekly groceries", "86.42", 3}, {"Coffee & lunch", "24.80", 4}, {"Metro pass", "65.00", 5}, {"Design project", "650.00", 1}, {"Music subscription", "10.99", 7}, {"Market essentials", "54.65", 3}};
        for (int i = 0; i < samples.length; i++) {
            int category = (Integer) samples[i][2];
            jdbc.update("INSERT INTO transactions (id,user_id,account_id,category_id,description,amount,type,transaction_date) VALUES (?,?,?,?,?,?,?,?)",
                UUID.randomUUID(), DemoIdentity.USER_ID, DemoIdentity.ACCOUNT_ID, ids.get(category), samples[i][0], new BigDecimal((String) samples[i][1]), category < 2 ? "INCOME" : "EXPENSE", today.withDayOfMonth(Math.max(1, today.getDayOfMonth() - samples.length + i + 1)));
        }
    }
}
