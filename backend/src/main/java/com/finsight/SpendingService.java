package com.finsight;

import java.math.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import static com.finsight.SpendingModels.*;
import com.finsight.SpendingModels.Category;
import com.finsight.SpendingModels.Period;
import com.finsight.ApiModels.TransactionView;

/** Facts and all displayed numbers come from the owned posted ledger, never generated text or predictions. */
@Service @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
class SpendingService {
    private final FinanceService finance;
    private final RecurringRuleRepository rules;
    private final ForecastService forecasts;
    private final SpendingAiClient ai;
    private final Clock clock;
    private static final BigDecimal ZERO=new BigDecimal("0.00");
    SpendingService(FinanceService finance,RecurringRuleRepository rules,ForecastService forecasts,SpendingAiClient ai,Clock clock){this.finance=finance;this.rules=rules;this.forecasts=forecasts;this.ai=ai;this.clock=clock;}
    Period period(String range,LocalDate from,LocalDate to) {
        LocalDate today=LocalDate.now(clock);String selected=range==null?"this_month":range;
        if(selected.equals("custom")) {if(from==null||to==null)throw bad("Choose both custom dates");}
        else {
            if(from!=null||to!=null)throw bad("Custom dates require range=custom");
            to=today;
            switch(selected){
                case "this_month" -> from=today.withDayOfMonth(1);
                case "last_month" -> {var m=YearMonth.from(today).minusMonths(1);from=m.atDay(1);to=m.atEndOfMonth();}
                case "last_3" -> from=today.minusMonths(2).withDayOfMonth(1);
                case "last_6" -> from=today.minusMonths(5).withDayOfMonth(1);
                case "last_12" -> from=today.minusMonths(11).withDayOfMonth(1);
                default -> throw bad("Choose a supported date range");
            }
        }
        if(from.isBefore(LocalDate.of(1900,1,1))||to.isAfter(today)||to.isBefore(from)||ChronoUnit.DAYS.between(from,to)>1830)throw bad("Choose ordered historical dates from 1900 through today, at most 1831 days");
        LocalDate previousEnd=from.minusDays(1),previousStart=previousEnd.minusDays(ChronoUnit.DAYS.between(from,to));
        return new Period(from,to,previousStart,previousEnd,today);
    }
    Report report(Period p) {
        var all=finance.list().stream().filter(t->!t.date().isAfter(p.asOfDate())).toList();
        var categoryNames=finance.categories();Map<UUID,String> names=categoryNames.stream().collect(Collectors.toMap(ApiModels.CategoryView::id,ApiModels.CategoryView::name));
        var selected=between(all,p.from(),p.to());var expenses=type(selected,TransactionType.EXPENSE);
        var previous=between(all,p.comparisonFrom(),p.comparisonTo());
        BigDecimal spent=sum(expenses),income=sum(type(selected,TransactionType.INCOME));
        List<Category> categories=categoryTotals(expenses,type(previous,TransactionType.EXPENSE),names);
        var current=YearMonth.from(p.asOfDate());var prior=current.minusMonths(1);
        BigDecimal thisMonth=sum(type(between(all,current.atDay(1),p.asOfDate()),TransactionType.EXPENSE));
        BigDecimal priorMatched=sum(type(between(all,prior.atDay(1),prior.atDay(Math.min(p.asOfDate().getDayOfMonth(),prior.lengthOfMonth()))),TransactionType.EXPENSE));
        List<Monthly> averageMonths=new ArrayList<>();
        for(int i=3;i>=1;i--){var m=current.minusMonths(i);averageMonths.add(month(all,m.atDay(1),m.atEndOfMonth()));}
        boolean averageReady=averageMonths.stream().allMatch(m->m.count()>0&&new BigDecimal(m.expenses()).signum()>0);
        String average=averageReady?money(averageMonths.stream().map(m->new BigDecimal(m.expenses())).reduce(ZERO,BigDecimal::add).divide(new BigDecimal("3"),2,RoundingMode.HALF_UP)):null;
        Average avg=new Average(average,List.copyOf(averageMonths),averageReady?"Recorded expenses over the last three complete calendar months / 3; assumes the ledger is complete. Not a forecast.":"Insufficient recorded coverage: each of the last three complete calendar months needs recorded expenses. Empty history is not assumed complete.");
        BigDecimal recordedRecurring=sum(expenses.stream().filter(t->t.recurringRuleId()!=null).toList());
        var recurring=recurring(all,expenses,names,p);
        var summary=new Summary(money(spent),money(income),money(income.subtract(spent)),money(thisMonth),comparison(thisMonth,priorMatched),avg,
            spent.signum()==0||categories.isEmpty()?null:categories.getFirst().name(),money(recordedRecurring),money(spent.subtract(recordedRecurring)),comparison(spent,sum(type(previous,TransactionType.EXPENSE))));
        List<Monthly> months=new ArrayList<>();
        for(var m=YearMonth.from(p.from());!m.isAfter(YearMonth.from(p.to()));m=m.plusMonths(1))months.add(month(all,max(m.atDay(1),p.from()),min(m.atEndOfMonth(),p.to())));
        List<Insight> insights=new ArrayList<>();
        if(spent.signum()>0&&!categories.isEmpty()) {
            var c=categories.getFirst();var rows=expenses.stream().filter(t->t.categoryId().equals(c.id())).toList();
            insights.add(insight("share-"+c.id(),"HISTORICAL_FACT","info",c.name()+" is the largest expense category",c.name()+" accounts for "+c.share()+"% of recorded spending in this range.",p.from(),p.to(),c.expenses(),c.share(),List.of(new Calculation("Category total",c.expenses()),new Calculation("All expenses",money(spent)),new Calculation("Share = category / all × 100",c.share()+"%")),rows));
        }
        if(averageReady) insights.add(insight("average","HISTORICAL_FACT","info","Three complete months of recorded spending","Recorded average monthly expenses: $"+average+". This describes recorded history, not guaranteed complete bank activity.",averageMonths.getFirst().from(),averageMonths.getLast().to(),average,null,
            averageMonths.stream().map(m->new Calculation(m.month()+" expenses",m.expenses())).toList(),type(between(all,averageMonths.getFirst().from(),averageMonths.getLast().to()),TransactionType.EXPENSE)));
        if(income.signum()==0&&spent.signum()>0) insights.add(insight("no-income","HISTORICAL_FACT","attention","No income recorded in this range","Recorded expenses total $"+money(spent)+"; no income is recorded for these dates. This does not infer your bank income or a missing paycheck.",p.from(),p.to(),money(spent),null,List.of(new Calculation("Recorded income","0.00"),new Calculation("Recorded net cash flow",money(income.subtract(spent)))),expenses));
        for(var c:categories)if(new BigDecimal(c.previous()).signum()>0&&new BigDecimal(c.change()).compareTo(new BigDecimal("50"))>=0&&new BigDecimal(c.percent()).compareTo(new BigDecimal("30"))>=0) {
            var supporting=type(between(all,p.comparisonFrom(),p.to()),TransactionType.EXPENSE).stream().filter(t->t.categoryId().equals(c.id())).toList();
            insights.add(insight("review-category-"+c.id(),"RECOMMENDATION","attention","Review the increase in "+c.name(),"Recorded spending rose "+c.percent()+"% ($"+c.change()+") versus the preceding equal-length period. Review the transactions to decide whether this was intentional; necessity is not inferred.",p.comparisonFrom(),p.to(),c.change(),c.percent(),List.of(new Calculation("Selected-period expenses",c.expenses()),new Calculation("Previous equal-length expenses",c.previous()),new Calculation("Change / previous × 100",c.percent()+"%")),supporting));
        }
        monthlyObservations(all,months,names,insights,p);
        for(var change:recurring.changes())if(new BigDecimal(change.current()).compareTo(new BigDecimal(change.previous()))>0) {
            var rows=all.stream().filter(t->t.id().equals(change.previousId())||t.id().equals(change.currentId())).toList();
            insights.add(insight("recurring-change-"+change.ruleId(),"RECOMMENDATION","attention","Review a recurring payment increase","The latest recorded payment is $"+change.current()+" versus $"+change.previous()+" previously ("+change.percent()+"%). Edits, partial payments, refunds recorded separately, or manual corrections may explain this; no historical schedule price is assumed.",rows.stream().map(TransactionView::date).min(LocalDate::compareTo).orElse(change.date()),change.date(),change.current(),change.percent(),List.of(new Calculation("Previous recorded payment",change.previous()),new Calculation("Latest recorded payment",change.current())),rows));
        }
        Detection detection=detect(all,p,insights,names);
        if(insights.size()>50)detection=new Detection(detection.status(),detection.methodVersion(),detection.eligible(),detection.insufficient(),true,detection.explanation()+" Insight feed capped at 50; narrow dates for additional items.");
        insights=insights.stream().sorted(Comparator.comparingInt((Insight i)->i.severity().equals("warning")?0:i.kind().equals("HISTORICAL_FACT")?1:2).thenComparing(Insight::to,Comparator.reverseOrder())).limit(50).toList();
        Set<UUID> ids=insights.stream().flatMap(i->i.evidenceIds().stream()).collect(Collectors.toSet());
        var evidence=all.stream().filter(t->ids.contains(t.id())).sorted(order().reversed()).map(t->evidence(t,names)).toList();
        return new Report(p,summary,categories,List.copyOf(months),recurring,detection,insights,evidence,categoryNames,List.of(
            "Gross recorded expenses only. Refunds are ordinary income in the current schema and are not inferred or netted against categories. Corrections/edit/deletion affect the current ledger immediately.",
            "Empty periods mean no recorded activity, not proof of complete bank coverage. Monthly trends label partial periods; previous range comparisons use the same number of calendar days.",
            "Statistical alerts are review prompts, not fraud probabilities. No model is trained on personal records and no analysis results are persisted.",
            "Current active recurring monthly equivalents are steady-cadence estimates, independent of the historical filter; exact pending dates come from Balance Forecast.",
            "All amounts and percentages are calculated with precise decimals in Java; chart numbers are display-only. Evidence previews show at most 100 records per card."));
    }
    private Recurring recurring(List<TransactionView> all,List<TransactionView> expenses,Map<UUID,String> names,Period p) {
        List<RecurringItem> active=new ArrayList<>();
        for(var r:rules.findByUserIdAndAccountIdOrderByCreatedAtDesc(CurrentIdentity.userId(),CurrentIdentity.accountId())) {
            if(!r.enabled||r.archived||r.nextDate==null||r.type!=TransactionType.EXPENSE||(r.endDate!=null&&r.endDate.isBefore(p.asOfDate())))continue;
            active.add(new RecurringItem(r.id,r.description,names.getOrDefault(r.categoryId,"Unknown category"),money(r.amount),r.frequency.name(),money(normalize(r.amount,r.frequency)),r.startDate,r.endDate));
        }
        active.sort(Comparator.comparing((RecurringItem r)->new BigDecimal(r.monthlyEstimate())).reversed().thenComparing(RecurringItem::description));
        BigDecimal estimate=active.stream().map(r->new BigDecimal(r.monthlyEstimate())).reduce(ZERO,BigDecimal::add);
        LocalDate through=p.asOfDate().plusDays(30),monthEnd=YearMonth.from(p.asOfDate()).atEndOfMonth();
        var forecast=forecasts.forecast(max(through,monthEnd));
        var future=forecast.days().stream().flatMap(d->d.transactions().stream()).filter(e->e.source().equals("RECURRING")&&e.type()==TransactionType.EXPENSE).toList();
        var upcoming=future.stream().filter(e->!e.effectiveDate().isAfter(through)).toList();
        BigDecimal pending=future.stream().filter(e->!e.effectiveDate().isAfter(monthEnd)).map(e->new BigDecimal(e.amount())).reduce(ZERO,BigDecimal::add);
        Map<String,BigDecimal> byCategory=new TreeMap<>();for(var r:active)byCategory.merge(r.category(),new BigDecimal(r.monthlyEstimate()),BigDecimal::add);
        List<Category> categoryEstimate=byCategory.entrySet().stream().map(e->new Category(null,e.getKey(),money(e.getValue()),"0.00","0.00",null,percent(e.getValue(),estimate),0)).toList();
        Map<UUID,List<TransactionView>> groups=all.stream().filter(t->t.type()==TransactionType.EXPENSE&&t.recurringRuleId()!=null&&!t.date().isAfter(p.to())).collect(Collectors.groupingBy(TransactionView::recurringRuleId));
        List<RecurringChange> changes=new ArrayList<>();
        for(var group:groups.entrySet()) {
            var rows=group.getValue().stream().sorted(order()).toList();if(rows.size()<2)continue;
            var latest=rows.getLast();var previous=rows.get(rows.size()-2);
            if(latest.date().isBefore(p.from())||latest.amount().compareTo(previous.amount())==0)continue;
            changes.add(new RecurringChange(group.getKey(),previous.id(),latest.id(),money(previous.amount()),money(latest.amount()),percent(latest.amount().subtract(previous.amount()),previous.amount()),latest.date()));
        }
        changes.sort(Comparator.comparing(RecurringChange::date).reversed());
        return new Recurring(money(sum(expenses.stream().filter(t->t.recurringRuleId()!=null).toList())),money(estimate),money(pending),money(upcoming.stream().map(e->new BigDecimal(e.amount())).reduce(ZERO,BigDecimal::add)),through,List.copyOf(active),upcoming.stream().limit(100).toList(),categoryEstimate,List.copyOf(changes));
    }
    static BigDecimal normalize(BigDecimal amount,RecurrenceFrequency frequency) {
        BigDecimal annualDays=new BigDecimal("365.2425");
        BigDecimal factor=switch(frequency){case DAILY->annualDays.divide(new BigDecimal("12"),12,RoundingMode.HALF_UP);case WEEKLY->annualDays.divide(new BigDecimal("84"),12,RoundingMode.HALF_UP);case BIWEEKLY->annualDays.divide(new BigDecimal("168"),12,RoundingMode.HALF_UP);case TWICE_MONTHLY->new BigDecimal("2");case MONTHLY->BigDecimal.ONE;case YEARLY->BigDecimal.ONE.divide(new BigDecimal("12"),12,RoundingMode.HALF_UP);};
        return amount.multiply(factor).setScale(2,RoundingMode.HALF_UP);
    }
    private void monthlyObservations(List<TransactionView> all,List<Monthly> months,Map<UUID,String> names,List<Insight> insights,Period p) {
        for(var month:months) {
            if(month.partial()||!YearMonth.parse(month.month()).isBefore(YearMonth.from(p.asOfDate())))continue;
            YearMonth m=YearMonth.parse(month.month());
            for(UUID category:Stream.concat(Stream.of((UUID)null),all.stream().filter(t->t.type()==TransactionType.EXPENSE).map(TransactionView::categoryId).distinct()).toList()) {
                List<BigDecimal> baseline=new ArrayList<>();
                for(int i=3;i>=1;i--){var prev=m.minusMonths(i);baseline.add(sum(type(between(all,prev.atDay(1),prev.atEndOfMonth()),TransactionType.EXPENSE).stream().filter(t->category==null||category.equals(t.categoryId())).toList()));}
                if(baseline.stream().anyMatch(v->v.signum()==0))continue;
                var rows=type(between(all,m.atDay(1),m.atEndOfMonth()),TransactionType.EXPENSE).stream().filter(t->category==null||category.equals(t.categoryId())).toList();
                BigDecimal actual=sum(rows),med=median(baseline),threshold=med.multiply(new BigDecimal(category==null?"1.30":"1.50")).max(med.add(new BigDecimal("100"))).setScale(2,RoundingMode.CEILING);
                if(actual.compareTo(threshold)<=0)continue;
                var support=type(between(all,m.minusMonths(3).atDay(1),m.atEndOfMonth()),TransactionType.EXPENSE).stream().filter(t->category==null||category.equals(t.categoryId())).toList();
                String label=category==null?"All spending":names.getOrDefault(category,"Unknown category");
                List<Calculation> calculations=new ArrayList<>();for(int i=0;i<3;i++)calculations.add(new Calculation(m.minusMonths(3-i).toString(),money(baseline.get(i))));calculations.add(new Calculation("Three-month median",money(med)));calculations.add(new Calculation("Conservative review threshold",money(threshold)));calculations.add(new Calculation("Recorded month expenses",money(actual)));
                insights.add(insight("monthly-"+month.month()+"-"+category,"STATISTICAL_OBSERVATION","attention",label+" exceeded its recent monthly baseline",label+" in "+month.month()+" totaled $"+money(actual)+", above the $"+money(threshold)+" review threshold. Three prior completed months had recorded expenses. Uneven/seasonal spending can explain this observation.",m.minusMonths(3).atDay(1),m.atEndOfMonth(),money(actual),percent(actual.subtract(med),med),List.copyOf(calculations),support));
            }
        }
    }
    private Detection detect(List<TransactionView> all,Period p,List<Insight> insights,Map<UUID,String> names) {
        var pool=type(between(all,p.from().minusDays(180),p.to()),TransactionType.EXPENSE).stream().sorted(order()).toList();
        int eligible=0,insufficient=0;
        for(var t:pool)if(!t.date().isBefore(p.from())){if(baseline(pool,t,"CATEGORY_MAD").size()>=8||(t.recurringRuleId()!=null&&baseline(pool,t,"RECURRING_MAD").size()>=8))eligible++;else insufficient++;}
        if(eligible==0)return new Detection("insufficient","robust-mad-v1",0,insufficient,false,"At least 8 strictly earlier expenses in the same category or schedule within 180 days are required. No unreliable transaction alerts are invented.");
        if(pool.size()>5000||pool.stream().anyMatch(t->t.amount().movePointRight(2).compareTo(new BigDecimal("99999999999999"))>0))return new Detection("limited","robust-mad-v1",eligible,insufficient,true,"Local scan limits exceeded (5000 expenses or supported cents range). Narrow the dates. Deterministic totals still include every owned record.");
        var features=pool.stream().map(t->new SpendingAiClient.Feature(t.id(),t.date(),t.amount().movePointRight(2).longValueExact(),t.categoryId(),t.recurringRuleId())).toList();
        var result=ai.analyze(new SpendingAiClient.Input(p.from(),p.to(),features));
        if(result.isEmpty())return unavailable(eligible,insufficient);
        var r=result.get();if(r.eligible()!=eligible||r.insufficient()!=insufficient)return unavailable(eligible,insufficient);
        Map<UUID,TransactionView> index=pool.stream().collect(Collectors.toMap(TransactionView::id,t->t));Map<UUID,SpendingAiClient.Signal> unique=new LinkedHashMap<>();
        for(var signal:r.alerts()) {
            if(signal==null||signal.transactionId()==null||signal.method()==null||!Set.of("CATEGORY_MAD","RECURRING_MAD").contains(signal.method())||signal.baselineIds()==null||signal.baselineIds().size()>100)return unavailable(eligible,insufficient);
            var t=index.get(signal.transactionId());if(t==null||t.date().isBefore(p.from())||(signal.method().equals("RECURRING_MAD")&&t.recurringRuleId()==null))return unavailable(eligible,insufficient);
            var prior=baseline(pool,t,signal.method());
            if(prior.size()<8||!signal.baselineIds().equals(prior.stream().map(TransactionView::id).toList())||t.amount().compareTo(threshold(prior))<=0)return unavailable(eligible,insufficient);
            if(!unique.containsKey(t.id())||signal.method().equals("RECURRING_MAD"))unique.put(t.id(),signal);
        }
        for(var signal:unique.values()) {
            var t=index.get(signal.transactionId());var prior=baseline(pool,t,signal.method());BigDecimal med=median(prior.stream().map(TransactionView::amount).toList());
            List<TransactionView> support=new ArrayList<>(prior);support.add(t);
            insights.add(insight("unusual-"+t.id(),"STATISTICAL_OBSERVATION","warning","Review an unusually large "+(signal.method().equals("RECURRING_MAD")?"recurring payment":"expense"),"Recorded expense $"+money(t.amount())+" exceeds the $"+money(threshold(prior))+" robust review threshold. The median of "+prior.size()+" earlier "+(signal.method().equals("RECURRING_MAD")?"schedule payments":"category expenses")+" was $"+money(med)+". This is a statistical flag, not proof of an error or fraud.",prior.getFirst().date(),t.date(),money(t.amount()),null,List.of(new Calculation("Method",signal.method()+" / causal 180-day history"),new Calculation("Prior records",String.valueOf(prior.size())),new Calculation("Baseline median",money(med)),new Calculation("Review threshold",money(threshold(prior)))),support));
            if(Set.of("Shopping","Entertainment","Dining").contains(names.getOrDefault(t.categoryId(),"Unknown category")))insights.add(insight("optional-"+t.id(),"RECOMMENDATION","attention","Review whether this purchase was optional","This flagged $"+money(t.amount())+" "+names.get(t.categoryId())+" expense may be worth reviewing against your priorities. The application cannot determine whether it was necessary.",t.date(),t.date(),money(t.amount()),null,List.of(new Calculation("Recorded expense",money(t.amount()))),List.of(t)));
        }
        return new Detection("available",r.version(),eligible,insufficient,r.truncated(),"Causal robust MAD thresholds, at most 100 earlier records within 180 days; minimum 8. No training or financial writes. Alerts are not probabilities or real-world accuracy guarantees.");
    }
    private Detection unavailable(int eligible,int insufficient){return new Detection("unavailable","robust-mad-v1",eligible,insufficient,false,"Local statistical service unavailable or its evidence failed validation. Deterministic facts/charts remain available; no transaction alerts are invented.");}
    private List<TransactionView> baseline(List<TransactionView> pool,TransactionView target,String method){
        var rows=pool.stream().filter(t->t.date().isBefore(target.date())&&!t.date().isBefore(target.date().minusDays(180)))
            .filter(t->method.equals("CATEGORY_MAD")?t.categoryId().equals(target.categoryId()):target.recurringRuleId()!=null&&target.recurringRuleId().equals(t.recurringRuleId())).sorted(order()).toList();
        return rows.subList(Math.max(0,rows.size()-100),rows.size());
    }
    static BigDecimal threshold(List<TransactionView> prior) {
        BigDecimal med=median(prior.stream().map(TransactionView::amount).toList());BigDecimal mad=median(prior.stream().map(t->t.amount().subtract(med).abs()).toList());
        return med.add(med.divide(new BigDecimal("2")).max(new BigDecimal("50"))).max(med.add(mad.multiply(new BigDecimal("6")).divide(new BigDecimal("0.67448975"),12,RoundingMode.HALF_UP))).setScale(2,RoundingMode.CEILING);
    }
    static BigDecimal median(List<BigDecimal> values){var v=values.stream().sorted().toList();int n=v.size();return n%2==1?v.get(n/2):v.get(n/2-1).add(v.get(n/2)).divide(new BigDecimal("2"));}
    EvidencePage transactions(Period p,UUID category){var names=finance.categories().stream().collect(Collectors.toMap(ApiModels.CategoryView::id,ApiModels.CategoryView::name));var rows=between(finance.list(),p.from(),p.to()).stream().filter(t->t.type()==TransactionType.EXPENSE&&(category==null||category.equals(t.categoryId()))).sorted(order().reversed()).toList();return new EvidencePage(rows.stream().limit(200).map(t->evidence(t,names)).toList(),rows.size(),rows.size()>200);}
    private Evidence evidence(TransactionView t,Map<UUID,String> names){return new Evidence(t.id(),t.description(),money(t.amount()),t.type(),t.categoryId(),names.getOrDefault(t.categoryId(),"Unknown category"),t.date(),t.recurringRuleId());}
    private Insight insight(String id,String kind,String severity,String title,String explanation,LocalDate from,LocalDate to,String amount,String percentage,List<Calculation> calc,List<TransactionView> rows){return new Insight(id,kind,severity,title,explanation,from,to,amount,percentage,List.copyOf(calc),rows.stream().sorted(order().reversed()).map(TransactionView::id).limit(100).toList(),rows.size());}
    private List<Category> categoryTotals(List<TransactionView> current,List<TransactionView> previous,Map<UUID,String> names){Set<UUID> ids=Stream.concat(current.stream(),previous.stream()).map(TransactionView::categoryId).collect(Collectors.toSet());BigDecimal total=sum(current);return ids.stream().map(id->{var rows=current.stream().filter(t->t.categoryId().equals(id)).toList();BigDecimal value=sum(rows),old=sum(previous.stream().filter(t->t.categoryId().equals(id)).toList());return new Category(id,names.getOrDefault(id,"Unknown category"),money(value),money(old),money(value.subtract(old)),percent(value.subtract(old),old),percent(value,total),rows.size());}).sorted(Comparator.comparing((Category c)->new BigDecimal(c.expenses())).reversed().thenComparing(Category::name)).toList();}
    private Monthly month(List<TransactionView> all,LocalDate from,LocalDate to){var rows=between(all,from,to);BigDecimal income=sum(type(rows,TransactionType.INCOME)),expense=sum(type(rows,TransactionType.EXPENSE));return new Monthly(YearMonth.from(from).toString(),from,to,money(income),money(expense),money(income.subtract(expense)),rows.size(),from.getDayOfMonth()!=1||to.getDayOfMonth()!=YearMonth.from(to).lengthOfMonth());}
    private Comparison comparison(BigDecimal current,BigDecimal previous){return new Comparison(money(current),money(previous),money(current.subtract(previous)),percent(current.subtract(previous),previous));}
    private static List<TransactionView> between(List<TransactionView> rows,LocalDate from,LocalDate to){return rows.stream().filter(t->!t.date().isBefore(from)&&!t.date().isAfter(to)).toList();}
    private static List<TransactionView> type(List<TransactionView> rows,TransactionType type){return rows.stream().filter(t->t.type()==type).toList();}
    private static BigDecimal sum(List<TransactionView> rows){return rows.stream().map(TransactionView::amount).reduce(ZERO,BigDecimal::add);}
    private static String money(BigDecimal amount){return amount.setScale(2,RoundingMode.HALF_UP).toPlainString();}
    private static String percent(BigDecimal part,BigDecimal total){return total.signum()==0?null:part.multiply(new BigDecimal("100")).divide(total,2,RoundingMode.HALF_UP).toPlainString();}
    private static Comparator<TransactionView> order(){return Comparator.comparing(TransactionView::date).thenComparing(t->t.id().toString());}
    private static LocalDate min(LocalDate a,LocalDate b){return a.isBefore(b)?a:b;}
    private static LocalDate max(LocalDate a,LocalDate b){return a.isAfter(b)?a:b;}
    private static ResponseStatusException bad(String message){return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
}
