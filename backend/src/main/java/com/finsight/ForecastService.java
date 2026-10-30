package com.finsight;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.math.BigDecimal;
import static com.finsight.ForecastModels.*;
import com.finsight.ForecastModels.Month;

/** Deterministic, snapshot-consistent projection. No posting, model calls or persistence on this path. */
@Service @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
class ForecastService {
    static final int MAX_DAYS=3660;
    static final int MAX_EVENTS=100000;
    private final FinanceService finance;
    private final RecurringRuleRepository rules;
    private final PlannedTransactionRepository plans;
    private final AccountRepository accounts;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    ForecastService(FinanceService finance,RecurringRuleRepository rules,PlannedTransactionRepository plans,AccountRepository accounts,JdbcTemplate jdbc,Clock clock) {
        this.finance=finance;this.rules=rules;this.plans=plans;this.accounts=accounts;this.jdbc=jdbc;this.clock=clock;
    }
    LocalDate today(){return LocalDate.now(clock);}
    LocalDate resolveEnd(Integer months,LocalDate date) {
        if(months!=null&&date!=null)throw bad("Choose either months or endDate");
        if(months!=null&&!Set.of(1,3,5,6,12).contains(months))throw bad("Choose 1, 3, 5, 6 or 12 months, or a custom endDate");
        return validateEnd(date!=null?date:today().plusMonths(months==null?1:months));
    }
    private LocalDate validateEnd(LocalDate end) {
        if(!end.isAfter(today())||ChronoUnit.DAYS.between(today(),end)>MAX_DAYS||end.getYear()>9999)
            throw bad("Forecast end date must be after today and within 3660 days");
        return end;
    }
    Preferences preferences() {
        var rows=jdbc.query("SELECT low_balance_threshold,version FROM forecast_preferences WHERE account_id = ? AND user_id = ?",
            (r,n)->new Preferences(r.getBigDecimal(1).toPlainString(),r.getLong(2),today(),clock.getZone().toString(),today().plusDays(MAX_DAYS)),CurrentIdentity.accountId(),CurrentIdentity.userId());
        return rows.isEmpty()?new Preferences("100.00",0,today(),clock.getZone().toString(),today().plusDays(MAX_DAYS)):rows.getFirst();
    }
    @Transactional(readOnly=false,isolation=Isolation.READ_COMMITTED)
    public Preferences savePreferences(PreferenceInput input) {
        accounts.lockOwned(CurrentIdentity.accountId(),CurrentIdentity.userId()).orElseThrow(()->bad("Account not found"));
        Preferences current=preferences();
        if(current.version()!=input.version())throw new ResponseStatusException(HttpStatus.CONFLICT,"Preference changed. Refresh and try again");
        if(current.version()==0)jdbc.update("INSERT INTO forecast_preferences(account_id,user_id,low_balance_threshold,version) VALUES (?,?,?,1)",CurrentIdentity.accountId(),CurrentIdentity.userId(),input.lowBalanceThreshold());
        else jdbc.update("UPDATE forecast_preferences SET low_balance_threshold=?,version=version+1 WHERE account_id=? AND user_id=?",input.lowBalanceThreshold(),CurrentIdentity.accountId(),CurrentIdentity.userId());
        return preferences();
    }
    Forecast forecast(LocalDate end) {return evaluate(new ScenarioInput(end,null,List.of())).baseline();}
    Comparison evaluate(ScenarioInput input) {
        LocalDate asOf=today(),end=validateEnd(input.endDate());
        if(input.transactions().stream().map(Hypothetical::id).distinct().count()!=input.transactions().size())throw bad("Hypothetical IDs must be distinct");
        for(var h:input.transactions())if(!h.date().isAfter(asOf)||h.date().isAfter(end))throw bad("Hypothetical dates must be after today and within the selected horizon");
        BigDecimal actual=finance.account().balance();
        BigDecimal threshold=input.lowBalanceThreshold()!=null?input.lowBalanceThreshold():new BigDecimal(preferences().lowBalanceThreshold());
        Map<UUID,String> categories=new HashMap<>();for(var c:finance.categories())categories.put(c.id(),c.name());
        Set<String> handled=new HashSet<>();
        jdbc.query("SELECT rule_id,occurrence_date FROM recurring_occurrences WHERE user_id = ?",r->{handled.add(r.getObject(1,UUID.class)+":"+r.getObject(2,LocalDate.class));},CurrentIdentity.userId());
        List<Event> events=new ArrayList<>();
        for(var rule:rules.findByUserIdAndAccountIdOrderByCreatedAtDesc(CurrentIdentity.userId(),CurrentIdentity.accountId())) {
            if(!rule.enabled||rule.archived||rule.nextDate==null)continue;
            // The persisted cursor carries effective edits/resume skips. Never rewind to the original anchor.
            for(LocalDate date=RecurrenceDates.onOrAfter(rule,rule.nextDate);date!=null&&!date.isAfter(end);date=RecurrenceDates.after(rule,date)) {
                if(!handled.contains(rule.id+":"+date))events.add(event(rule.id+":"+date,"RECURRING",rule.id,rule.description,rule.type,rule.amount,categories.get(rule.categoryId),date,asOf));
                checkSize(events);
            }
        }
        for(var p:plans.findByUserIdAndAccountIdOrderByPlannedDateAscCreatedAtAsc(CurrentIdentity.userId(),CurrentIdentity.accountId()))
            if(p.status.equals("PLANNED")&&!p.plannedDate.isAfter(end)) {
                events.add(event(p.id.toString(),"PLANNED",p.id,p.description,p.type,p.amount,categories.get(p.categoryId),p.plannedDate,asOf));checkSize(events);
            }
        Forecast baseline=calculate(asOf,end,actual,threshold,events);
        if(input.transactions().isEmpty())return new Comparison(baseline,baseline,"0.00");
        List<Event> hypothetical=new ArrayList<>(events);
        for(var h:input.transactions())hypothetical.add(event(h.id().toString(),"HYPOTHETICAL",h.id(),h.description().strip(),h.type(),h.amount(),null,h.date(),asOf));
        checkSize(hypothetical);
        Forecast scenario=calculate(asOf,end,actual,threshold,hypothetical);
        return new Comparison(baseline,scenario,new BigDecimal(scenario.summary().projectedBalance()).subtract(new BigDecimal(baseline.summary().projectedBalance())).toPlainString());
    }
    private Event event(String id,String source,UUID sourceId,String description,TransactionType type,BigDecimal amount,String category,LocalDate scheduled,LocalDate asOf) {
        return new Event(id,source,sourceId,description,type,amount.toPlainString(),category,scheduled,scheduled.isBefore(asOf)?asOf:scheduled,scheduled.isBefore(asOf));
    }
    private Forecast calculate(LocalDate asOf,LocalDate end,BigDecimal actual,BigDecimal threshold,List<Event> events) {
        Map<LocalDate,List<Event>> grouped=new TreeMap<>();
        for(var event:events)grouped.computeIfAbsent(event.effectiveDate(),d->new ArrayList<>()).add(event);
        List<Day> days=new ArrayList<>();List<Month> months=new ArrayList<>();List<Warning> warnings=new ArrayList<>();
        BigDecimal balance=actual,lowest=actual,income=BigDecimal.ZERO,expense=BigDecimal.ZERO;LocalDate lowestDate=asOf;
        if(actual.compareTo(threshold)<0||actual.signum()<0)warnings.add(warning(asOf,actual,"CURRENT",List.of()));
        BigDecimal monthStart=balance,monthIncome=BigDecimal.ZERO,monthExpense=BigDecimal.ZERO;LocalDate monthFrom=asOf;
        for(LocalDate date=asOf;!date.isAfter(end);date=date.plusDays(1)) {
            List<Event> entries=grouped.getOrDefault(date,List.of()).stream().sorted(Comparator.comparing(Event::source).thenComparing(Event::id)).toList();
            BigDecimal in=total(entries,TransactionType.INCOME,null),out=total(entries,TransactionType.EXPENSE,null),before=balance;
            balance=balance.add(in).subtract(out);income=income.add(in);expense=expense.add(out);monthIncome=monthIncome.add(in);monthExpense=monthExpense.add(out);
            days.add(new Day(date,m(before),m(in),m(out),m(in.subtract(out)),m(balance),entries));
            if(balance.compareTo(lowest)<0){lowest=balance;lowestDate=date;}
            if((balance.compareTo(threshold)<0||balance.signum()<0)&&!(date.equals(asOf)&&balance.compareTo(actual)==0))
                warnings.add(warning(date,balance,"PROJECTED",entries.stream().filter(e->e.type()==TransactionType.EXPENSE).toList()));
            if(date.equals(end)||!YearMonth.from(date.plusDays(1)).equals(YearMonth.from(date))) {
                months.add(new Month(YearMonth.from(date).toString(),monthFrom,date,m(monthStart),m(monthIncome),m(monthExpense),m(monthIncome.subtract(monthExpense)),m(balance)));
                monthStart=balance;monthIncome=BigDecimal.ZERO;monthExpense=BigDecimal.ZERO;monthFrom=date.plusDays(1);
            }
        }
        Summary summary=new Summary(asOf,end,clock.getZone().toString(),m(actual),m(balance),m(income),m(expense),m(lowest),lowestDate,m(balance.subtract(actual)),
            m(total(events,TransactionType.INCOME,"RECURRING")),m(total(events,TransactionType.EXPENSE,"RECURRING")),
            m(total(events,TransactionType.INCOME,"PLANNED")),m(total(events,TransactionType.EXPENSE,"PLANNED")),
            m(total(events,TransactionType.INCOME,"HYPOTHETICAL")),m(total(events,TransactionType.EXPENSE,"HYPOTHETICAL")),
            (int)events.stream().filter(e->e.source().equals("RECURRING")&&e.overdue()).count(),(int)events.stream().filter(e->e.source().equals("PLANNED")&&e.overdue()).count());
        return new Forecast(summary,m(threshold),List.copyOf(days),List.copyOf(months),List.copyOf(warnings));
    }
    BigDecimal total(List<Event> events,TransactionType type,String source) {return events.stream().filter(e->e.type()==type&&(source==null||e.source().equals(source))).map(e->new BigDecimal(e.amount())).reduce(BigDecimal.ZERO,BigDecimal::add);}
    private Warning warning(LocalDate date,BigDecimal balance,String kind,List<Event> entries) {return new Warning(date,m(balance),balance.signum()<0?"NEGATIVE":"LOW",kind,entries);}
    private String m(BigDecimal amount){return amount.setScale(2).toPlainString();}
    private void checkSize(List<Event> events){if(events.size()>MAX_EVENTS)throw bad("Too many occurrences. Shorten the horizon or process pending recurring dates");}
    private ResponseStatusException bad(String text){return new ResponseStatusException(HttpStatus.BAD_REQUEST,text);}
}
