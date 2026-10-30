package com.finsight;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static com.finsight.RecurringModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@org.junit.jupiter.api.extension.ExtendWith(LegacyIdentityExtension.class)
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
@ContextConfiguration(initializers = IsolatedDatabaseGuard.class)
@Import({LegacyTestSupport.class, RecurringApiTest.TestClockConfig.class})
class RecurringApiTest {
    static class MutableClock extends Clock {
        final AtomicReference<Instant> current = new AtomicReference<>();
        void date(String date) { current.set(LocalDate.parse(date).atTime(12,0).atZone(getZone()).toInstant()); }
        @Override public ZoneId getZone() { return ZoneId.of("America/New_York"); }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(instant(), zone); }
        @Override public Instant instant() { return current.get(); }
    }
    @TestConfiguration static class TestClockConfig {
        @Bean @Primary MutableClock testClock() { MutableClock c = new MutableClock(); c.date("2026-01-01"); return c; }
    }
    @Autowired MutableClock clock;
    @Autowired RecurringRuleService service;
    @Autowired RecurringProcessor processor;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @BeforeEach void reset() {
        clean(); clock.date("2026-01-01");
        jdbc.update("UPDATE accounts SET starting_balance = 1000.00 WHERE id = ?", DemoIdentity.ACCOUNT_ID);
    }
    @AfterEach void clean() {
        jdbc.execute("ALTER TABLE recurring_occurrences DROP CONSTRAINT IF EXISTS test_occurrence_failure");
        jdbc.update("DELETE FROM recurring_prediction_feedback"); jdbc.update("DELETE FROM recurring_occurrences");
        jdbc.update("DELETE FROM recurring_rules"); jdbc.update("DELETE FROM category_prediction_feedback");
        jdbc.update("DELETE FROM category_predictions"); jdbc.update("DELETE FROM transactions");
    }
    String category(String name) { return jdbc.queryForObject("SELECT CAST(id AS VARCHAR) FROM categories WHERE name = ? AND user_id = ?", String.class, name, DemoIdentity.USER_ID); }
    Map<String,Object> input(String frequency, String start) {
        Map<String,Object> result = new HashMap<>(Map.of("description", "Recurring test", "amount", "10.00", "type", "EXPENSE", "categoryId", category("Groceries"), "frequency", frequency, "startDate", start, "enabled", true, "requestId", UUID.randomUUID().toString(), "backfillConfirmed", true));
        if (frequency.equals("MONTHLY") || frequency.equals("TWICE_MONTHLY")) result.put("paymentDay",1);
        if (frequency.equals("TWICE_MONTHLY")) result.put("secondPaymentDay",15);
        return result;
    }
    JsonNode create(Map<String,Object> input) throws Exception {
        return json.readTree(mvc.perform(post("/api/recurring-transactions").contentType("application/json").content(json.writeValueAsBytes(input)))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
    }
    JsonNode find(String id) throws Exception {
        JsonNode all=json.readTree(mvc.perform(get("/api/recurring-transactions")).andReturn().getResponse().getContentAsString());
        for (JsonNode r : all) if (r.get("id").asText().equals(id)) return r;
        throw new AssertionError("Rule not found");
    }
    void balance(String value) throws Exception {
        JsonNode account=json.readTree(mvc.perform(get("/api/account")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(account.get("balance").decimalValue()).isEqualByComparingTo(value);
    }
    int count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class); }
    List<String> dates() { return jdbc.queryForList("SELECT CAST(transaction_date AS VARCHAR) FROM transactions ORDER BY transaction_date",String.class); }
    @ParameterizedTest
    @CsvSource({"DAILY,2026-01-01,2026-01-05,5", "WEEKLY,2026-01-01,2026-01-22,4", "BIWEEKLY,2026-01-01,2026-01-29,3", "TWICE_MONTHLY,2026-01-01,2026-02-16,4", "MONTHLY,2026-01-01,2026-03-31,3", "YEARLY,2024-02-29,2026-03-01,3"})
    void allFrequenciesCatchUpExactlyOnce(String frequency,String start,String through,int expected) throws Exception {
        clock.date(LocalDate.parse(start).minusDays(1).toString());
        var values=input(frequency,start); if(frequency.equals("MONTHLY")) values.put("paymentDay",31);
        create(values); assertThat(count("transactions")).isZero();
        clock.date(through); assertThat(processor.processDue().posted()).isEqualTo(expected);
        assertThat(processor.processDue().posted()).isZero(); assertThat(count("recurring_occurrences")).isEqualTo(expected);
        balance(String.valueOf(1000-expected*10));
        if(frequency.equals("MONTHLY")) assertThat(dates()).containsExactly("2026-01-31","2026-02-28","2026-03-31");
        if(frequency.equals("YEARLY")) assertThat(dates()).containsExactly("2024-02-29","2025-02-28","2026-02-28");
    }
    @Test void twiceMonthlyClampedDaysNeverDuplicateAndRecoverOriginalDays() throws Exception {
        clock.date("2026-01-31");var values=input("TWICE_MONTHLY","2026-02-01");values.put("paymentDay",30);values.put("secondPaymentDay",31);
        create(values);clock.date("2026-03-31");assertThat(processor.processDue().posted()).isEqualTo(3);
        assertThat(dates()).containsExactly("2026-02-28","2026-03-30","2026-03-31");balance("970.00");
    }
    @Test void leapYearMonthlyDay31UsesFebruary29() throws Exception {
        clock.date("2024-01-01");var values=input("MONTHLY","2024-02-01");values.put("paymentDay",31);create(values);
        clock.date("2024-02-29");processor.processDue();assertThat(dates()).containsExactly("2024-02-29");
    }
    @Test void noFuturePostingAndEndDateIsInclusive() throws Exception {
        var values=input("DAILY","2026-01-02");values.put("endDate","2026-01-04");JsonNode rule=create(values);
        assertThat(count("transactions")).isZero();clock.date("2026-01-10");processor.processDue();
        assertThat(dates()).containsExactly("2026-01-02","2026-01-03","2026-01-04");assertThat(find(rule.get("id").asText()).get("status").asText()).isEqualTo("COMPLETED");
    }
    @Test void largeBacklogAdvancesInCommittedBatches() throws Exception {
        clock.date("2023-12-31");create(input("DAILY","2024-01-01"));clock.date("2026-01-01");
        assertThat(processor.processDue().posted()).isEqualTo(500);assertThat(processor.processDue().posted()).isEqualTo(232);
        assertThat(processor.processDue().posted()).isZero();assertThat(count("transactions")).isEqualTo(732);
    }
    @Test void concurrentWorkersCommitEachOccurrenceOnce() throws Exception {
        JsonNode r=create(input("DAILY","2026-01-02"));UUID id=UUID.fromString(r.get("id").asText());clock.date("2026-01-06");
        try(var executor=Executors.newFixedThreadPool(6)) {
            var ready=new CountDownLatch(6);var go=new CountDownLatch(1);List<Future<Integer>> results=new ArrayList<>();
            for(int i=0;i<6;i++) results.add(executor.submit(()->{ready.countDown();go.await();var result=new int[1];CurrentIdentity.processAccount(DemoIdentity.USER_ID,DemoIdentity.ACCOUNT_ID,()->result[0]=service.processOne(id));return result[0];}));
            assertThat(ready.await(5,TimeUnit.SECONDS)).isTrue();go.countDown();int sum=0;
            for(var future:results) sum+=future.get(15,TimeUnit.SECONDS);
            assertThat(sum).isEqualTo(5);assertThat(count("transactions")).isEqualTo(5);assertThat(count("recurring_occurrences")).isEqualTo(5);
        }
        balance("950.00");
    }
    @Test void failureBetweenPostingAndReceiptRollsBackAllState() throws Exception {
        JsonNode r=create(input("DAILY","2026-01-02"));UUID id=UUID.fromString(r.get("id").asText());clock.date("2026-01-02");
        jdbc.execute("ALTER TABLE recurring_occurrences ADD CONSTRAINT test_occurrence_failure CHECK (occurrence_date <> DATE '2026-01-02')");
        assertThatThrownBy(()->service.processOne(id)).isInstanceOf(RuntimeException.class);
        assertThat(count("transactions")).isZero();assertThat(count("recurring_occurrences")).isZero();
        assertThat(find(id.toString()).get("nextDate").asText()).isEqualTo("2026-01-02");
        jdbc.execute("ALTER TABLE recurring_occurrences DROP CONSTRAINT test_occurrence_failure");
        assertThat(service.processOne(id)).isEqualTo(1);assertThat(service.processOne(id)).isZero();balance("990.00");
    }
    @Test void deletingPostedTransactionKeepsReceiptAndNeverRecreatesIt() throws Exception {
        JsonNode r=create(input("DAILY","2026-01-01"));String id=r.get("id").asText();String transaction=jdbc.queryForObject("SELECT CAST(id AS VARCHAR) FROM transactions",String.class);
        mvc.perform(delete("/api/transactions/"+transaction)).andExpect(status().isNoContent());
        jdbc.update("UPDATE recurring_rules SET next_date = DATE '2026-01-01' WHERE id = ?",UUID.fromString(id));
        assertThat(processor.processDue().posted()).isZero();assertThat(count("transactions")).isZero();balance("1000.00");
        mvc.perform(get("/api/recurring-transactions/"+id+"/history")).andExpect(jsonPath("$[0].resolution").value("REMOVED"));
    }
    @Test void futureEditsPreserveHistoryAndCanChangeFrequency() throws Exception {
        var values=input("DAILY","2026-01-01");JsonNode r=create(values);String id=r.get("id").asText();
        values.put("amount","25.00");values.put("frequency","MONTHLY");values.put("paymentDay",15);
        mvc.perform(put("/api/recurring-transactions/"+id).contentType("application/json").content(json.writeValueAsBytes(Map.of("rule",values,"version",r.get("version").asLong())))).andExpect(status().isOk());
        clock.date("2026-01-15");processor.processDue();assertThat(dates()).containsExactly("2026-01-01","2026-01-15");
        assertThat(jdbc.queryForObject("SELECT amount FROM transactions WHERE transaction_date = DATE '2026-01-01'",java.math.BigDecimal.class)).isEqualByComparingTo("10.00");balance("965.00");
    }
    @Test void pausedDaysAreSkippedOnResume() throws Exception {
        JsonNode r=create(input("DAILY","2026-01-01"));String id=r.get("id").asText();
        mvc.perform(put("/api/recurring-transactions/"+id+"/state").contentType("application/json").content(json.writeValueAsBytes(Map.of("enabled",false,"version",r.get("version").asLong())))).andExpect(status().isOk());
        clock.date("2026-01-05");assertThat(processor.processDue().posted()).isZero();r=find(id);
        mvc.perform(put("/api/recurring-transactions/"+id+"/state").contentType("application/json").content(json.writeValueAsBytes(Map.of("enabled",true,"version",r.get("version").asLong())))).andExpect(status().isOk()).andExpect(jsonPath("$.nextDate").value("2026-01-06"));
        clock.date("2026-01-06");assertThat(processor.processDue().posted()).isEqualTo(1);assertThat(dates()).containsExactly("2026-01-01","2026-01-06");
    }
    @Test void cancelPreservesPostedHistoryAndStopsProcessing() throws Exception {
        JsonNode r=create(input("DAILY","2026-01-01"));String id=r.get("id").asText();
        mvc.perform(post("/api/recurring-transactions/"+id+"/stop").contentType("application/json").content(json.writeValueAsBytes(Map.of("version",r.get("version").asLong())))).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELED"));
        assertThat(find(id).get("nextDate").isNull()).isTrue();
        clock.date("2026-02-01");assertThat(processor.processDue().posted()).isZero();assertThat(count("transactions")).isEqualTo(1);balance("990.00");
    }
    @Test void recurringIncomeUsesExistingBalancesAndCategorySummary() throws Exception {
        var values=input("DAILY","2026-01-01");values.put("type","INCOME");values.put("categoryId",category("Salary"));values.put("amount","100.55");create(values);create(input("DAILY","2026-01-01"));balance("1090.55");
        mvc.perform(get("/api/summaries/monthly").param("month","2026-01")).andExpect(jsonPath("$.income").value(100.55)).andExpect(jsonPath("$.expenses").value(10.0));
        mvc.perform(get("/api/transactions")).andExpect(jsonPath("$[0].recurringRuleId").isNotEmpty());
    }
    @Test void createRequestRetriesCannotCreateDuplicateSchedulesOrPostings() throws Exception {
        var values=input("DAILY","2026-01-01");JsonNode first=create(values);JsonNode second=create(values);assertThat(first.get("id")).isEqualTo(second.get("id"));assertThat(count("recurring_rules")).isEqualTo(1);assertThat(count("transactions")).isEqualTo(1);
        values.put("amount","11.00");mvc.perform(post("/api/recurring-transactions").contentType("application/json").content(json.writeValueAsBytes(values))).andExpect(status().isConflict());
    }
    @Test void rejectsInvalidInputAndRequiresExplicitPastPostingConsent() throws Exception {
        for(var bad:Map.<String,Object>of("amount","0","frequency","INVALID","endDate","2025-12-31","paymentDay",32,"description"," ").entrySet()) {
            var values=input("MONTHLY","2026-01-01");values.put(bad.getKey(),bad.getValue());
            mvc.perform(post("/api/recurring-transactions").contentType("application/json").content(json.writeValueAsBytes(values))).andExpect(status().isBadRequest());
        }
        var twice=input("TWICE_MONTHLY","2026-01-01");twice.put("secondPaymentDay",1);
        mvc.perform(post("/api/recurring-transactions").contentType("application/json").content(json.writeValueAsBytes(twice))).andExpect(status().isBadRequest());
        var past=input("DAILY","2025-12-31");past.put("backfillConfirmed",false);
        mvc.perform(post("/api/recurring-transactions").contentType("application/json").content(json.writeValueAsBytes(past))).andExpect(status().isBadRequest());assertThat(count("transactions")).isZero();
    }
    @Test void staleVersionIsRejectedWithoutChangingSchedule() throws Exception {
        var values=input("DAILY","2026-01-02");JsonNode r=create(values);clock.date("2026-01-02");processor.processDue();
        mvc.perform(put("/api/recurring-transactions/"+r.get("id").asText()).contentType("application/json").content(json.writeValueAsBytes(Map.of("rule",values,"version",r.get("version").asLong())))).andExpect(status().isConflict());
    }
    String manual(String amount,String category) throws Exception {
        return json.readTree(mvc.perform(post("/api/transactions").contentType("application/json").content(json.writeValueAsBytes(Map.of("description","Manual payment","amount",amount,"type","EXPENSE","categoryId",category(category),"date","2026-01-01"))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
    }
    @Test void explicitManualLinkPreservesOriginalPaymentAndPreventsDuplicate() throws Exception {
        String t=manual("10.00","Dining");JsonNode r=create(input("MONTHLY","2026-01-10"));String id=r.get("id").asText();
        var body=Map.of("occurrenceDate","2026-02-01","transactionId",t);
        for(int i=0;i<2;i++) mvc.perform(post("/api/recurring-transactions/"+id+"/reconcile").contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isOk());
        assertThat(find(id).get("nextDate").asText()).isEqualTo("2026-03-01");
        clock.date("2026-02-01");assertThat(processor.processDue().posted()).isZero();assertThat(count("transactions")).isEqualTo(1);balance("990.00");
        mvc.perform(get("/api/transactions/"+t)).andExpect(jsonPath("$.categoryId").value(category("Dining"))).andExpect(jsonPath("$.date").value("2026-01-01"));
    }
    @Test void markHandledSkipsWithoutAddingMoneyAndRejectsNonOccurrence() throws Exception {
        JsonNode r=create(input("WEEKLY","2026-01-08"));String id=r.get("id").asText();
        mvc.perform(post("/api/recurring-transactions/"+id+"/reconcile").contentType("application/json").content("{\"occurrenceDate\":\"2026-01-09\"}")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/recurring-transactions/"+id+"/reconcile").contentType("application/json").content("{\"occurrenceDate\":\"2026-01-08\"}")).andExpect(status().isOk());
        clock.date("2026-01-08");assertThat(processor.processDue().posted()).isZero();balance("1000.00");
    }
    @Test void reconciliationRequiresAmountConfirmationAndCannotStealPostedPayment() throws Exception {
        String t=manual("11.00","Groceries");JsonNode r=create(input("DAILY","2026-01-02"));String id=r.get("id").asText();
        var body=new HashMap<String,Object>(Map.of("occurrenceDate","2026-01-02","transactionId",t));
        mvc.perform(post("/api/recurring-transactions/"+id+"/reconcile").contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isBadRequest());
        body.put("confirmAmountDifference",true);mvc.perform(post("/api/recurring-transactions/"+id+"/reconcile").contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isOk());
        JsonNode second=create(input("DAILY","2026-01-02"));mvc.perform(post("/api/recurring-transactions/"+second.get("id").asText()+"/reconcile").contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isConflict());balance("989.00");
    }
    @Test void alreadyGeneratedEntryIsNeverSilentlyDeletedDuringReconciliation() throws Exception {
        JsonNode r=create(input("DAILY","2026-01-01"));String generated=jdbc.queryForObject("SELECT CAST(id AS VARCHAR) FROM transactions",String.class);String t=manual("10.00","Groceries");
        var body=Map.of("occurrenceDate","2026-01-01","transactionId",t);String path="/api/recurring-transactions/"+r.get("id").asText()+"/reconcile";
        mvc.perform(post(path).contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isConflict());assertThat(count("transactions")).isEqualTo(2);
        mvc.perform(delete("/api/transactions/"+generated)).andExpect(status().isNoContent());
        mvc.perform(post(path).contentType("application/json").content(json.writeValueAsBytes(body))).andExpect(status().isOk());balance("990.00");
    }
    @Test void dueListingAndHistoryAreOwnedAndReadOnly() throws Exception {
        JsonNode r=create(input("TWICE_MONTHLY","2026-01-01"));String id=r.get("id").asText();
        mvc.perform(get("/api/recurring-transactions/"+id+"/occurrences").param("from","2026-01-01").param("to","2026-01-31")).andExpect(status().isOk()).andExpect(jsonPath("$[0].resolution").value("POSTED")).andExpect(jsonPath("$[1].resolution").value("SCHEDULED"));
        mvc.perform(get("/api/recurring-transactions/"+UUID.randomUUID()+"/history")).andExpect(status().isNotFound());assertThat(count("transactions")).isEqualTo(1);
    }
    @Test void startupCatchUpAndRepeatedTicksAreIdempotent() throws Exception {
        create(input("DAILY","2026-01-02"));clock.date("2026-01-06");
        RecurringScheduleRunner runner = new RecurringScheduleRunner(processor,jdbc);
        runner.onReady(); runner.tick(); runner.onReady();
        assertThat(dates()).containsExactly("2026-01-02","2026-01-03","2026-01-04","2026-01-05","2026-01-06");balance("950.00");
    }
    @Test void scheduledDatesRemainCalendarDatesAcrossDaylightSaving() throws Exception {
        clock.date("2026-03-06");create(input("DAILY","2026-03-07"));clock.date("2026-03-10");processor.processDue();
        assertThat(dates()).containsExactly("2026-03-07","2026-03-08","2026-03-09","2026-03-10");
    }
    @Test void foreignOwnerCategoriesAndRulesCannotBeUsed() throws Exception {
        UUID other=UUID.randomUUID(),account=UUID.randomUUID(),category=UUID.randomUUID(),id=UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,display_name) VALUES (?,?,?)",other,other+"@synthetic.local","Other");
        jdbc.update("INSERT INTO accounts(id,user_id,name,currency,starting_balance) VALUES (?,?,?,'USD',0)",account,other,"Other");
        jdbc.update("INSERT INTO categories(id,user_id,name,type) VALUES (?,?,?,'EXPENSE')",category,other,"Private category");
        jdbc.update("INSERT INTO recurring_rules(id,user_id,account_id,category_id,description,amount,type,frequency,start_date,next_date,enabled,request_id,creation_fingerprint) VALUES (?,?,?,?,?,10,'EXPENSE','DAILY',DATE '2026-01-01',DATE '2026-01-01',TRUE,?,?)",id,other,account,category,"Private rule",UUID.randomUUID(),"0".repeat(64));
        mvc.perform(get("/api/recurring-transactions/"+id+"/history")).andExpect(status().isNotFound());
        mvc.perform(post("/api/recurring-transactions/"+id+"/reconcile").contentType("application/json").content("{\"occurrenceDate\":\"2026-01-01\"}")).andExpect(status().isNotFound());
        var values=input("DAILY","2026-01-01");values.put("categoryId",category.toString());
        mvc.perform(post("/api/recurring-transactions").contentType("application/json").content(json.writeValueAsBytes(values))).andExpect(status().isBadRequest());
        assertThat(processor.processDue().posted()).isZero();assertThat(count("transactions")).isZero();
    }
    @Test void aiFeedbackForFutureScheduleIsStoredWithoutPrematureLedgerEntry() throws Exception {
        UUID prediction=UUID.randomUUID();
        jdbc.update("INSERT INTO category_predictions(id,user_id,description,amount,model_category,suggested_category_id,confidence,model_version,status) VALUES (?,?,?,10,'Groceries',?,0.72,'1.0','suggested')",prediction,DemoIdentity.USER_ID,"Recurring test",UUID.fromString(category("Groceries")));
        var values=input("DAILY","2026-01-02");values.put("predictionId",prediction.toString());create(values);
        assertThat(count("transactions")).isZero();assertThat(jdbc.queryForObject("SELECT outcome FROM recurring_prediction_feedback",String.class)).isEqualTo("accepted");
    }
}
