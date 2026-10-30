package com.finsight;

import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@org.springframework.context.annotation.Import(LegacyTestSupport.class)
@org.junit.jupiter.api.extension.ExtendWith(LegacyIdentityExtension.class)
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
@org.springframework.test.context.ContextConfiguration(initializers = IsolatedDatabaseGuard.class)
class CategoryPredictionApiTest {
    static HttpServer server;
    static volatile int status = 200;
    static volatile String response;
    static {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/predict-category", exchange -> {
                exchange.getRequestBody().readAllBytes();
                byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
        } catch (Exception e) { throw new RuntimeException(e); }
    }
    @DynamicPropertySource static void configure(DynamicPropertyRegistry registry) {
        registry.add("ai.base-url", () -> "http://127.0.0.1:" + server.getAddress().getPort());
    }
    @AfterAll static void stop() { server.stop(0); }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @BeforeEach void reset() {
        jdbc.update("DELETE FROM category_prediction_feedback");
        jdbc.update("DELETE FROM category_predictions");
        jdbc.update("DELETE FROM transactions");
        status = 200;
        response = "{\"category\":\"Food & Drinks\",\"confidence\":0.73,\"model_version\":\"1.0\",\"status\":\"suggested\"}";
    }
    String category(String name) { return jdbc.queryForObject("SELECT CAST(id AS VARCHAR) FROM categories WHERE name = ? AND user_id = ?", String.class, name, DemoIdentity.USER_ID); }
    JsonNode predict() throws Exception {
        return json.readTree(mvc.perform(post("/api/category-predictions").contentType("application/json")
            .content("{\"description\":\"Starbucks Coffee\",\"amount\":\"8.75\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    Map<String,Object> transaction(String category, String prediction) {
        Map<String,Object> value = new HashMap<>(Map.of("description", "Starbucks Coffee", "amount", "8.75", "type", "EXPENSE", "categoryId", category(category), "date", LocalDate.now().toString()));
        if (prediction != null) value.put("predictionId", prediction);
        return value;
    }
    JsonNode create(Map<String,Object> values) throws Exception {
        return json.readTree(mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(values)))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    }
    @Test void mapsCategoriesAndRecordsAcceptedFeedback() throws Exception {
        JsonNode p = predict();
        assertThat(p.get("categoryName").asText()).isEqualTo("Dining");
        assertThat(p.get("categoryId").asText()).isEqualTo(category("Dining"));
        assertThat(p.get("confidence").asDouble()).isEqualTo(0.73);
        create(transaction("Dining", p.get("predictionId").asText()));
        assertThat(jdbc.queryForObject("SELECT outcome FROM category_prediction_feedback", String.class)).isEqualTo("accepted");
        assertThat(jdbc.queryForObject("SELECT reviewed FROM category_prediction_feedback", Boolean.class)).isFalse();
    }
    @Test void storesCorrectionAndPreservesSnapshotOnDeletion() throws Exception {
        JsonNode p = predict();
        JsonNode t = create(transaction("Groceries", p.get("predictionId").asText()));
        assertThat(jdbc.queryForObject("SELECT outcome FROM category_prediction_feedback", String.class)).isEqualTo("corrected");
        assertThat(jdbc.queryForObject("SELECT CAST(selected_category_id AS VARCHAR) FROM category_prediction_feedback", String.class)).isEqualTo(category("Groceries"));
        mvc.perform(delete("/api/transactions/" + t.get("id").asText())).andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("SELECT transaction_id FROM category_prediction_feedback", UUID.class)).isNull();
        assertThat(jdbc.queryForObject("SELECT model_version FROM category_predictions", String.class)).isEqualTo("1.0");
    }
    @Test void unknownDescriptionDoesNotInventCategory() throws Exception {
        response = "{\"category\":null,\"confidence\":0.14,\"model_version\":\"1.0\",\"status\":\"unknown\"}";
        JsonNode p = predict();
        assertThat(p.get("categoryId").isNull()).isTrue();
        assertThat(p.get("status").asText()).isEqualTo("unknown");
    }
    @Test void unavailableAiStillAllowsTransactionsWithoutFeedback() throws Exception {
        status = 503;
        assertThat(predict().get("status").asText()).isEqualTo("unavailable");
        create(transaction("Dining", null));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM transactions", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM category_prediction_feedback", Integer.class)).isZero();
    }
    @Test void invalidPredictionInputsReturn400() throws Exception {
        mvc.perform(post("/api/category-predictions").contentType("application/json").content("{\"description\":\" \",\"amount\":0}"))
            .andExpect(status().isBadRequest());
    }
    @Test void rejectsStalePredictionAndRollsBackLedgerWrite() throws Exception {
        JsonNode p = predict();
        var input = transaction("Dining", p.get("predictionId").asText()); input.put("amount", "10.00");
        mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(input))).andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM transactions", Integer.class)).isZero();
    }
    @Test void rejectsUnknownPredictionAndOwnerSpoofing() throws Exception {
        mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(transaction("Dining", UUID.randomUUID().toString()))))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/api/category-predictions").contentType("application/json").content("{\"description\":\"coffee\",\"amount\":2,\"userId\":\"spoof\"}"))
            .andExpect(status().isBadRequest());
    }
    @Test void updatesCanRecordCorrectedFeedback() throws Exception {
        JsonNode t = create(transaction("Dining", null));
        JsonNode p = predict();
        mvc.perform(put("/api/transactions/" + t.get("id").asText()).contentType("application/json")
            .content(json.writeValueAsBytes(transaction("Groceries", p.get("predictionId").asText()))))
            .andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT outcome FROM category_prediction_feedback", String.class)).isEqualTo("corrected");
    }
    @Test void cannotAttachAnotherUsersPrediction() throws Exception {
        UUID other = UUID.randomUUID(), category = UUID.randomUUID(), prediction = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,display_name) VALUES (?,?,?)", other, other + "@test.local", "Other");
        jdbc.update("INSERT INTO categories(id,user_id,name,type) VALUES (?,?,?,'EXPENSE')", category, other, "Dining");
        jdbc.update("INSERT INTO category_predictions(id,user_id,description,amount,model_category,suggested_category_id,confidence,model_version,status) VALUES (?,?,?,8.75,?,?,?,?,?)",
            prediction, other, "Starbucks Coffee", "Food & Drinks", category, 0.73, "1.0", "suggested");
        mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(transaction("Dining", prediction.toString()))))
            .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM transactions", Integer.class)).isZero();
    }
    @Test void utilitiesCategoryIsAvailableAndMapped() throws Exception {
        response = "{\"category\":\"Utilities\",\"confidence\":0.82,\"model_version\":\"1.0\",\"status\":\"suggested\"}";
        assertThat(predict().get("categoryId").asText()).isEqualTo(category("Utilities"));
    }
}
