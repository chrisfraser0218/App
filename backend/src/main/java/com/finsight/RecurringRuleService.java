package com.finsight;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import static com.finsight.RecurringModels.*;

@Service
@Transactional(readOnly = true)
class RecurringRuleService {
    static final int BATCH_SIZE = 500;
    private final RecurringRuleRepository rules;
    private final AccountRepository accounts;
    private final CategoryRepository categories;
    private final TransactionRepository transactions;
    private final CategoryPredictionService predictions;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    RecurringRuleService(RecurringRuleRepository rules, AccountRepository accounts, CategoryRepository categories,
                         TransactionRepository transactions, CategoryPredictionService predictions, JdbcTemplate jdbc, Clock clock) {
        this.rules = rules; this.accounts = accounts; this.categories = categories; this.transactions = transactions;
        this.predictions = predictions; this.jdbc = jdbc; this.clock = clock;
    }
    LocalDate today() { return LocalDate.now(clock); }
    RuleView get(UUID id) { return view(readOwned(id)); }
    List<RuleView> list() {
        return rules.findByUserIdAndAccountIdOrderByCreatedAtDesc(DemoIdentity.USER_ID, DemoIdentity.ACCOUNT_ID).stream().map(this::view).toList();
    }
    List<UUID> dueIds() { return rules.dueIds(DemoIdentity.USER_ID, DemoIdentity.ACCOUNT_ID, today()); }

    @Transactional
    RuleView create(RuleInput input) {
        validate(input);
        // Serialize create requests per account, including retries with the same request ID.
        accounts.lockOwned(DemoIdentity.ACCOUNT_ID, DemoIdentity.USER_ID).orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Account not found"));
        String fingerprint = fingerprint(input);
        var existing = rules.findByUserIdAndRequestId(DemoIdentity.USER_ID, input.requestId());
        if (existing.isPresent()) {
            if (!existing.get().creationFingerprint.equals(fingerprint)) throw error(HttpStatus.CONFLICT, "This request ID was already used for a different schedule");
            return view(existing.get());
        }
        if (input.enabled() && input.startDate().isBefore(today()) && !input.backfillConfirmed())
            throw error(HttpStatus.BAD_REQUEST, "Confirm posting all due occurrences from the past start date");
        RecurringRule r = new RecurringRule(); r.id = UUID.randomUUID(); r.userId = DemoIdentity.USER_ID;
        r.accountId = DemoIdentity.ACCOUNT_ID; r.frequency = input.frequency(); r.startDate = input.startDate();
        r.requestId = input.requestId(); r.creationFingerprint = fingerprint; r.createdAt = clock.instant();
        applyFutureFields(r, input); r.enabled = input.enabled(); r.nextDate = RecurrenceDates.onOrAfter(r, r.startDate);
        if (r.endDate != null && r.nextDate != null && r.nextDate.isAfter(r.endDate)) r.nextDate = null;
        rules.saveAndFlush(r);
        predictions.recordRecurringFeedback(input.predictionId(), r);
        postDue(r, today());
        rules.flush();
        return view(r);
    }

    @Transactional
    RuleView update(UUID id, RuleUpdate update) {
        RuleInput input = update.rule(); validate(input);
        RecurringRule r = owned(id); checkVersion(r, update.version()); checkEditable(r);
        if (!input.requestId().equals(r.requestId)) throw error(HttpStatus.BAD_REQUEST, "Request ID cannot be changed");
        if (input.enabled() != r.enabled) throw error(HttpStatus.BAD_REQUEST, "Use pause or resume to change the schedule state");
        catchUpBeforeChange(r);
        applyFutureFields(r, input);
        r.nextDate = RecurrenceDates.after(r, today());
        rules.saveAndFlush(r);
        predictions.recordRecurringFeedback(input.predictionId(), r);
        return view(r);
    }

    @Transactional
    RuleView setEnabled(UUID id, StateInput input) {
        RecurringRule r = owned(id); checkVersion(r, input.version()); checkEditable(r);
        if (r.enabled && !input.enabled()) catchUpBeforeChange(r);
        if (!r.enabled && input.enabled()) {
            // Paused dates are intentionally skipped; resume never creates surprise backfill.
            while (r.nextDate != null && !r.nextDate.isAfter(today())) advance(r);
        }
        r.enabled = input.enabled(); rules.saveAndFlush(r); return view(r);
    }

    @Transactional
    RuleView archive(UUID id, ArchiveInput input) {
        RecurringRule r = owned(id); checkVersion(r, input.version());
        if (!r.archived) { catchUpBeforeChange(r); r.archived = true; r.enabled = false; rules.saveAndFlush(r); }
        return view(r);
    }

    @Transactional
    public int processOne(UUID id) {
        RecurringRule r = owned(id);
        int count = postDue(r, today()); rules.flush(); return count;
    }

    private void catchUpBeforeChange(RecurringRule r) {
        if (!r.enabled || r.nextDate == null || r.nextDate.isAfter(today())) return;
        // Reject a large backlog before writes; the processor advances it in committed batches.
        LocalDate afterBatch = r.nextDate;
        for (int i = 0; i < BATCH_SIZE && afterBatch != null; i++) afterBatch = RecurrenceDates.after(r, afterBatch);
        if (afterBatch != null && !afterBatch.isAfter(today()) && (r.endDate == null || !afterBatch.isAfter(r.endDate)))
            throw error(HttpStatus.CONFLICT, "Catch-up is still pending. Process due entries before changing this schedule");
        postDue(r, today());
    }

    private int postDue(RecurringRule r, LocalDate through) {
        int posted = 0; int examined = 0;
        while (r.enabled && !r.archived && r.nextDate != null && !r.nextDate.isAfter(through) && examined++ < BATCH_SIZE) {
            LocalDate date = r.nextDate;
            int exists = jdbc.queryForObject("SELECT COUNT(*) FROM recurring_occurrences WHERE rule_id = ? AND occurrence_date = ?", Integer.class, r.id, date);
            if (exists == 0) {
                Transaction t = new Transaction(); t.id = UUID.randomUUID(); t.userId = r.userId; t.accountId = r.accountId;
                t.categoryId = r.categoryId; t.description = r.description; t.amount = r.amount; t.type = r.type;
                t.transactionDate = date; t.createdAt = clock.instant(); transactions.saveAndFlush(t);
                jdbc.update("INSERT INTO recurring_occurrences(rule_id,user_id,occurrence_date,transaction_id,resolution) VALUES (?,?,?,?,'POSTED')", r.id, r.userId, date, t.id);
                posted++;
            }
            advance(r);
        }
        return posted;
    }
    List<OccurrenceView> history(UUID id) {
        readOwned(id);
        return jdbc.query("SELECT o.occurrence_date,o.resolution,o.transaction_id,t.description,t.amount,t.type FROM recurring_occurrences o LEFT JOIN transactions t ON t.id = o.transaction_id AND t.user_id = o.user_id WHERE o.rule_id = ? AND o.user_id = ? ORDER BY o.occurrence_date DESC",
            (row, n) -> new OccurrenceView(row.getObject("occurrence_date", LocalDate.class),
                row.getObject("transaction_id") == null && !row.getString("resolution").equals("HANDLED") ? "REMOVED" : row.getString("resolution"),
                row.getObject("transaction_id", UUID.class), row.getString("description"), row.getBigDecimal("amount"),
                row.getString("type") == null ? null : TransactionType.valueOf(row.getString("type"))), id, DemoIdentity.USER_ID);
    }
    List<OccurrenceView> occurrences(UUID id, LocalDate from, LocalDate to) {
        RecurringRule r = readOwned(id);
        if (to.isBefore(from) || java.time.temporal.ChronoUnit.DAYS.between(from, to) > 366)
            throw error(HttpStatus.BAD_REQUEST, "Choose an occurrence range of at most 366 days");
        Map<LocalDate, OccurrenceView> receipts = new HashMap<>();
        for (OccurrenceView receipt : history(id)) receipts.put(receipt.date(), receipt);
        List<OccurrenceView> result = new ArrayList<>();
        for (LocalDate date = RecurrenceDates.onOrAfter(r, from); date != null && !date.isAfter(to); date = RecurrenceDates.after(r, date)) {
            result.add(receipts.getOrDefault(date, new OccurrenceView(date,
                r.archived ? "CANCELED" : !r.enabled ? "PAUSED" : "SCHEDULED", null, r.description, r.amount, r.type)));
        }
        return result;
    }
    @Transactional
    OccurrenceView reconcile(UUID id, ReconcileInput input) {
        RecurringRule r = owned(id); checkEditable(r);
        LocalDate date = input.occurrenceDate();
        var existing = jdbc.query("SELECT transaction_id,resolution FROM recurring_occurrences WHERE rule_id = ? AND occurrence_date = ?",
            (row, n) -> new Object[] {row.getObject("transaction_id", UUID.class), row.getString("resolution")}, id, date);
        if (existing.isEmpty() && !date.equals(RecurrenceDates.onOrAfter(r, date)))
            throw error(HttpStatus.BAD_REQUEST, "This date is not an occurrence of the schedule");
        if (!existing.isEmpty() && existing.getFirst()[0] != null) {
            if (existing.getFirst()[0].equals(input.transactionId()) && existing.getFirst()[1].equals("MANUAL"))
                return history(id).stream().filter(o -> o.date().equals(date)).findFirst().orElseThrow();
            throw error(HttpStatus.CONFLICT, "This occurrence already has a posted transaction. Review it before reconciling");
        }
        if (input.transactionId() != null) {
            Transaction t = transactions.lockOwned(input.transactionId(), r.userId, r.accountId)
                .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Transaction not found"));
            if (t.type != r.type) throw error(HttpStatus.BAD_REQUEST, "Payment type must match the schedule");
            if (t.amount.compareTo(r.amount) != 0 && !input.confirmAmountDifference())
                throw error(HttpStatus.BAD_REQUEST, "Confirm the difference between the recorded amount and schedule amount");
            if (jdbc.queryForObject("SELECT COUNT(*) FROM recurring_occurrences WHERE transaction_id = ?", Integer.class, t.id) > 0)
                throw error(HttpStatus.CONFLICT, "This transaction is already linked to a recurring occurrence");
        }
        String resolution = input.transactionId() == null ? "HANDLED" : "MANUAL";
        if (existing.isEmpty()) jdbc.update("INSERT INTO recurring_occurrences(rule_id,user_id,occurrence_date,transaction_id,resolution) VALUES (?,?,?,?,?)", id, r.userId, date, input.transactionId(), resolution);
        else jdbc.update("UPDATE recurring_occurrences SET transaction_id = ?,resolution = ? WHERE rule_id = ? AND occurrence_date = ?", input.transactionId(), resolution, id, date);
        return history(id).stream().filter(o -> o.date().equals(date)).findFirst().orElseThrow();
    }
    private RecurringRule readOwned(UUID id) {
        return rules.findById(id).filter(r -> r.userId.equals(DemoIdentity.USER_ID) && r.accountId.equals(DemoIdentity.ACCOUNT_ID))
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Recurring schedule not found"));
    }

    private void advance(RecurringRule r) { r.nextDate = RecurrenceDates.after(r, r.nextDate); }
    private void validate(RuleInput input) {
        if (input.startDate().isBefore(LocalDate.of(1900, 1, 1)) || input.startDate().getYear() > 9999)
            throw error(HttpStatus.BAD_REQUEST, "Start date must be between 1900 and 9999");
        if (input.endDate() != null && (input.endDate().isBefore(input.startDate()) || input.endDate().getYear() > 9999))
            throw error(HttpStatus.BAD_REQUEST, "End date must be on or after the start date and within year 9999");
        if ((input.frequency() == RecurrenceFrequency.MONTHLY || input.frequency() == RecurrenceFrequency.TWICE_MONTHLY) && input.paymentDay() == null)
            throw error(HttpStatus.BAD_REQUEST, "Choose a payment day from 1 to 31");
        if (input.frequency() == RecurrenceFrequency.TWICE_MONTHLY && (input.secondPaymentDay() == null || input.secondPaymentDay() <= input.paymentDay()))
            throw error(HttpStatus.BAD_REQUEST, "Choose a second payment day later than the first (1–31)");
        if (input.frequency() != RecurrenceFrequency.MONTHLY && input.frequency() != RecurrenceFrequency.TWICE_MONTHLY && input.paymentDay() != null)
            throw error(HttpStatus.BAD_REQUEST, "Payment days apply only to monthly or twice-monthly schedules");
        if (input.frequency() != RecurrenceFrequency.TWICE_MONTHLY && input.secondPaymentDay() != null)
            throw error(HttpStatus.BAD_REQUEST, "A second day applies only to twice-monthly schedules");
        Category c = categories.findByIdAndUserId(input.categoryId(), DemoIdentity.USER_ID)
            .orElseThrow(() -> error(HttpStatus.BAD_REQUEST, "Choose a valid category"));
        if (c.type != input.type()) throw error(HttpStatus.BAD_REQUEST, "Category must match transaction type");
    }
    private void applyFutureFields(RecurringRule r, RuleInput input) {
        r.description = input.description().strip(); r.amount = input.amount(); r.type = input.type();
        r.categoryId = input.categoryId(); r.endDate = input.endDate();
        r.frequency = input.frequency(); r.startDate = input.startDate();
        r.paymentDay = input.paymentDay(); r.secondPaymentDay = input.secondPaymentDay();
    }
    private RecurringRule owned(UUID id) {
        return rules.lockOwned(id, DemoIdentity.USER_ID, DemoIdentity.ACCOUNT_ID)
            .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Recurring schedule not found"));
    }
    private void checkVersion(RecurringRule r, long version) {
        if (r.version != version) throw error(HttpStatus.CONFLICT, "Schedule changed or was processed. Refresh before trying again");
    }
    private void checkEditable(RecurringRule r) {
        if (r.archived) throw error(HttpStatus.CONFLICT, "This schedule has been stopped");
    }
    private RuleView view(RecurringRule r) {
        LocalDate unpaid = r.nextDate;
        while (unpaid != null && jdbc.queryForObject("SELECT COUNT(*) FROM recurring_occurrences WHERE rule_id = ? AND occurrence_date = ?", Integer.class, r.id, unpaid) > 0)
            unpaid = RecurrenceDates.after(r, unpaid);
        String status = r.archived ? "CANCELED" : !r.enabled ? "PAUSED" : unpaid == null ? "COMPLETED" : "ACTIVE";
        return new RuleView(r.id, r.description, r.amount, r.type, r.categoryId, r.frequency, r.paymentDay, r.secondPaymentDay, r.startDate, r.endDate,
            r.archived ? null : unpaid, r.enabled, r.archived, r.requestId, r.version, status,
            r.enabled && !r.archived && r.nextDate != null && !r.nextDate.isAfter(today()));
    }
    private String fingerprint(RuleInput input) {
        try {
            StringBuilder canonical = new StringBuilder();
            for (Object field : List.of(input.description().strip(), input.amount().stripTrailingZeros().toPlainString(), input.type(), input.categoryId(), input.frequency(), String.valueOf(input.paymentDay()), String.valueOf(input.secondPaymentDay()), input.startDate(), String.valueOf(input.endDate()), input.enabled(), input.backfillConfirmed())) {
                String value = field.toString(); canonical.append(value.length()).append(':').append(value);
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    private ResponseStatusException error(HttpStatus status, String message) { return new ResponseStatusException(status, message); }
}
