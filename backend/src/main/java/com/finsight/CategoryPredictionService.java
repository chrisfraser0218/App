package com.finsight;

import java.math.BigDecimal;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import static com.finsight.AiModels.*;

@Service
class CategoryPredictionService {
    private static final Map<String, List<String>> CATEGORY_NAMES = Map.of(
        "Food & Drinks", List.of("Dining", "Restaurants"), "Transportation", List.of("Transport", "Transportation"),
        "Entertainment", List.of("Subscriptions", "Entertainment"), "Groceries", List.of("Groceries"),
        "Shopping", List.of("Shopping"), "Utilities", List.of("Utilities"),
        "Housing", List.of("Housing", "Rent"), "Health", List.of("Health", "Healthcare"), "Other", List.of("Other"));
    private final AiServiceClient client;
    private final CategoryRepository categories;
    private final JdbcTemplate jdbc;

    CategoryPredictionService(AiServiceClient client, CategoryRepository categories, JdbcTemplate jdbc) {
        this.client = client; this.categories = categories; this.jdbc = jdbc;
    }

    // Network call runs outside a database transaction; only persistence acquires a connection.
    PredictionView predict(PredictionInput input) {
        if (input.description().strip().length() < 2) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Description must contain at least two characters");
        PredictionInput normalized = new PredictionInput(input.description().strip(), input.amount());
        Optional<ModelPrediction> optional = client.predict(normalized);
        if (optional.isEmpty()) return PredictionView.unavailable();
        ModelPrediction prediction = optional.get();
        Category category = null;
        if (prediction.status().equals("suggested")) {
            List<String> names = CATEGORY_NAMES.get(prediction.category());
            if (names == null) return PredictionView.unavailable();
            var owned = categories.findByUserIdOrderByName(CurrentIdentity.userId());
            category = names.stream().flatMap(name -> owned.stream()
                .filter(c -> c.type == TransactionType.EXPENSE && c.name.equalsIgnoreCase(name))).findFirst().orElse(null);
            if (category == null) return PredictionView.unavailable();
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO category_predictions (id,user_id,description,amount,model_category,suggested_category_id,confidence,model_version,status) VALUES (?,?,?,?,?,?,?,?,?)",
            id, CurrentIdentity.userId(), normalized.description(), normalized.amount(), prediction.category(),
            category == null ? null : category.id, prediction.confidence(), prediction.modelVersion(), prediction.status());
        return new PredictionView(id, prediction.category(), category == null ? null : category.id,
            category == null ? null : category.name, prediction.confidence(), prediction.modelVersion(), prediction.status());
    }

    /** Called inside the ledger mutation's transaction; metadata comes from our stored prediction. */
    @Transactional
    public void recordFeedback(UUID predictionId, Transaction transaction) {
        if (predictionId == null) return;
        List<StoredPrediction> results = jdbc.query(
            "SELECT description, amount, suggested_category_id FROM category_predictions WHERE id = ? AND user_id = ? AND status = 'suggested'",
            (row, n) -> new StoredPrediction(row.getString("description"), row.getBigDecimal("amount"), row.getObject("suggested_category_id", UUID.class)),
            predictionId, CurrentIdentity.userId());
        if (results.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prediction not found for this user");
        StoredPrediction p = results.getFirst();
        if (transaction.type != TransactionType.EXPENSE || !transaction.description.equals(p.description())
            || transaction.amount.compareTo(p.amount()) != 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prediction no longer matches this transaction");
        }
        // First submitted decision is immutable. Later edits request a fresh prediction.
        if (jdbc.queryForObject("SELECT COUNT(*) FROM category_prediction_feedback WHERE prediction_id = ?", Integer.class, predictionId) > 0) return;
        jdbc.update("INSERT INTO category_prediction_feedback (prediction_id,user_id,transaction_id,selected_category_id,outcome) VALUES (?,?,?,?,?)",
            predictionId, CurrentIdentity.userId(), transaction.id, transaction.categoryId,
            transaction.categoryId.equals(p.categoryId()) ? "accepted" : "corrected");
    }

    @Transactional
    public void recordRecurringFeedback(UUID predictionId, RecurringRule rule) {
        if (predictionId == null) return;
        var matches = jdbc.query("SELECT description,amount,suggested_category_id FROM category_predictions WHERE id = ? AND user_id = ? AND status = 'suggested'",
            (row, n) -> new StoredPrediction(row.getString("description"), row.getBigDecimal("amount"), row.getObject("suggested_category_id", UUID.class)), predictionId, CurrentIdentity.userId());
        if (matches.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prediction not found for this user");
        StoredPrediction prediction = matches.getFirst();
        if (rule.type != TransactionType.EXPENSE || !rule.description.equals(prediction.description()) || rule.amount.compareTo(prediction.amount()) != 0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Prediction no longer matches this schedule");
        if (jdbc.queryForObject("SELECT COUNT(*) FROM recurring_prediction_feedback WHERE prediction_id = ?", Integer.class, predictionId) > 0) return;
        jdbc.update("INSERT INTO recurring_prediction_feedback(prediction_id,user_id,rule_id,selected_category_id,outcome) VALUES (?,?,?,?,?)",
            predictionId, CurrentIdentity.userId(), rule.id, rule.categoryId, rule.categoryId.equals(prediction.categoryId()) ? "accepted" : "corrected");
    }

    private record StoredPrediction(String description, BigDecimal amount, UUID categoryId) {}
}
