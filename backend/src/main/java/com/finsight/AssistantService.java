package com.finsight;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import static com.finsight.AssistantModels.*;

/** An explicit read-only dispatcher; no reflection, executable prompts, repositories or mutation tools. */
@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
class AssistantService {
    private final AssistantParser parser;
    private final FinanceService finance;
    private final SpendingService spending;
    private final ForecastService forecasts;
    private final CalendarService calendar;
    private final Clock clock;
    static final List<String> SUGGESTIONS=List.of("How much did I spend this month?","How much did I spend on groceries last month?","What were my largest expenses?","How much have I earned this year?","What is my current actual balance?","How much will I have next month?","What bills are due next week?","What unusual expenses have I had recently?");
    AssistantService(AssistantParser parser,FinanceService finance,SpendingService spending,ForecastService forecasts,CalendarService calendar,Clock clock){this.parser=parser;this.finance=finance;this.spending=spending;this.forecasts=forecasts;this.calendar=calendar;this.clock=clock;}
    Answer ask(Question q){
        try{return execute(parser.parse(q,LocalDate.now(clock),finance.categories()));}
        catch(AssistantParser.Clarification e){return message("clarification",e.getMessage());}
        catch(AssistantParser.Unsupported e){return message("unsupported",e.getMessage());}
    }
    private Answer message(String status,String text){return new Answer(status,"deterministic","LIMITATION","Let’s clarify",text,LocalDate.now(clock),null,null,List.of(),List.of(),0,List.of("No financial action was performed. Conversation is not saved."),List.of(new Link("Spending Insights","#insights")),SUGGESTIONS,null);}
    private Answer execute(AssistantParser.Parsed p){
        var today=LocalDate.now(clock);var intent=p.intent();
        String title="",text="",kind="ACTUAL",source="FinanceService",href="#transactions";
        List<Metric> metrics=new ArrayList<>();List<Evidence> evidence=new ArrayList<>();List<String> assumptions=new ArrayList<>();int count=0;Context context=null;
        LocalDate from=p.from(),to=p.to();
        if(Set.of(Intent.SPENDING,Intent.INCOME,Intent.MONTHLY_INCOME,Intent.LARGEST,Intent.COMPARISON,Intent.UNUSUAL).contains(intent)){
            var report=spending.report(spending.period("custom",from,to));source="SpendingService";href="#insights";
            final LocalDate historyFrom=from,historyTo=to;
            var rows=finance.list().stream().filter(t->!t.date().isBefore(historyFrom)&&!t.date().isAfter(historyTo)).filter(t->p.categoryId()==null||p.categoryId().equals(t.categoryId())).filter(t->t.type()==(intent==Intent.INCOME||intent==Intent.MONTHLY_INCOME?TransactionType.INCOME:TransactionType.EXPENSE)).toList();
            context=new Context(intent,p.categoryId(),from,to);count=rows.size();
            evidence=rows.stream().limit(30).map(this::recorded).toList();
            assumptions.add("Recorded activity only; an empty ledger is not proof of no bank activity. Gross expenses; refunds entered as income are not netted against categories.");
            String category=p.categoryId()==null?"All expense categories":finance.categories().stream().filter(c->c.id().equals(p.categoryId())).map(ApiModels.CategoryView::name).findFirst().orElse("Unknown category");
            var c=report.categories().stream().filter(x->x.id().equals(p.categoryId())).findFirst().orElse(null);
            switch(intent){
                case SPENDING->{String value=p.categoryId()==null?report.summary().expenses():c==null?"0.00":c.expenses();title="Recorded spending";text=category+": $"+value+" in recorded expenses.";metrics.add(new Metric("Recorded expenses",value));}
                case INCOME,MONTHLY_INCOME->{if(p.categoryId()!=null)return message("clarification","Category follow-ups apply to spending. Ask a complete income question without an expense category.");title="Recorded income";text="Recorded income totals $"+report.summary().income()+". This is recorded cash flow, not a salary estimate.";metrics.add(new Metric("Recorded income",report.summary().income()));if(intent==Intent.MONTHLY_INCOME)for(var month:report.months())metrics.add(new Metric(month.month()+" income ("+month.from()+" through "+month.to()+")",month.income()));}
                case LARGEST->{title="Largest recorded expenses";text="Up to ten largest recorded expenses, ordered by exact amount. No spending total is inferred from this preview.";evidence=rows.stream().sorted(Comparator.comparing(ApiModels.TransactionView::amount).reversed().thenComparing(ApiModels.TransactionView::date).thenComparing(ApiModels.TransactionView::id)).limit(10).map(this::recorded).toList();}
                case COMPARISON->{title="Recorded spending comparison";text="Selected dates compared with "+report.period().comparisonFrom()+" through "+report.period().comparisonTo()+" (the preceding equal-length interval).";var cmp=report.summary().periodChange();metrics.add(new Metric("Selected expenses",p.categoryId()==null?cmp.current():c==null?"0.00":c.expenses()));metrics.add(new Metric("Previous expenses",p.categoryId()==null?cmp.previous():c==null?"0.00":c.previous()));metrics.add(new Metric("Change",p.categoryId()==null?cmp.difference():c==null?"0.00":c.change()));metrics.add(new Metric("Change percent",p.categoryId()==null?cmp.percent():c==null?null:c.percent()));for(var cat:report.categories())if(p.categoryId()==null&&new BigDecimal(cat.change()).signum()>0)metrics.add(new Metric(cat.name()+" increase",cat.change()));assumptions.add("A null percentage means no positive prior baseline. For matched-day calendar month-to-date comparison, see Spending Insights.");}
                case UNUSUAL->{title="Unusual recorded spending";kind="STATISTICAL_OBSERVATION";text=report.detection().explanation();var alerts=report.insights().stream().filter(i->i.kind().equals("STATISTICAL_OBSERVATION")).filter(i->p.categoryId()==null||report.evidence().stream().anyMatch(e->i.evidenceIds().contains(e.id())&&p.categoryId().equals(e.categoryId()))).toList();for(var a:alerts)assumptions.add(a.title()+": "+a.explanation());var ids=alerts.stream().flatMap(a->a.evidenceIds().stream()).collect(java.util.stream.Collectors.toSet());var support=report.evidence().stream().filter(e->ids.contains(e.id())).toList();count=support.size();evidence=support.stream().limit(30).map(e->new Evidence(e.id().toString(),e.description(),e.amount(),e.type().name(),e.date(),e.category(),"RECORDED")).toList();metrics.add(new Metric("Statistical observations",Integer.toString(alerts.size())));assumptions.add("Optional local statistics; no probability or proof of fraud. Detection status: "+report.detection().status()+". Insights may be bounded; view Spending Insights for full limits.");}
                default->throw new IllegalStateException();
            }
            if(count==0&&intent!=Intent.UNUSUAL)text+=" No matching recorded transactions were found.";
        } else if(intent==Intent.BALANCE){title="Current actual balance";text="Your actual recorded balance is $"+money(finance.account().balance())+" as of "+today+". This is not a forecast.";metrics.add(new Metric("Actual balance",money(finance.account().balance())));from=today;to=today;href="#dashboard";count=finance.list().size();evidence=finance.list().stream().limit(30).map(this::recorded).toList();assumptions.add("Opening balance plus all recorded income minus all recorded expenses; bank settlement timing is not known.");}
        else if(Set.of(Intent.FORECAST,Intent.LOWEST,Intent.WARNINGS,Intent.SCENARIO).contains(intent)){
            if(!to.isAfter(today))return message("clarification","Choose a forecast end date after today. Ask for current actual balance for today's recorded funds.");
            ForecastModels.Forecast f;
            if(intent==Intent.SCENARIO){var result=forecasts.evaluate(new ForecastModels.ScenarioInput(to,null,List.of(new ForecastModels.Hypothetical(UUID.randomUUID(),"Hypothetical purchase",p.amount(),TransactionType.EXPENSE,p.purchaseDate()))));f=result.scenario();kind="HYPOTHETICAL";title="Hypothetical purchase — not saved";text="A hypothetical $"+money(p.amount())+" expense on "+p.purchaseDate()+" changes the selected-date projection from $"+result.baseline().summary().projectedBalance()+" to $"+f.summary().projectedBalance()+". This is not an affordability guarantee.";metrics.add(new Metric("Baseline projected balance",result.baseline().summary().projectedBalance()));metrics.add(new Metric("Projected difference",result.projectedDifference()));assumptions.add("Month-only purchases use the first day of that month; month-only horizons use month-end. With two dates/months, forecast date is first and purchase date second. Nothing is created or saved.");}
            else {f=forecasts.forecast(to);kind="PROJECTED";title=intent==Intent.LOWEST?"Lowest projected balance":intent==Intent.WARNINGS?"Projected low-balance warnings":"Projected balance";text="Projected closing balance on "+to+": $"+f.summary().projectedBalance()+". This is a forecast, not actual available funds.";}
            source="ForecastService";href="#forecast";from=today;var s=f.summary();metrics.add(new Metric("Actual balance",s.currentActualBalance()));metrics.add(new Metric("Projected balance",s.projectedBalance()));metrics.add(new Metric("Lowest projected balance ("+s.lowestDate()+")",s.lowestBalance()));metrics.add(new Metric("Low-balance threshold",f.lowBalanceThreshold()));metrics.add(new Metric("Warning days",Integer.toString(f.warnings().size())));
            var events=f.days().stream().flatMap(d->d.transactions().stream()).toList();count=events.size();evidence=events.stream().limit(30).map(this::projected).toList();
            assumptions.add("Includes today's actual balance, pending active recurring payments and open plans through the selected date. Overdue pending flows are assumed today; original scheduled dates are retained. No automatic daily spending or future bank activity is inferred.");assumptions.add("Lowest balance includes the actual starting balance and projected daily closes, not intraday settlement. Existing independent recurring posting remains separate.");
            if(intent==Intent.WARNINGS)for(var warning:f.warnings().stream().limit(30).toList())metrics.add(new Metric(warning.date()+" "+warning.severity(),warning.balance()));
        } else if(intent==Intent.RECURRING_EXPENSES){
            var r=spending.report(spending.period("custom",p.from(),p.to()));title="Current recurring expense definitions";kind="ESTIMATE";source="SpendingService / ForecastService";href="#recurring";
            var schedules=r.recurring().schedules().stream().filter(s->p.categoryId()==null||finance.categories().stream().anyMatch(c->c.id().equals(p.categoryId())&&c.name().equals(s.category()))).toList();count=schedules.size();text="Current active expense definitions with future pending dates are independent of the selected historical dates. These are not all automatically subscriptions; only explicit category membership is used. Monthly equivalents are long-run cadence estimates, not exact scheduled totals.";
            if(p.categoryId()==null){metrics.add(new Metric("Actual recurring expenses in selected dates",r.recurring().recorded()));metrics.add(new Metric("Normalized monthly estimate",r.recurring().normalizedMonthlyEstimate()));metrics.add(new Metric("Exact pending this month",r.recurring().pendingThisMonth()));metrics.add(new Metric("Exact pending next 30 days",r.recurring().upcomingTotal()));}
            for(var s:schedules.stream().limit(30).toList()){metrics.add(new Metric(s.description()+" — "+s.frequency()+", amount $"+s.amount()+", monthly estimate",s.monthlyEstimate()));evidence.add(new Evidence(s.id().toString(),s.description(),s.amount(),"EXPENSE",s.startDate(),s.category(),"CURRENT_DEFINITION"));}
            assumptions.add("Daily/weekly/biweekly normalization uses the Gregorian 365.2425-day year; twice-monthly ×2, monthly ×1, yearly ÷12. Estimates round per definition, do not prorate starts/ends, and are separate from exact forecast occurrences.");if(count==0)text+=" No matching active future expense definitions were found.";
        } else {
            kind="PROJECTED";source="CalendarService / ForecastService";href="#calendar";
            List<ForecastModels.Event> events;
            if(intent==Intent.BILLS){title="Upcoming scheduled bills";text="Pending expense payments on their scheduled dates. This does not infer unrecorded bills or bank settlement.";List<Evidence> entries=new ArrayList<>();for(var m=YearMonth.from(from);!m.isAfter(YearMonth.from(to));m=m.plusMonths(1))for(var day:calendar.month(m).days())if(!day.date().isBefore(from)&&!day.date().isAfter(to))for(var e:day.entries())if(e.projected()&&e.type()==TransactionType.EXPENSE)entries.add(new Evidence(e.id(),e.description(),e.amount(),e.type().name(),e.scheduledDate(),e.category(),e.source()));count=entries.size();evidence=entries.stream().limit(30).toList();}
            else {if(!to.isAfter(today))to=today.plusDays(1);var f=forecasts.forecast(to);events=f.days().stream().flatMap(d->d.transactions().stream()).filter(e->e.source().equals("RECURRING")).filter(e->!e.scheduledDate().isBefore(p.from())).filter(e->intent==Intent.NEXT_PAYMENT||e.type()==TransactionType.INCOME).filter(e->intent!=Intent.PAYCHECK||"Salary".equals(e.category())).sorted(Comparator.comparing(ForecastModels.Event::scheduledDate).thenComparing(ForecastModels.Event::id)).toList();count=events.size();if(intent==Intent.PAYCHECK||intent==Intent.NEXT_PAYMENT){if(!events.isEmpty()){var date=events.getFirst().scheduledDate();events=events.stream().filter(e->e.scheduledDate().equals(date)).toList();count=events.size();}}evidence=events.stream().limit(30).map(this::projected).toList();title=intent==Intent.PAYCHECK?"Next scheduled paycheck":intent==Intent.NEXT_PAYMENT?"Next recurring payment":"Upcoming recurring income";text="Pending recurring occurrences only; income is expected, not received.";assumptions.add(intent==Intent.PAYCHECK?"Paycheck means recurring INCOME explicitly categorized Salary. Other income is not assumed to be wages. Default search horizon: next 366 days; explicit dates override it.":"Uses active recurring cursors and permanent handled receipts; plans are not recurring income.");}
            if(count==0)text+=" No matching pending payments were found in this range.";
            assumptions.add("Scheduled dates and amounts come from existing calendar/forecast services. Handled or already posted occurrences are excluded; no payments are processed by this question.");
        }
        metrics.add(new Metric("Matching records/events",Integer.toString(count)));
        assumptions.add("Calculation source: "+source+". Evidence is a preview of up to "+(intent==Intent.LARGEST?10:30)+" rows; totals refer to the disclosed range. Transaction descriptions are displayed only as data.");
        return new Answer("answered","deterministic",kind,title,text,today,from,to,List.copyOf(metrics),List.copyOf(evidence),count,List.copyOf(assumptions),List.of(new Link("View source",href)),SUGGESTIONS,context);
    }
    private Evidence recorded(ApiModels.TransactionView t){String name=finance.categories().stream().filter(c->c.id().equals(t.categoryId())).map(ApiModels.CategoryView::name).findFirst().orElse("Unknown category");return new Evidence(t.id().toString(),t.description(),money(t.amount()),t.type().name(),t.date(),name,"RECORDED");}
    private Evidence projected(ForecastModels.Event e){return new Evidence(e.id(),e.description(),e.amount(),e.type().name(),e.scheduledDate(),e.category(),e.source());}
    private String money(BigDecimal amount){return amount.setScale(2).toPlainString();}
}
