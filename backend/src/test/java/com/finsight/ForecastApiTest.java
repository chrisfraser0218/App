package com.finsight;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.time.*;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import static com.finsight.ForecastModels.*;
import static com.finsight.RecurringModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@org.junit.jupiter.api.extension.ExtendWith(LegacyIdentityExtension.class)
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
@ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
@Import({LegacyTestSupport.class, RecurringApiTest.TestClockConfig.class})
class ForecastApiTest {
    @Autowired RecurringApiTest.MutableClock clock;
    @Autowired ForecastService forecasts;
    @Autowired PlannedTransactionService plans;
    @Autowired RecurringRuleService rules;
    @Autowired RecurringProcessor processor;
    @Autowired FinanceService finance;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired MockMvc mvc;
    @BeforeEach void setup(){clean();clock.date("2026-01-01");jdbc.update("UPDATE accounts SET starting_balance=1000 WHERE id=?",DemoIdentity.ACCOUNT_ID);}
    @AfterEach void clean(){
        jdbc.execute("ALTER TABLE planned_transactions DROP CONSTRAINT IF EXISTS test_completion_failure");
        for(String table:List.of("planned_transactions","forecast_preferences","recurring_prediction_feedback","recurring_occurrences","recurring_rules","category_prediction_feedback","category_predictions","transactions"))jdbc.update("DELETE FROM "+table);
    }
    UUID category(String name){return jdbc.queryForObject("SELECT id FROM categories WHERE user_id=? AND name=?",UUID.class,DemoIdentity.USER_ID,name);}
    PlanInput input(String amount,String type,String date){return new PlanInput("Synthetic plan",new BigDecimal(amount),TransactionType.valueOf(type),category(type.equals("INCOME")?"Salary":"Groceries"),LocalDate.parse(date),UUID.randomUUID());}
    RuleView rule(String frequency,String start,Integer first,Integer second,TransactionType type,String amount,LocalDate end){
        return rules.create(new RuleInput("Synthetic recurring",new BigDecimal(amount),type,category(type==TransactionType.INCOME?"Salary":"Groceries"),RecurrenceFrequency.valueOf(frequency),first,second,LocalDate.parse(start),end,true,UUID.randomUUID(),true,null));
    }
    Forecast f(String end){return forecasts.forecast(LocalDate.parse(end));}
    void money(String actual,String expected){assertThat(new BigDecimal(actual)).isEqualByComparingTo(expected);}
    int count(String table){return jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class);}
    CompletionInput completion(PlanView p,CompletionMode mode,UUID transaction,boolean confirm){return new CompletionInput(mode,transaction,null,confirm,UUID.randomUUID(),p.version());}
    @ParameterizedTest @CsvSource({"1,2026-02-28","3,2026-04-30","5,2026-06-30","6,2026-07-31","12,2027-01-31"})
    void monthPresetsUseExactCalendarEndDates(int months,String expected)throws Exception{
        clock.date("2026-01-31");mvc.perform(get("/api/forecasts").param("months",String.valueOf(months))).andExpect(status().isOk()).andExpect(jsonPath("$.summary.endDate").value(expected)).andExpect(jsonPath("$.summary.projectedBalance").value("1000.00"));
    }
    @ParameterizedTest @CsvSource({"DAILY,58","WEEKLY,9","BIWEEKLY,5","TWICE_MONTHLY,3","MONTHLY,2","YEARLY,1"})
    void allSixFrequenciesReuseExactScheduledDates(String frequency,int count){
        rule(frequency,"2026-01-02",Set.of("MONTHLY","TWICE_MONTHLY").contains(frequency)?(frequency.equals("MONTHLY")?31:1):null,frequency.equals("TWICE_MONTHLY")?15:null,TransactionType.EXPENSE,"10",null);
        Forecast result=f("2026-02-28");assertThat(result.days().stream().mapToInt(d->d.transactions().size()).sum()).isEqualTo(count);money(result.summary().projectedBalance(),String.valueOf(1000-count*10));assertThat(count("transactions")).isZero();
    }
    @Test void customDateAndDailyMonthlyEndpointsAgree()throws Exception{
        plans.create(input("50","EXPENSE","2026-01-15"));mvc.perform(get("/api/forecasts").param("endDate","2026-02-05")).andExpect(status().isOk()).andExpect(jsonPath("$.summary.projectedBalance").value("950.00"));
        mvc.perform(get("/api/forecasts/daily/2026-01-15")).andExpect(status().isOk()).andExpect(jsonPath("$.endingBalance").value("950.00"));
        mvc.perform(get("/api/forecasts/monthly").param("endDate","2026-02-05")).andExpect(jsonPath("$[0].endingBalance").value("950.00")).andExpect(jsonPath("$[1].startingBalance").value("950.00"));
    }
    @Test void monthEndAndLeapDatesDoNotDriftOrDuplicate(){
        clock.date("2024-01-01");rule("TWICE_MONTHLY","2024-02-01",30,31,TransactionType.EXPENSE,"10",null);
        var events=f("2024-03-31").days().stream().flatMap(d->d.transactions().stream()).toList();
        assertThat(events.stream().map(Event::scheduledDate)).containsExactly(LocalDate.parse("2024-02-29"),LocalDate.parse("2024-03-30"),LocalDate.parse("2024-03-31"));
    }
    @Test void yearlyLeapDayReturnsTo29InLeapYears(){
        clock.date("2024-02-28");rule("YEARLY","2024-02-29",null,null,TransactionType.INCOME,"1",null);
        assertThat(f("2028-03-01").days().stream().flatMap(d->d.transactions().stream()).map(Event::scheduledDate)).containsExactly(LocalDate.parse("2024-02-29"),LocalDate.parse("2025-02-28"),LocalDate.parse("2026-02-28"),LocalDate.parse("2027-02-28"),LocalDate.parse("2028-02-29"));
    }
    @Test void usesLedgerBalanceAndExactFiveMonthIncomeRatherThanMonthlyAverages(){
        jdbc.update("UPDATE accounts SET starting_balance=5000 WHERE id=?",DemoIdentity.ACCOUNT_ID);
        rule("BIWEEKLY","2026-01-02",null,null,TransactionType.INCOME,"2500",null);rule("MONTHLY","2026-01-02",1,null,TransactionType.EXPENSE,"1500",null);
        var result=f("2026-06-01");money(result.summary().currentActualBalance(),"5000");money(result.summary().recurringIncome(),"27500");money(result.summary().recurringExpenses(),"7500");money(result.summary().projectedBalance(),"25000");
    }
    @Test void pauseResumeCursorAndCancellationAreRespected(){
        var r=rule("DAILY","2026-01-02",null,null,TransactionType.EXPENSE,"10",null);r=rules.setEnabled(r.id(),new StateInput(false,r.version()));
        money(f("2026-01-10").summary().projectedBalance(),"1000");clock.date("2026-01-06");r=rules.setEnabled(r.id(),new StateInput(true,r.version()));
        var result=f("2026-01-10");assertThat(result.days().stream().flatMap(d->d.transactions().stream()).map(Event::scheduledDate)).containsExactly(LocalDate.parse("2026-01-07"),LocalDate.parse("2026-01-08"),LocalDate.parse("2026-01-09"),LocalDate.parse("2026-01-10"));
        rules.archive(r.id(),new ArchiveInput(r.version()));money(f("2026-01-10").summary().projectedBalance(),"1000");
    }
    @Test void effectiveEditsAndEndDatesPreserveHistory(){
        var r=rule("DAILY","2026-01-02",null,null,TransactionType.EXPENSE,"10",LocalDate.parse("2026-01-05"));
        money(f("2026-01-10").summary().projectedBalance(),"960");
        clock.date("2026-01-03");processor.processDue();r=rules.get(r.id());
        rules.update(r.id(),new RuleUpdate(new RuleInput(r.description(),new BigDecimal("20"),r.type(),r.categoryId(),r.frequency(),null,null,r.startDate(),r.endDate(),true,r.requestId(),false,null),r.version()));
        money(f("2026-01-10").summary().projectedBalance(),"940");money(finance.account().balance().toPlainString(),"980");
    }
    @Test void manualReconciliationAndDeletedReceiptsNeverProjectAgain(){
        var r=rule("DAILY","2026-01-02",null,null,TransactionType.EXPENSE,"10",null);
        var t=finance.create(new ApiModels.TransactionInput("Actual early payment",new BigDecimal("10"),TransactionType.EXPENSE,category("Dining"),LocalDate.parse("2026-01-01"),null));
        rules.reconcile(r.id(),new ReconcileInput(LocalDate.parse("2026-01-02"),t.id(),false));money(f("2026-01-05").summary().projectedBalance(),"960");
        finance.delete(t.id());money(f("2026-01-05").summary().projectedBalance(),"970");
        rules.reconcile(r.id(),new ReconcileInput(LocalDate.parse("2026-01-03"),null,false));money(f("2026-01-05").summary().projectedBalance(),"980");
    }
    @Test void forecastIsReadOnlyAndConsistentAcrossRecurringProcessing(){
        var r=rule("DAILY","2026-01-02",null,null,TransactionType.EXPENSE,"10",null);clock.date("2026-01-03");
        var before=f("2026-01-05");assertThat(count("transactions")).isZero();assertThat(count("recurring_occurrences")).isZero();assertThat(count("forecast_preferences")).isZero();
        assertThat(rules.get(r.id()).nextDate()).isEqualTo(LocalDate.parse("2026-01-02"));assertThat(before.summary().overdueOccurrences()).isEqualTo(1);
        processor.processDue();var after=f("2026-01-05");assertThat(after.summary().projectedBalance()).isEqualTo(before.summary().projectedBalance());assertThat(after.days().getFirst().endingBalance()).isEqualTo(before.days().getFirst().endingBalance());
    }
    @Test void plannedIncomeExpenseEditingCancellationDoNotChangeActualMoney(){
        plans.create(input("100","INCOME","2026-01-03"));var p=plans.create(input("50","EXPENSE","2026-01-04"));
        money(f("2026-01-10").summary().projectedBalance(),"1050");money(finance.account().balance().toPlainString(),"1000");assertThat(count("transactions")).isZero();
        p=plans.update(p.id(),new PlanUpdate(new PlanInput(p.description(),new BigDecimal("75"),p.type(),p.categoryId(),p.date(),p.requestId()),p.version()));money(f("2026-01-10").summary().projectedBalance(),"1025");
        plans.cancel(p.id(),new VersionInput(p.version()));money(f("2026-01-10").summary().projectedBalance(),"1100");
    }
    @Test void overduePlanIsVisibleButNeverAutomaticallyPosts(){
        plans.create(input("70","EXPENSE","2026-01-02"));clock.date("2026-01-05");processor.processDue();var result=f("2026-01-10");
        assertThat(count("transactions")).isZero();assertThat(result.summary().overduePlans()).isEqualTo(1);assertThat(result.days().getFirst().transactions().getFirst().scheduledDate()).isEqualTo(LocalDate.parse("2026-01-02"));money(result.summary().projectedBalance(),"930");
    }
    @Test void dueCompletionRecordsExplicitlyOnceAndKeepsForecastConsistent(){
        var p=plans.create(input("70","EXPENSE","2026-01-02"));clock.date("2026-01-02");var before=f("2026-01-10");var body=completion(p,CompletionMode.RECORD,null,false);
        var first=plans.complete(p.id(),body);var retry=plans.complete(p.id(),body);assertThat(first.transactionId()).isEqualTo(retry.transactionId());assertThat(count("transactions")).isEqualTo(1);money(finance.account().balance().toPlainString(),"930");assertThat(f("2026-01-10").summary().projectedBalance()).isEqualTo(before.summary().projectedBalance());
        finance.delete(first.transactionId());assertThat(plans.list().getFirst().status()).isEqualTo("COMPLETED");money(f("2026-01-10").summary().projectedBalance(),"1000");
    }
    @Test void completionRetriesRemainAtomicUnderConcurrentCalls()throws Exception{
        var p=plans.create(input("70","EXPENSE","2026-01-02"));clock.date("2026-01-02");var body=completion(p,CompletionMode.RECORD,null,false);
        try(var executor=Executors.newFixedThreadPool(6)){
            List<Future<PlanView>> jobs=new ArrayList<>();for(int i=0;i<6;i++)jobs.add(executor.submit(()->LegacyTestSupport.owned(()->plans.complete(p.id(),body))));
            Set<UUID> ids=new HashSet<>();for(var job:jobs)ids.add(job.get(15,TimeUnit.SECONDS).transactionId());assertThat(ids).hasSize(1);
        }
        assertThat(count("transactions")).isEqualTo(1);money(finance.account().balance().toPlainString(),"930");
    }
    @Test void completionFailureRollsBackItsActualTransaction(){
        var p=plans.create(input("70","EXPENSE","2026-01-02"));clock.date("2026-01-02");var body=completion(p,CompletionMode.RECORD,null,false);
        jdbc.execute("ALTER TABLE planned_transactions ADD CONSTRAINT test_completion_failure CHECK (status <> 'COMPLETED')");assertThatThrownBy(()->plans.complete(p.id(),body)).isInstanceOf(RuntimeException.class);
        assertThat(count("transactions")).isZero();assertThat(plans.list().getFirst().status()).isEqualTo("PLANNED");jdbc.execute("ALTER TABLE planned_transactions DROP CONSTRAINT test_completion_failure");plans.complete(p.id(),body);assertThat(count("transactions")).isEqualTo(1);
    }
    @Test void earlyLinkExcludesPlanWithoutDoubleCountingOrChangingPayment(){
        var p=plans.create(input("70","EXPENSE","2026-01-10"));var t=finance.create(new ApiModels.TransactionInput("Actual early",new BigDecimal("80"),TransactionType.EXPENSE,category("Dining"),LocalDate.parse("2026-01-01"),null));
        assertThatThrownBy(()->plans.complete(p.id(),completion(p,CompletionMode.LINK,t.id(),false))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        plans.complete(p.id(),completion(p,CompletionMode.LINK,t.id(),true));money(finance.account().balance().toPlainString(),"920");money(f("2026-01-20").summary().projectedBalance(),"920");assertThat(finance.get(t.id()).categoryId()).isEqualTo(category("Dining"));
        var second=plans.create(input("70","EXPENSE","2026-01-10"));assertThatThrownBy(()->plans.complete(second.id(),completion(second,CompletionMode.LINK,t.id(),true))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    @Test void futureRecordingIsRejectedAndHandledOnlyCompletionDoesNotCreateMoney(){
        var p=plans.create(input("70","EXPENSE","2026-01-10"));assertThatThrownBy(()->plans.complete(p.id(),completion(p,CompletionMode.RECORD,null,false))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        plans.complete(p.id(),completion(p,CompletionMode.HANDLED,null,false));assertThat(count("transactions")).isZero();money(f("2026-01-20").summary().projectedBalance(),"1000");
    }
    @Test void planCreateRetriesAndStaleEditsAreProtected(){
        var value=input("70","EXPENSE","2026-01-10");var p=plans.create(value);assertThat(plans.create(value).id()).isEqualTo(p.id());assertThat(count("planned_transactions")).isEqualTo(1);
        var changed=new PlanInput(value.description(),new BigDecimal("80"),value.type(),value.categoryId(),value.date(),value.requestId());assertThatThrownBy(()->plans.create(changed)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        plans.update(p.id(),new PlanUpdate(changed,p.version()));assertThatThrownBy(()->plans.update(p.id(),new PlanUpdate(changed,p.version()))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
    @Test void thresholdsWarningsAndMinimumAreCalculatedFromExactBalances(){
        assertThat(count("forecast_preferences")).isZero();var pref=forecasts.preferences();var saved=forecasts.savePreferences(new PreferenceInput(new BigDecimal("150"),pref.version()));assertThat(saved.version()).isEqualTo(1);
        assertThatThrownBy(()->forecasts.savePreferences(new PreferenceInput(new BigDecimal("200"),0L))).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        plans.create(input("851","EXPENSE","2026-01-02"));var result=f("2026-01-03");money(result.summary().lowestBalance(),"149");assertThat(result.summary().lowestDate()).isEqualTo(LocalDate.parse("2026-01-02"));assertThat(result.warnings().getFirst().severity()).isEqualTo("LOW");assertThat(result.warnings().getFirst().transactions()).hasSize(1);
        plans.create(input("1000","EXPENSE","2026-01-03"));assertThat(f("2026-01-03").warnings().getLast().severity()).isEqualTo("NEGATIVE");
    }
    @Test void exactThresholdBoundaryDoesNotWarn(){plans.create(input("900","EXPENSE","2026-01-02"));assertThat(f("2026-01-03").warnings()).isEmpty();}
    @Test void whatIfIncomeExpensesCompareAgainstIdenticalBaselineAndAreNeverSaved(){
        plans.create(input("100","EXPENSE","2026-01-10"));var before=f("2026-02-01");var hypothetical=List.of(new Hypothetical(UUID.randomUUID(),"Unexpected expense",new BigDecimal("1000"),TransactionType.EXPENSE,LocalDate.parse("2026-01-15")),new Hypothetical(UUID.randomUUID(),"Extra income",new BigDecimal("2000"),TransactionType.INCOME,LocalDate.parse("2026-01-20")));
        var result=forecasts.evaluate(new ScenarioInput(LocalDate.parse("2026-02-01"),null,hypothetical));assertThat(result.baseline()).isEqualTo(before);money(result.scenario().summary().projectedBalance(),"1900");money(result.projectedDifference(),"1000");assertThat(count("planned_transactions")).isEqualTo(1);assertThat(count("transactions")).isZero();assertThat(count("forecast_preferences")).isZero();
        money(forecasts.evaluate(new ScenarioInput(LocalDate.parse("2026-02-01"),null,List.of())).scenario().summary().projectedBalance(),"900");
    }
    @Test void decimalPrecisionAndMonthlyDailySumsAreExact(){
        plans.create(input("0.10","INCOME","2026-01-02"));plans.create(input("0.20","INCOME","2026-01-02"));plans.create(input("0.10","EXPENSE","2026-01-02"));var result=f("2026-02-02");money(result.summary().projectedBalance(),"1000.20");assertThat(result.days().get(1).income()).isEqualTo("0.30");assertThat(result.months().getFirst().netChange()).isEqualTo("0.20");assertThat(result.months().getLast().startingBalance()).isEqualTo("1000.20");
    }
    @Test void invalidForecastAndPlanInputsReturnSafe400Responses()throws Exception{
        mvc.perform(post("/api/forecasts/scenarios").contentType("application/json").content("{\"endDate\":\"2026-02-01\",\"transactions\":[null]}")).andExpect(status().isBadRequest());
        for(String month:List.of("0","2","13"))mvc.perform(get("/api/forecasts").param("months",month)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/forecasts").param("endDate","2025-01-01")).andExpect(status().isBadRequest());mvc.perform(get("/api/forecasts").param("endDate","2099-01-01")).andExpect(status().isBadRequest());
        var valid=input("10","EXPENSE","2026-01-02");var node=json.valueToTree(valid);((com.fasterxml.jackson.databind.node.ObjectNode)node).put("amount","0.001");
        mvc.perform(post("/api/planned-transactions").contentType("application/json").content(json.writeValueAsBytes(node))).andExpect(status().isBadRequest());
        mvc.perform(post("/api/forecasts/scenarios").contentType("application/json").content("{\"endDate\":\"2026-02-01\",\"transactions\":[{\"id\":\"00000000-0000-0000-0000-000000000010\",\"description\":\"test\",\"amount\":1,\"type\":\"EXPENSE\",\"date\":\"2025-01-01\"}]}")).andExpect(status().isBadRequest());
    }
    @Test void foreignPlansAndCategoriesAreExcludedAndCannotBeChanged()throws Exception{
        UUID other=UUID.randomUUID(),account=UUID.randomUUID(),category=UUID.randomUUID(),id=UUID.randomUUID();jdbc.update("INSERT INTO users(id,email,display_name) VALUES (?,?,?)",other,other+"@synthetic.local","Other");jdbc.update("INSERT INTO accounts(id,user_id,name,currency,starting_balance) VALUES (?,?,?,'USD',0)",account,other,"Other");jdbc.update("INSERT INTO categories(id,user_id,name,type) VALUES (?,?,?,'EXPENSE')",category,other,"Other");
        jdbc.update("INSERT INTO planned_transactions(id,user_id,account_id,category_id,description,amount,type,planned_date,request_id,creation_fingerprint) VALUES (?,?,?,?,?,99999,'EXPENSE',DATE '2026-01-02',?,?)",id,other,account,category,"Private",UUID.randomUUID(),"f".repeat(64));
        assertThat(plans.list()).isEmpty();money(f("2026-01-10").summary().projectedBalance(),"1000");mvc.perform(post("/api/planned-transactions/"+id+"/cancel").contentType("application/json").content("{\"version\":0}")).andExpect(status().isNotFound());
        var value=new PlanInput("test",BigDecimal.ONE,TransactionType.EXPENSE,category,LocalDate.parse("2026-01-02"),UUID.randomUUID());assertThatThrownBy(()->plans.create(value)).isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }
}
