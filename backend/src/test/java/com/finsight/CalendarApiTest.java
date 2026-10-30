package com.finsight;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static com.finsight.RecurringModels.*;
import static com.finsight.ForecastModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
@ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
@Import(RecurringApiTest.TestClockConfig.class)
class CalendarApiTest {
    @Autowired RecurringApiTest.MutableClock clock;
    @Autowired CalendarService calendar;
    @Autowired ForecastService forecast;
    @Autowired RecurringRuleService recurring;
    @Autowired PlannedTransactionService plans;
    @Autowired FinanceService finance;
    @Autowired RecurringProcessor processor;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @BeforeEach void setup() { clean(); clock.date("2026-01-01"); jdbc.update("UPDATE accounts SET starting_balance=1000 WHERE id=?",DemoIdentity.ACCOUNT_ID); }
    @AfterEach void clean() { for(String t:List.of("planned_transactions","forecast_preferences","recurring_prediction_feedback","recurring_occurrences","recurring_rules","category_prediction_feedback","category_predictions","transactions"))jdbc.update("DELETE FROM "+t); }
    UUID category(TransactionType type){return finance.categories().stream().filter(c->c.name().equals(type==TransactionType.INCOME?"Salary":"Groceries")).findFirst().orElseThrow().id();}
    RuleView rule(String frequency,TransactionType type,String amount,String start,Integer first,Integer second,LocalDate end) {
        return recurring.create(new RuleInput("Synthetic "+frequency,new BigDecimal(amount),type,category(type),RecurrenceFrequency.valueOf(frequency),first,second,LocalDate.parse(start),end,true,UUID.randomUUID(),true,null));
    }
    PlanView plan(String amount,TransactionType type,String date){return plans.create(new PlanInput("Synthetic plan",new BigDecimal(amount),type,category(type),LocalDate.parse(date),UUID.randomUUID()));}
    CalendarModels.Month month(String value){return calendar.month(YearMonth.parse(value));}
    CalendarModels.Day day(CalendarModels.Month m,String date){return m.days().stream().filter(d->d.date().toString().equals(date)).findFirst().orElseThrow();}
    List<CalendarModels.Entry> entries(CalendarModels.Month m){return m.days().stream().flatMap(d->d.entries().stream()).toList();}
    @ParameterizedTest @CsvSource({"2026-01,31","2026-02,28","2028-02,29","2026-12,31","2027-01,31"})
    void exactMonthAndYearRanges(String month,int count){var m=month(month);assertThat(m.days()).hasSize(count);assertThat(m.month()).isEqualTo(month);assertThat(m.days().getFirst().date()).isEqualTo(YearMonth.parse(month).atDay(1));assertThat(m.days().getLast().date()).isEqualTo(YearMonth.parse(month).atEndOfMonth());}
    @ParameterizedTest @CsvSource({"DAILY,28","WEEKLY,4","BIWEEKLY,2","TWICE_MONTHLY,1","MONTHLY,1","YEARLY,0"})
    void allSixFrequenciesShareForecastDates(String frequency,int count){
        rule(frequency,TransactionType.EXPENSE,"10","2026-01-02",Set.of("MONTHLY","TWICE_MONTHLY").contains(frequency)?(frequency.equals("MONTHLY")?31:30):null,frequency.equals("TWICE_MONTHLY")?31:null,null);
        var m=month("2026-02");assertThat(entries(m).stream().filter(CalendarModels.Entry::projected)).hasSize(count);
        var f=forecast.forecast(LocalDate.parse("2026-02-28"));for(var d:m.days())assertThat(d.projection()).isEqualTo(f.days().stream().filter(x->x.date().equals(d.date())).findFirst().orElseThrow());
        assertThat(m.summary().upcomingExpenses()).isEqualTo(f.months().getLast().expenses());
    }
    @Test void februaryLeapClampsWithoutDuplicatesAndYearlyReturnsTo29(){clock.date("2024-01-01");rule("TWICE_MONTHLY",TransactionType.EXPENSE,"0.10","2024-02-01",30,31,null);rule("YEARLY",TransactionType.INCOME,"0.20","2024-02-29",null,null,null);
        var m=month("2024-02");assertThat(day(m,"2024-02-29").entries()).hasSize(2);assertThat(m.summary().upcomingExpenses()).isEqualTo("0.10");assertThat(m.summary().expectedIncome()).isEqualTo("0.20");assertThat(entries(month("2025-02"))).allMatch(e->e.scheduledDate().equals(LocalDate.parse("2025-02-28")));
        assertThat(entries(month("2028-02"))).allMatch(e->e.scheduledDate().equals(LocalDate.parse("2028-02-29")));}
    @Test void startEndAndFutureOnlyEditsArePreserved(){var r=rule("DAILY",TransactionType.EXPENSE,"10","2026-01-02",null,null,LocalDate.parse("2026-01-05"));clock.date("2026-01-03");processor.processDue();r=recurring.get(r.id());recurring.update(r.id(),new RuleUpdate(new RuleInput(r.description(),new BigDecimal("20"),r.type(),r.categoryId(),r.frequency(),null,null,r.startDate(),r.endDate(),true,r.requestId(),false,null),r.version()));var m=month("2026-01");assertThat(day(m,"2026-01-02").entries().getFirst().amount()).isEqualTo("10.00");assertThat(day(m,"2026-01-04").entries().getFirst().amount()).isEqualTo("20.00");assertThat(day(m,"2026-01-06").entries()).isEmpty();}
    @Test void pausedAndCanceledRulesHaveNoFutureProjectionButHistorySurvives(){var r=rule("DAILY",TransactionType.EXPENSE,"10","2026-01-01",null,null,null);r=recurring.setEnabled(r.id(),new StateInput(false,recurring.get(r.id()).version()));assertThat(entries(month("2026-02"))).isEmpty();recurring.archive(r.id(),new ArchiveInput(r.version()));assertThat(entries(month("2026-01"))).hasSize(1).allMatch(e->e.source().equals("RECORDED"));assertThat(entries(month("2026-02"))).isEmpty();}
    @Test void resumeSkipsPausedDays(){var r=rule("DAILY",TransactionType.INCOME,"10","2026-01-02",null,null,null);r=recurring.setEnabled(r.id(),new StateInput(false,r.version()));clock.date("2026-01-05");recurring.setEnabled(r.id(),new StateInput(true,r.version()));var m=month("2026-01");assertThat(day(m,"2026-01-05").entries()).isEmpty();assertThat(day(m,"2026-01-06").entries()).hasSize(1);}
    @Test void plannedIncomeExpenseAndDecimalTotalsMatchMonthlyForecast(){plan("0.10",TransactionType.INCOME,"2026-02-01");plan("0.20",TransactionType.INCOME,"2026-02-01");plan("0.10",TransactionType.EXPENSE,"2026-02-01");var m=month("2026-02");assertThat(m.summary().expectedIncome()).isEqualTo("0.30");assertThat(m.summary().monthEndBalance()).isEqualTo("1000.20");assertThat(day(m,"2026-02-01").flows().plannedIncome()).isEqualTo("0.30");assertThat(finance.account().balance()).isEqualByComparingTo("1000");}
    @Test void cancellationVisibleWithoutAffectingForecast(){var p=plan("500",TransactionType.EXPENSE,"2026-02-01");plans.cancel(p.id(),new VersionInput(p.version()));var m=month("2026-02");assertThat(entries(m)).hasSize(1).allMatch(e->e.status().equals("CANCELED")&&!e.projected());assertThat(m.summary().upcomingExpenses()).isEqualTo("0.00");assertThat(m.summary().monthEndBalance()).isEqualTo("1000.00");}
    @Test void explicitCompletionShowsActualOnceAndForecastRemainsConsistent(){var p=plan("50",TransactionType.EXPENSE,"2026-01-02");clock.date("2026-01-02");String projected=month("2026-01").summary().monthEndBalance();var input=new CompletionInput(CompletionMode.RECORD,null,null,false,UUID.randomUUID(),p.version());plans.complete(p.id(),input);plans.complete(p.id(),input);var m=month("2026-01");assertThat(m.summary().monthEndBalance()).isEqualTo(projected);assertThat(day(m,"2026-01-02").entries()).hasSize(1).allMatch(e->e.source().equals("RECORDED")&&e.plannedTransactionId().equals(p.id()));}
    @Test void earlyManualReconciliationHasTwoDatesButOnlyOneActualPayment(){var r=rule("MONTHLY",TransactionType.EXPENSE,"50","2026-02-01",1,null,null);var t=finance.create(new ApiModels.TransactionInput("Early actual",new BigDecimal("50"),TransactionType.EXPENSE,category(TransactionType.EXPENSE),LocalDate.parse("2026-01-01"),null));recurring.reconcile(r.id(),new ReconcileInput(LocalDate.parse("2026-02-01"),t.id(),false));var p=plan("50",TransactionType.EXPENSE,"2026-02-01");plans.complete(p.id(),new CompletionInput(CompletionMode.LINK,t.id(),null,false,UUID.randomUUID(),p.version()));var jan=month("2026-01");assertThat(entries(jan)).hasSize(1);assertThat(entries(jan).getFirst().plannedTransactionId()).isEqualTo(p.id());assertThat(entries(jan).getFirst().recurringRuleId()).isEqualTo(r.id());var feb=month("2026-02");assertThat(entries(feb)).allMatch(e->!e.projected());assertThat(feb.summary().upcomingExpenses()).isEqualTo("0.00");assertThat(feb.summary().monthEndBalance()).isEqualTo("950.00");}
    @Test void handledAndRemovedReceiptsNeverReappearAsUpcoming(){var r=rule("DAILY",TransactionType.EXPENSE,"10","2026-01-01",null,null,LocalDate.parse("2026-01-03"));recurring.reconcile(r.id(),new ReconcileInput(LocalDate.parse("2026-01-02"),null,false));var t=finance.list().getFirst();finance.delete(t.id());var m=month("2026-01");assertThat(day(m,"2026-01-01").entries().getFirst().status()).isEqualTo("REMOVED");assertThat(day(m,"2026-01-02").entries().getFirst().status()).isEqualTo("HANDLED");assertThat(m.summary().upcomingExpenses()).isEqualTo("10.00");}
    @Test void historicalDatesNeverInventBalances(){clock.date("2026-03-01");var m=month("2026-02");assertThat(m.days()).allMatch(d->d.projection()==null&&d.flows()==null);assertThat(m.summary().monthEndBalance()).isNull();assertThat(m.summary().lowestBalance()).isNull();assertThat(m.historicalExplanation()).contains("opening balance");}
    @Test void overduePlansShowOriginalIntentionAndTodayProjectionWithoutPosting(){var p=plan("50",TransactionType.EXPENSE,"2026-01-02");clock.date("2026-02-01");assertThat(day(month("2026-01"),"2026-01-02").entries()).hasSize(1).allMatch(e->e.status().equals("OVERDUE")&&!e.projected());var feb=month("2026-02");assertThat(day(feb,"2026-02-01").entries()).hasSize(1).allMatch(e->e.plannedTransactionId().equals(p.id())&&e.projected());assertThat(finance.list()).isEmpty();}
    @Test void lowAndNegativeIndicatorsReuseForecastWarnings(){forecast.savePreferences(new PreferenceInput(new BigDecimal("900"),0L));plan("150",TransactionType.EXPENSE,"2026-02-02");plan("900",TransactionType.EXPENSE,"2026-02-03");var m=month("2026-02");assertThat(day(m,"2026-02-02").warnings().getFirst().severity()).isEqualTo("LOW");assertThat(day(m,"2026-02-03").warnings().getFirst().severity()).isEqualTo("NEGATIVE");assertThat(m.summary().lowestBalance()).isEqualTo("-50.00");assertThat(m.summary().lowestDate()).isEqualTo(LocalDate.parse("2026-02-03"));assertThat(day(m,"2026-02-03").warnings()).isEqualTo(forecast.forecast(LocalDate.parse("2026-02-28")).warnings().stream().filter(w->w.date().equals(LocalDate.parse("2026-02-03"))).toList());}
    @Test void emptyMonthsCarryBalanceAndReturnOnlySelectedRange(){var m=month("2026-05");assertThat(entries(m)).isEmpty();assertThat(m.days()).hasSize(31).allMatch(d->d.date().getMonthValue()==5&&d.projection().endingBalance().equals("1000.00"));assertThat(m.summary().nextBill()).isNull();}
    @Test void finalDayOfCurrentMonthStillMatchesForecast(){clock.date("2026-01-31");var m=month("2026-01");assertThat(m.days().stream().filter(d->d.projection()!=null)).hasSize(1);assertThat(day(m,"2026-01-31").today()).isTrue();assertThat(m.summary().monthEndBalance()).isEqualTo(forecast.forecast(LocalDate.parse("2026-02-01")).days().getFirst().endingBalance());}
    @Test void readsDoNotChangeCountsBalancesCursorsOrPreferences(){var r=rule("DAILY",TransactionType.EXPENSE,"10","2026-01-02",null,null,null);var p=plan("50",TransactionType.EXPENSE,"2026-01-05");r=recurring.get(r.id());var beforePlans=plans.list();var actual=finance.account();month("2026-01");month("2026-02");assertThat(finance.account()).isEqualTo(actual);assertThat(recurring.get(r.id())).isEqualTo(r);assertThat(plans.list()).isEqualTo(beforePlans);assertThat(forecast.preferences().version()).isZero();assertThat(finance.list()).isEmpty();}
    @Test void otherOwnersRecordedActivityIsExcluded(){
        UUID user=UUID.randomUUID(),account=UUID.randomUUID(),category=UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,display_name) VALUES (?,?,?)",user,user+"@synthetic.local","Other");
        jdbc.update("INSERT INTO accounts(id,user_id,name,currency,starting_balance) VALUES (?,?,?,'USD',0)",account,user,"Other");
        jdbc.update("INSERT INTO categories(id,user_id,name,type) VALUES (?,?,?,'EXPENSE')",category,user,"Other");
        jdbc.update("INSERT INTO transactions(id,user_id,account_id,category_id,description,amount,type,transaction_date) VALUES (?,?,?,?,?,999,'EXPENSE',DATE '2026-01-01')",UUID.randomUUID(),user,account,category,"Foreign synthetic");
        assertThat(entries(month("2026-01"))).isEmpty();assertThat(month("2026-01").summary().monthEndBalance()).isEqualTo("1000.00");
    }
    @Test void apiStructureValidationAndUnknownProperties()throws Exception{mvc.perform(get("/api/calendar").param("month","2026-02")).andExpect(status().isOk()).andExpect(jsonPath("$.days.length()").value(28)).andExpect(jsonPath("$.summary.monthEndBalance").value("1000.00"));for(String invalid:List.of("invalid","2026-13","1899-12","2099-01"))mvc.perform(get("/api/calendar").param("month",invalid)).andExpect(status().isBadRequest());mvc.perform(get("/api/calendar")).andExpect(jsonPath("$.month").value("2026-01"));}
}
