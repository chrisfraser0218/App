package com.finsight;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@org.springframework.context.annotation.Import(LegacyTestSupport.class)
@org.junit.jupiter.api.extension.ExtendWith(LegacyIdentityExtension.class)
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
@org.springframework.test.context.ContextConfiguration(initializers = IsolatedDatabaseGuard.class) @Transactional
class FinanceApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    String category;
    @BeforeEach void setup() {
        jdbc.update("DELETE FROM transactions");
        jdbc.update("UPDATE accounts SET starting_balance = 1000.00");
        category = jdbc.queryForObject("SELECT CAST(id AS VARCHAR) FROM categories WHERE name = 'Groceries'", String.class);
    }
    Map<String,Object> input(String amount) {
        return new HashMap<>(Map.of("description", "Weekly groceries", "amount", amount, "type", "EXPENSE", "categoryId", category, "date", LocalDate.now().toString()));
    }
    JsonNode create(Map<String,Object> input) throws Exception {
        return json.readTree(mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(input)))
            .andExpect(status().isCreated()).andExpect(header().exists("Location")).andReturn().getResponse().getContentAsString());
    }
    JsonNode account() throws Exception { return json.readTree(mvc.perform(get("/api/account")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString()); }
    void balance(String expected) throws Exception { assertThat(account().get("balance").decimalValue()).isEqualByComparingTo(expected); }
    @Test void createsAndRetrievesTransaction() throws Exception {
        String id = create(input("12.34")).get("id").asText();
        mvc.perform(get("/api/transactions/" + id)).andExpect(status().isOk()).andExpect(jsonPath("$.amount").value(12.34));
        mvc.perform(get("/api/transactions")).andExpect(status().isOk()).andExpect(jsonPath("$[0].description").value("Weekly groceries")).andExpect(jsonPath("$[0].amount").value(12.34));
        balance("987.66");
    }
    @Test void updatesAndRecalculatesBalance() throws Exception {
        String id = create(input("20.00")).get("id").asText();
        mvc.perform(put("/api/transactions/" + id).contentType("application/json").content(json.writeValueAsBytes(input("30.25"))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.amount").value(30.25));
        balance("969.75");
    }
    @Test void deletesAndReturns404ForUnknownIds() throws Exception {
        String id = create(input("20.00")).get("id").asText();
        mvc.perform(delete("/api/transactions/" + id)).andExpect(status().isNoContent());
        mvc.perform(delete("/api/transactions/" + id)).andExpect(status().isNotFound());
        mvc.perform(put("/api/transactions/" + id).contentType("application/json").content(json.writeValueAsBytes(input("1.00")))).andExpect(status().isNotFound());
        balance("1000.00");
    }
    @Test void calculatesIncomeExpensesAndStartingBalanceExactly() throws Exception {
        create(input("0.10")); create(input("0.20"));
        Map<String,Object> salary = input("500.55"); salary.put("type", "INCOME");
        salary.put("categoryId", jdbc.queryForObject("SELECT CAST(id AS VARCHAR) FROM categories WHERE name='Salary'", String.class));
        create(salary);
        mvc.perform(put("/api/account/starting-balance").contentType("application/json").content("{\"startingBalance\":\"-100.25\"}")).andExpect(status().isOk());
        balance("400.00");
        assertThat(account().get("income").decimalValue()).isEqualByComparingTo("500.55");
        assertThat(account().get("expenses").decimalValue()).isEqualByComparingTo("0.30");
    }
    @ParameterizedTest @ValueSource(strings={"0", "-1", "0.001", "1000000000000", "NaN"})
    void rejectsInvalidAmounts(String amount) throws Exception {
        mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(input(amount)))).andExpect(status().isBadRequest());
        balance("1000.00");
    }
    @Test void rejectsInvalidFieldsAndCategoryType() throws Exception {
        for (String field : List.of("description", "amount", "type", "date", "categoryId")) {
            Map<String,Object> values = input("1.00"); values.put(field, null);
            mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(values))).andExpect(status().isBadRequest());
        }
        for (Map.Entry<String,Object> bad : Map.<String,Object>of("description", " ", "date", LocalDate.now().plusDays(1).toString(), "type", "INCOME", "categoryId", UUID.randomUUID().toString()).entrySet()) {
            Map<String,Object> values = input("1.00"); values.put(bad.getKey(), bad.getValue());
            mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(values))).andExpect(status().isBadRequest());
        }
    }
    @Test void rejectsInvalidUpdateWithoutChangingBalance() throws Exception {
        String id = create(input("5.00")).get("id").asText();
        mvc.perform(put("/api/transactions/" + id).contentType("application/json").content(json.writeValueAsBytes(input("-20")))).andExpect(status().isBadRequest());
        balance("995.00");
    }
    @Test void summariesUseCalendarMonthAndOnlyExpensesInCategories() throws Exception {
        create(input("15.25")); create(input("4.75"));
        Map<String,Object> previous = input("100"); previous.put("date", LocalDate.now().minusMonths(1).withDayOfMonth(1).toString()); create(previous);
        mvc.perform(get("/api/summaries/monthly").param("month", YearMonth.now().toString()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.expenses").value(20.00)).andExpect(jsonPath("$.categories[0].name").value("Groceries")).andExpect(jsonPath("$.categories[0].amount").value(20.00));
        mvc.perform(get("/api/summaries/monthly").param("month", "wrong")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/summaries/monthly").param("month", "2000-01")).andExpect(status().isOk()).andExpect(jsonPath("$.expenses").value(0)).andExpect(jsonPath("$.categories").isEmpty());
    }
    @Test void scopesTransactionsAndCategoriesToDemoUser() throws Exception {
        UUID other = UUID.randomUUID(), account = UUID.randomUUID(), cat = UUID.randomUUID(), transaction = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,display_name) VALUES (?,?,?)", other, "other@test.local", "Other");
        jdbc.update("INSERT INTO accounts(id,user_id,name,currency,starting_balance) VALUES (?,?,?,'USD',0)", account, other, "Other");
        jdbc.update("INSERT INTO categories(id,user_id,name,type) VALUES (?,?,?,'EXPENSE')", cat, other, "Private");
        jdbc.update("INSERT INTO transactions(id,user_id,account_id,category_id,description,amount,type,transaction_date) VALUES (?,?,?,?,?,10,'EXPENSE',CURRENT_DATE)", transaction, other, account, cat, "Private");
        mvc.perform(get("/api/transactions")).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/transactions/" + transaction)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/transactions/" + transaction)).andExpect(status().isNotFound());
        mvc.perform(put("/api/transactions/" + transaction).contentType("application/json").content(json.writeValueAsBytes(input("1")))).andExpect(status().isNotFound());
        Map<String,Object> values = input("1"); values.put("categoryId", cat);
        mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(values))).andExpect(status().isBadRequest());
        balance("1000");
    }
    @Test void rejectsExternalOriginsHostsAndNonJsonWrites() throws Exception {
        mvc.perform(get("/api/account").header("Origin", "https://example.com")).andExpect(status().isForbidden());
        mvc.perform(get("/api/account").with(req -> {req.setServerName("evil.example"); return req;})).andExpect(status().isForbidden());
        mvc.perform(post("/api/transactions").contentType("text/plain").content("{}")).andExpect(status().isUnsupportedMediaType());
        mvc.perform(get("/api/account").header("Origin", "http://localhost:5173")).andExpect(status().isOk());
    }
}
