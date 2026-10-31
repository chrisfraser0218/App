package com.finsight;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Public vocabulary only; never copies records or labels from another owner. */
final class DefaultCategories {
    static final List<String> EXPENSE = List.of("Groceries", "Rent", "Utilities", "Transportation",
        "Restaurants", "Shopping", "Entertainment", "Healthcare", "Insurance", "Subscriptions",
        "Education", "Travel", "Personal Care", "Other");
    static final List<String> INCOME = List.of("Salary", "Bonus", "Freelance", "Interest", "Refund", "Other Income");

    static void initialize(JdbcTemplate jdbc, UUID user) {
        if (DemoIdentity.USER_ID.equals(user)) return;
        // Serialize concurrent logins; the caller holds a transaction through all inserts.
        jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, user);
        add(jdbc, user, "EXPENSE", EXPENSE);
        add(jdbc, user, "INCOME", INCOME);
    }
    private static void add(JdbcTemplate jdbc, UUID user, String type, List<String> names) {
        for (String name : names) {
            if (jdbc.queryForObject("SELECT count(*) FROM categories WHERE user_id=? AND LOWER(name)=LOWER(?) AND type=?",
                    Integer.class, user, name, type) == 0)
                jdbc.update("INSERT INTO categories(id,user_id,name,type) VALUES (?,?,?,?)", UUID.randomUUID(), user, name, type);
        }
    }
    private DefaultCategories() {}
}
