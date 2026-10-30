package com.finsight;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static com.finsight.CalendarModels.*;
import com.finsight.CalendarModels.Month;

/** A read-only month composition. Scheduling, money arithmetic and warnings remain in ForecastService. */
@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
class CalendarService {
    private final ForecastService forecasts;
    private final JdbcTemplate jdbc;
    CalendarService(ForecastService forecasts, JdbcTemplate jdbc) { this.forecasts = forecasts; this.jdbc = jdbc; }

    Month month(YearMonth requested) {
        LocalDate today = forecasts.today();
        YearMonth max = YearMonth.from(today.plusDays(ForecastService.MAX_DAYS));
        if (max.atEndOfMonth().isAfter(today.plusDays(ForecastService.MAX_DAYS))) max = max.minusMonths(1);
        YearMonth selected = requested == null ? YearMonth.from(today) : requested;
        if (selected.isBefore(YearMonth.of(1900, 1)) || selected.isAfter(max))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a month from 1900 through the supported forecast horizon");
        LocalDate from = selected.atDay(1), to = selected.atEndOfMonth();
        var preferences = forecasts.preferences();
        Map<LocalDate, ForecastModels.Day> projections = new HashMap<>();
        Map<LocalDate, List<ForecastModels.Warning>> warnings = new HashMap<>();
        ForecastModels.Month monthly = null;
        if (!to.isBefore(today)) {
            // Carry from today once; never make one forecast request/calculation per calendar cell.
            var forecast = forecasts.forecast(to.equals(today) ? today.plusDays(1) : to);
            for (var day : forecast.days()) if (!day.date().isBefore(from) && !day.date().isAfter(to)) projections.put(day.date(), day);
            for (var warning : forecast.warnings()) if (!warning.date().isBefore(from) && !warning.date().isAfter(to))
                warnings.computeIfAbsent(warning.date(), d -> new ArrayList<>()).add(warning);
            monthly = forecast.months().stream().filter(m -> m.month().equals(selected.toString())).findFirst().orElseThrow();
        }
        Map<LocalDate, List<Entry>> entries = new HashMap<>();
        for (var day : projections.values()) for (var event : day.transactions()) {
            add(entries, day.date(), new Entry("projection:" + event.source() + ":" + event.id(), event.description(), event.amount(),
                event.type(), event.category(), event.source(), event.overdue() ? "OVERDUE" : "UPCOMING", event.scheduledDate(),
                event.source().equals("RECURRING") ? event.sourceId() : null, event.source().equals("PLANNED") ? event.sourceId() : null,
                null, true, event.overdue() ? "Unposted overdue item included on today's projected flow; original due date retained." : "Projection only; not recorded money."));
        }
        // One row per actual payment even if it completes both a plan and a recurring occurrence.
        jdbc.query("""
            SELECT t.id,t.description,t.amount,t.type,t.transaction_date,c.name AS category,
                   o.rule_id,o.occurrence_date,o.resolution,p.id AS plan_id
            FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
            LEFT JOIN recurring_occurrences o ON o.transaction_id=t.id AND o.user_id=t.user_id
            LEFT JOIN planned_transactions p ON p.transaction_id=t.id AND p.user_id=t.user_id AND p.account_id=t.account_id
            WHERE t.user_id=? AND t.account_id=? AND t.transaction_date BETWEEN ? AND ?
            ORDER BY t.transaction_date,t.id
            """, r -> {
                LocalDate date = r.getObject("transaction_date", LocalDate.class);
                add(entries, date, new Entry("recorded:" + r.getString("id"), r.getString("description"), r.getBigDecimal("amount").toPlainString(),
                    TransactionType.valueOf(r.getString("type")), r.getString("category"), "RECORDED",
                    "MANUAL".equals(r.getString("resolution")) ? "RECONCILED" : "COMPLETED",
                    r.getObject("occurrence_date", LocalDate.class), r.getObject("rule_id", UUID.class), r.getObject("plan_id", UUID.class),
                    r.getObject("id", UUID.class), false, "Already included in actual balance; not added to projected flow again."));
            }, CurrentIdentity.userId(), CurrentIdentity.accountId(), from, to);
        // Completion/cancellation intentions stay visible on their original planned dates, without counting cash twice.
        jdbc.query("""
            SELECT p.*,c.name AS category,t.transaction_date AS recorded_date
            FROM planned_transactions p JOIN categories c ON c.id=p.category_id AND c.user_id=p.user_id
            LEFT JOIN transactions t ON t.id=p.transaction_id AND t.user_id=p.user_id AND t.account_id=p.account_id
            WHERE p.user_id=? AND p.account_id=? AND p.planned_date BETWEEN ? AND ?
            """, r -> {
                LocalDate date = r.getObject("planned_date", LocalDate.class), recorded = r.getObject("recorded_date", LocalDate.class);
                String status = r.getString("status");
                if (status.equals("PLANNED") && !date.isBefore(today)) return; // Already in the shared forecast.
                if (status.equals("COMPLETED") && date.equals(recorded)) return; // The actual row carries both links.
                if (status.equals("PLANNED")) status = "OVERDUE";
                if ("HANDLED".equals(r.getString("completion_mode"))) status = "HANDLED";
                String note = status.equals("CANCELED") ? "Canceled plan; excluded from projections." :
                    status.equals("OVERDUE") ? "Uncompleted past intention, not recorded activity; included on today's forecast." :
                    recorded != null ? "Already recorded on " + recorded + "; this planned-date marker records no additional money." :
                    "Closed plan without a current ledger link; no money is recorded by this marker.";
                add(entries, date, new Entry("plan:" + r.getString("id"), r.getString("description"), r.getBigDecimal("amount").toPlainString(),
                    TransactionType.valueOf(r.getString("type")), r.getString("category"), "PLANNED", status, date, null,
                    r.getObject("id", UUID.class), r.getObject("transaction_id", UUID.class), false, note));
            }, CurrentIdentity.userId(), CurrentIdentity.accountId(), from, to);
        // Retain handled/deleted receipts and early/manual links on the scheduled date, without recreating an occurrence.
        jdbc.query("""
            SELECT o.*,t.transaction_date AS recorded_date,t.description,t.amount,t.type,c.name AS category
            FROM recurring_occurrences o JOIN recurring_rules rule ON rule.id=o.rule_id AND rule.user_id=o.user_id
            LEFT JOIN transactions t ON t.id=o.transaction_id AND t.user_id=o.user_id AND t.account_id=rule.account_id
            LEFT JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
            WHERE o.user_id=? AND rule.account_id=? AND o.occurrence_date BETWEEN ? AND ?
            """, r -> {
                LocalDate date = r.getObject("occurrence_date", LocalDate.class), recorded = r.getObject("recorded_date", LocalDate.class);
                if (date.equals(recorded)) return;
                boolean handled = "HANDLED".equals(r.getString("resolution"));
                String type = r.getString("type");
                add(entries, date, new Entry("receipt:" + r.getString("rule_id") + ":" + date,
                    recorded == null ? handled ? "Handled recurring occurrence" : "Removed recurring payment" : r.getString("description"),
                    r.getBigDecimal("amount") == null ? null : r.getBigDecimal("amount").toPlainString(),
                    type == null ? null : TransactionType.valueOf(type), r.getString("category"), "RECURRING",
                    handled ? "HANDLED" : recorded == null ? "REMOVED" : "RECONCILED", date, r.getObject("rule_id", UUID.class), null,
                    r.getObject("transaction_id", UUID.class), false, recorded == null ?
                    "Permanent receipt; original amount/category was not retained. No payment will be recreated." :
                    "Already recorded on " + recorded + "; not counted again on the scheduled date."));
            }, CurrentIdentity.userId(), CurrentIdentity.accountId(), from, to);
        List<Day> days = new ArrayList<>();
        for (LocalDate date = from; !date.isAfter(to); date = date.plusDays(1)) {
            var items = entries.getOrDefault(date, List.of()).stream().sorted(Comparator.comparing(Entry::projected).reversed()
                .thenComparing(Entry::description).thenComparing(Entry::id)).toList();
            days.add(new Day(date, date.equals(today), projections.get(date), flows(projections.get(date)), List.copyOf(warnings.getOrDefault(date, List.of())), items));
        }
        var projectedDays = days.stream().filter(d -> d.projection() != null).toList();
        String lowest = null; LocalDate lowestDate = null;
        if (!projectedDays.isEmpty()) {
            var first = projectedDays.getFirst(); lowest = first.projection().startingBalance(); lowestDate = first.date();
            for (var d : projectedDays) if (new BigDecimal(d.projection().endingBalance()).compareTo(new BigDecimal(lowest)) < 0) {
                lowest = d.projection().endingBalance(); lowestDate = d.date();
            }
        }
        Entry nextBill = days.stream().flatMap(d -> d.entries().stream()).filter(e -> e.projected() && e.type() == TransactionType.EXPENSE).findFirst().orElse(null);
        return new Month(selected.toString(), today, preferences.timeZone(), "1900-01", max.toString(), preferences.lowBalanceThreshold(),
            "Historical balances are unavailable: the opening balance has no effective date or revision history. Recorded activity is shown, without inventing a historical account balance.",
            new Summary(monthly == null ? "0.00" : monthly.expenses(), monthly == null ? "0.00" : monthly.income(), nextBill,
                monthly == null ? null : monthly.endingBalance(), lowest, lowestDate), List.copyOf(days));
    }
    private Flows flows(ForecastModels.Day day) {
        if (day == null) return null;
        return new Flows(flow(day, TransactionType.INCOME, "RECURRING"), flow(day, TransactionType.EXPENSE, "RECURRING"),
            flow(day, TransactionType.INCOME, "PLANNED"), flow(day, TransactionType.EXPENSE, "PLANNED"));
    }
    private String flow(ForecastModels.Day day, TransactionType type, String source) {
        return forecasts.total(day.transactions(), type, source).setScale(2).toPlainString();
    }
    private void add(Map<LocalDate, List<Entry>> entries, LocalDate date, Entry entry) {
        entries.computeIfAbsent(date, d -> new ArrayList<>()).add(entry);
    }
}
