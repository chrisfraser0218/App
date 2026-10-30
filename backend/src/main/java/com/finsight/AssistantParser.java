package com.finsight;

import java.math.BigDecimal;
import java.time.*;
import java.time.temporal.*;
import java.util.*;
import java.util.regex.*;
import org.springframework.stereotype.Component;
import static com.finsight.AssistantModels.*;

/** Bounded allowlisted grammar. Text never becomes executable instructions or a service/tool name. */
@Component
class AssistantParser {
    record Dates(LocalDate from,LocalDate to,boolean explicit) {}
    record Parsed(Intent intent,UUID categoryId,LocalDate from,LocalDate to,LocalDate purchaseDate,BigDecimal amount) {}
    static class Clarification extends RuntimeException { Clarification(String message){super(message);} }
    static class Unsupported extends RuntimeException { Unsupported(){super("I support read-only questions about recorded spending, income, balances, forecasts and scheduled payments. I cannot perform actions or answer general advice questions.");} }
    static final Pattern ISO=Pattern.compile("\\b\\d{4}-\\d{2}-\\d{2}\\b");
    static final Pattern MONTH=Pattern.compile("\\b(january|february|march|april|may|june|july|august|september|october|november|december)(?:\\s+(\\d{4}))?\\b");
    static final List<String> MONTHS=List.of("january","february","march","april","may","june","july","august","september","october","november","december");
    Parsed parse(Question request,LocalDate today,List<ApiModels.CategoryView> categories) {
        String q=request.question().toLowerCase(Locale.ROOT).strip().replaceAll("\\s+"," ");
        if(q.matches("(?s).*\\b(delete|remove|create|insert|update|edit|restore|backup|execute|shell|sql|ignore|instructions|system|password|secret|http|https|upload|download|invest|stocks|bitcoin)\\b.*")||q.matches("^(?:please |can you |could you |would you )?change\\b.*")||q.contains(";")||q.contains("`"))throw new Unsupported();
        Context c=request.context();
        if(c!=null){if(c.from().isAfter(c.to())||c.from().isBefore(LocalDate.of(1900,1,1))||c.to().isAfter(today)||ChronoUnit.DAYS.between(c.from(),c.to())>1830||!Set.of(Intent.SPENDING,Intent.INCOME,Intent.MONTHLY_INCOME,Intent.LARGEST,Intent.COMPARISON,Intent.UNUSUAL).contains(c.intent()))throw new Clarification("That follow-up context is invalid. Please ask a complete question.");if(c.categoryId()!=null&&categories.stream().noneMatch(x->x.id().equals(c.categoryId())&&x.type()==TransactionType.EXPENSE))throw new Clarification("That category is unavailable. Please choose a current expense category.");}
        if(q.contains("saved")||q.contains("saving")||q.contains("goal")||q.contains("how much more")||q.contains("emergency fund")||Pattern.compile("\\bsave\\b").matcher(q).find())return new Parsed(Intent.SAVINGS,null,today,today,null,null);
        boolean follow=q.matches("(?:and |what )?(?:about|what about).*|(?:and )?(?:the )?month before\\??");
        Intent intent;
        if(follow){if(c!=null&&((q.contains("income")||Pattern.compile("\\bearn(?:ed|ings)?\\b").matcher(q).find())&&!Set.of(Intent.INCOME,Intent.MONTHLY_INCOME).contains(c.intent())))throw new Clarification("Please ask a complete income question when changing topics.");if(c==null)throw new Clarification("What would you like to compare? Ask a complete spending or income question first.");intent=c.intent();}
        else if(q.contains("what if")||q.contains("what happens if")||q.contains("afford")||q.contains(" if i "))intent=Intent.SCENARIO;
        else if(q.contains("paycheck")||q.contains("pay cheque"))intent=Intent.PAYCHECK;
        else if(q.contains("next recurring payment")||q.contains("next payment"))intent=Intent.NEXT_PAYMENT;
        else if(Pattern.compile("\\bbills?\\b").matcher(q).find()||q.contains("payments due"))intent=Intent.BILLS;
        else if(q.contains("unusual")||q.contains("anomal"))intent=Intent.UNUSUAL;
        else if(q.contains("lowest")||q.contains("minimum balance"))intent=Intent.LOWEST;
        else if(q.contains("low-balance")||q.contains("low balance")||q.contains("warnings"))intent=Intent.WARNINGS;
        else if(q.contains("recurring")||q.contains("subscription"))intent=q.contains("income")?Intent.RECURRING_INCOME:Intent.RECURRING_EXPENSES;
        else if(q.contains("largest")||q.contains("biggest"))intent=Intent.LARGEST;
        else if(q.contains("compar")||q.contains("change")||q.contains("increased")||q.contains("month-over-month"))intent=Intent.COMPARISON;
        else if(q.contains("income")||Pattern.compile("\\bearn(?:ed|ings)?\\b").matcher(q).find()||q.contains("earned"))intent=q.contains("by month")||q.contains("monthly income")?Intent.MONTHLY_INCOME:Intent.INCOME;
        else if(q.contains("project")||q.contains("will i have")||q.contains("future balance"))intent=Intent.FORECAST;
        else if(q.contains("balance")&&(q.contains("current")||q.contains("actual")||q.contains("today")))intent=Intent.BALANCE;
        else if(q.contains("spend")||q.contains("spent")||q.contains("expenses"))intent=Intent.SPENDING;
        else throw new Unsupported();
        if(!follow && ((q.contains("spend")||q.contains("spent"))&&(Pattern.compile("\\bearn(?:ed|ings)?\\b").matcher(q).find()||q.contains("income"))&&!Set.of(Intent.SCENARIO,Intent.RECURRING_INCOME).contains(intent)))throw new Clarification("Please ask one financial question at a time: spending or income.");
        List<ApiModels.CategoryView> found=categories.stream().filter(x->x.type()==TransactionType.EXPENSE).filter(x->Pattern.compile("(?<![a-z])"+Pattern.quote(x.name().toLowerCase(Locale.ROOT))+"(?![a-z])").matcher(q).find()).toList();
        if(found.size()>1)throw new Clarification("Please choose one category at a time.");
        UUID category=found.isEmpty()?(follow?c.categoryId():null):found.getFirst().id();
        if(category==null && (q.contains("grocer")||q.contains("grocery")))category=categories.stream().filter(x->x.name().equalsIgnoreCase("Groceries")).map(ApiModels.CategoryView::id).findFirst().orElse(null);
        if(category==null&&Pattern.compile("\\b(?:on|for) (?:my )?[a-z]+(?: [a-z]+)?(?: last| this| in| from|\\?|$)").matcher(q).find()&&intent==Intent.SPENDING)throw new Clarification("I could not identify that expense category. Use a category name from your transaction form.");
        if(q.matches(".*\\b(?:today|tomorrow)\\b.*")&&(q.contains("next month")||q.contains("last month")))throw new Clarification("Please specify one date range.");
        boolean future=Set.of(Intent.FORECAST,Intent.LOWEST,Intent.WARNINGS,Intent.SCENARIO,Intent.BILLS,Intent.PAYCHECK,Intent.NEXT_PAYMENT,Intent.RECURRING_INCOME).contains(intent);
        Dates dates;
        try {dates=dates(q,today,future);}
        catch(DateTimeException|NumberFormatException e){throw new Clarification("Use valid dates in YYYY-MM-DD format, or a supported month/range.");}
        if(follow&&!dates.explicit()) {
            if(q.contains("month before")){if(!YearMonth.from(c.from()).equals(YearMonth.from(c.to())))throw new Clarification("The previous answer spans multiple months. Which month should I use?");YearMonth previous=YearMonth.from(c.from()).minusMonths(1);dates=new Dates(previous.atDay(1),previous.atEndOfMonth(),true);}
            else throw new Clarification("Which dates should I use for that follow-up?");
        }
        if(!dates.explicit()&&Set.of(Intent.PAYCHECK,Intent.NEXT_PAYMENT).contains(intent))dates=new Dates(today,today.plusDays(366),false);
        LocalDate from=dates.from(),to=dates.to(),purchase=null;BigDecimal amount=null;
        if(intent==Intent.SCENARIO){
            var amounts=Pattern.compile("(?:\\$\\s*|\\b(?:spend|purchase|buy)\\s+)([-+]?\\d[\\d,.]*)").matcher(q);List<BigDecimal> values=new ArrayList<>();while(amounts.find()){String token=amounts.group(1);if(!token.matches("(?:\\d+|\\d{1,3}(?:,\\d{3})+)(?:\\.\\d{1,2})?"))throw new Clarification("Use a valid positive amount with at most two decimal places.");values.add(new BigDecimal(token.replace(",","")));}
            if(values.size()!=1||values.getFirst().signum()<=0||values.getFirst().compareTo(new BigDecimal("999999999999.99"))>0)throw new Clarification("Specify one positive purchase amount with at most two decimal places, for example: What if I spend $1,000 on 2026-12-01?");
            amount=values.getFirst();var iso=ISO.matcher(q);List<LocalDate> ds=new ArrayList<>();while(iso.find())ds.add(LocalDate.parse(iso.group()));
            var month=MONTH.matcher(q);List<YearMonth> ms=new ArrayList<>();while(month.find())ms.add(month(month,today,true));
            if(ds.size()==2){to=ds.getFirst();purchase=ds.get(1);}else if(ds.size()==1){purchase=ds.getFirst();to=purchase;}else if(ms.size()==2){to=ms.getFirst().atEndOfMonth();purchase=ms.get(1).atDay(1);}else if(ms.size()==1){purchase=ms.getFirst().atDay(1);to=ms.getFirst().atEndOfMonth();}else if(dates.explicit()){purchase=from;to=dates.to();}else throw new Clarification("Which future purchase date should I use? Use YYYY-MM-DD or a named month.");
            from=today;
            if(!purchase.isAfter(today)||purchase.isAfter(to))throw new Clarification("The purchase must be after today and no later than the forecast date. With two dates, put the forecast date first and purchase date second (include years across year boundaries).");
        }
        if(future){if(from.isAfter(to))throw new Clarification("Choose a date range in chronological order.");if(to.isBefore(today)||ChronoUnit.DAYS.between(today,to)>ForecastService.MAX_DAYS)throw new Clarification("Choose a current/future range within the forecast horizon.");}
        else {if(from.isBefore(LocalDate.of(1900,1,1))||from.isAfter(to)||to.isAfter(today)||ChronoUnit.DAYS.between(from,to)>1830)throw new Clarification("Choose historical dates through today, up to 1,831 days. Use a forecast question for future dates.");}
        if(intent==Intent.BILLS&&q.contains("this week"))from=today;
        if(intent==Intent.BILLS&&(ChronoUnit.DAYS.between(from,to)>92||from.isBefore(today)))throw new Clarification("Choose an upcoming payment period of at most 93 days.");
        if(q.contains("subscription"))category=categories.stream().filter(x->x.name().equalsIgnoreCase("Subscriptions")).map(ApiModels.CategoryView::id).findFirst().orElseThrow(()->new Clarification("No Subscriptions category exists. Ask about recurring expenses instead."));
        return new Parsed(intent,category,from,to,purchase,amount);
    }
    Dates dates(String q,LocalDate today,boolean future){
        if(Pattern.compile("\\b(?:last|next) \\d+ (?:days?|weeks?|months?|years?)\\b").matcher(q).find()&&!q.contains("last 3 months")&&!q.contains("last 6 months")&&!q.contains("last 12 months")&&!q.contains("next 30 days"))throw new Clarification("Use last 3/6/12 months, next 30 days, or an exact date range.");
        if(q.contains("this month")&&q.contains("last month"))throw new Clarification("Choose one selected period; comparisons use the disclosed preceding equal-length interval.");
        var iso=ISO.matcher(q);List<LocalDate> ds=new ArrayList<>();while(iso.find())ds.add(LocalDate.parse(iso.group()));
        if(ds.size()>2)throw new Clarification("Use at most two dates.");if(!ds.isEmpty())return new Dates(ds.getFirst(),ds.getLast(),true);
        var months=MONTH.matcher(q);List<YearMonth> ms=new ArrayList<>();while(months.find())ms.add(month(months,today,future));
        if(!ms.isEmpty()&&Pattern.compile("(?:"+String.join("|",MONTHS)+") \\d{1,2}\\b").matcher(q).find())throw new Clarification("Use YYYY-MM-DD for exact days within a named month.");
        if(ms.isEmpty()&&Pattern.compile("\\b\\d{4}\\b").matcher(q.replaceAll("\\$\\s*[-+]?\\d[\\d,.]*", "").replaceAll("\\b(?:spend|purchase|buy)\\s+[-+]?\\d[\\d,.]*", "")).find())throw new Clarification("Use a named month with year, this/last year, or YYYY-MM-DD dates.");
        if(ms.size()>2)throw new Clarification("Use one range at a time.");if(!ms.isEmpty())return new Dates(ms.getFirst().atDay(1),ms.getLast().atEndOfMonth().isAfter(today)&&!future?today:ms.getLast().atEndOfMonth(),true);
        if(q.contains("next week")){LocalDate mon=today.with(TemporalAdjusters.next(DayOfWeek.MONDAY));return new Dates(mon,mon.plusDays(6),true);}
        if(q.contains("this week"))return new Dates(today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)),future?today.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY)):today,true);
        if(q.contains("yesterday"))return new Dates(today.minusDays(1),today.minusDays(1),true);
        if(q.contains("last week")){LocalDate mon=today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).minusWeeks(1);return new Dates(mon,mon.plusDays(6),true);}
        if(q.contains("tomorrow"))return new Dates(today.plusDays(1),today.plusDays(1),true);
        if(q.contains("today"))return new Dates(today,today,true);
        if(q.contains("this year"))return new Dates(today.withDayOfYear(1),future?LocalDate.of(today.getYear(),12,31):today,true);
        if(q.contains("last year"))return new Dates(LocalDate.of(today.getYear()-1,1,1),LocalDate.of(today.getYear()-1,12,31),true);
        for(int n:new int[]{3,6,12})if(q.contains("last "+n+" months"))return new Dates(today.minusMonths(n-1).withDayOfMonth(1),today,true);
        if(q.contains("last month")){var m=YearMonth.from(today).minusMonths(1);return new Dates(m.atDay(1),m.atEndOfMonth(),true);}
        if(q.contains("next month")){var m=YearMonth.from(today).plusMonths(1);return new Dates(m.atDay(1),m.atEndOfMonth(),true);}
        if(q.contains("this month"))return new Dates(today.withDayOfMonth(1),today,true);
        if(q.contains("next 30 days"))return new Dates(today,today.plusDays(29),true);
        if(q.matches(".*\\b(in|during|since|between|from|until|through|by)\\b.*")&&!q.contains("month before"))throw new Clarification("Please use a supported date range or YYYY-MM-DD dates.");
        return new Dates(future?today:today.withDayOfMonth(1),future?today.plusMonths(1):today,false);
    }
    private YearMonth month(Matcher m,LocalDate today,boolean future){int num=MONTHS.indexOf(m.group(1))+1;int year=m.group(2)==null?today.getYear():Integer.parseInt(m.group(2));if(m.group(2)==null&&future&&YearMonth.of(year,num).atEndOfMonth().isBefore(today))year++;return YearMonth.of(year,num);}
}
