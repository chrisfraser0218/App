package com.finsight;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static com.finsight.ApiModels.*;
@Service @Transactional(readOnly = true)
class FinanceService {
    private final AccountRepository accounts;
    private final CategoryRepository categories;
    private final TransactionRepository transactions;
    private final CategoryPredictionService predictions;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    FinanceService(AccountRepository accounts, CategoryRepository categories, TransactionRepository transactions, CategoryPredictionService predictions, org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.accounts = accounts; this.categories = categories; this.transactions = transactions; this.predictions = predictions; this.jdbc = jdbc;
    }
    private Account accountEntity() {
        return accounts.findByIdAndUserId(DemoIdentity.ACCOUNT_ID, DemoIdentity.USER_ID)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Demo account not found"));
    }
    private List<Transaction> entries() {
        return transactions.findByUserIdAndAccountIdOrderByTransactionDateDescCreatedAtDescIdDesc(DemoIdentity.USER_ID, DemoIdentity.ACCOUNT_ID);
    }
    List<CategoryView> categories() {
        return categories.findByUserIdOrderByName(DemoIdentity.USER_ID).stream().map(c -> new CategoryView(c.id, c.name, c.type)).toList();
    }
    TransactionView get(UUID id) { return view(owned(id)); }
    List<TransactionView> list() {
        Map<UUID, RecurringSource> sources = new HashMap<>();
        jdbc.query("SELECT transaction_id,rule_id,occurrence_date FROM recurring_occurrences WHERE user_id = ? AND transaction_id IS NOT NULL", row -> {
            sources.put(row.getObject("transaction_id", UUID.class), new RecurringSource(row.getObject("rule_id", UUID.class), row.getObject("occurrence_date", LocalDate.class)));
        }, DemoIdentity.USER_ID);
        return entries().stream().map(t -> view(t, sources.get(t.id))).toList();
    }
    AccountView account() {
        Account a = accountEntity();
        List<Transaction> all = entries();
        BigDecimal income = total(all, TransactionType.INCOME), expenses = total(all, TransactionType.EXPENSE);
        return new AccountView(a.id, a.name, a.currency, a.startingBalance, income, expenses, a.startingBalance.add(income).subtract(expenses));
    }
    @Transactional
    AccountView setBalance(BalanceInput input) {
        Account a = accountEntity(); a.startingBalance = input.startingBalance(); accounts.saveAndFlush(a); return account();
    }
    @Transactional
    TransactionView create(TransactionInput input) {
        accountEntity();
        Transaction t = new Transaction(); t.id = UUID.randomUUID(); t.userId = DemoIdentity.USER_ID;
        t.accountId = DemoIdentity.ACCOUNT_ID; t.createdAt = Instant.now();
        apply(t, input); transactions.saveAndFlush(t); predictions.recordFeedback(input.predictionId(), t); return view(t);
    }
    @Transactional
    TransactionView update(UUID id, TransactionInput input) {
        Transaction t = owned(id); apply(t, input); transactions.saveAndFlush(t); predictions.recordFeedback(input.predictionId(), t); return view(t);
    }
    @Transactional
    void delete(UUID id) { transactions.delete(owned(id)); }
    private Transaction owned(UUID id) {
        return transactions.findByIdAndUserIdAndAccountId(id, DemoIdentity.USER_ID, DemoIdentity.ACCOUNT_ID)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Transaction not found"));
    }
    private void apply(Transaction t, TransactionInput input) {
        Category c = categories.findByIdAndUserId(input.categoryId(), DemoIdentity.USER_ID)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a valid category"));
        if (c.type != input.type()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Category must match transaction type");
        t.description = input.description().strip(); t.amount = input.amount(); t.type = input.type();
        t.categoryId = c.id; t.transactionDate = input.date();
    }
    MonthlySummary summary(YearMonth month) {
        List<Transaction> all = entries().stream().filter(t -> YearMonth.from(t.transactionDate).equals(month)).toList();
        Map<UUID, BigDecimal> grouped = new HashMap<>();
        all.stream().filter(t -> t.type == TransactionType.EXPENSE).forEach(t -> grouped.merge(t.categoryId, t.amount, BigDecimal::add));
        List<CategoryTotal> totals = categories().stream().filter(c -> grouped.containsKey(c.id()))
            .map(c -> new CategoryTotal(c.id(), c.name(), grouped.get(c.id())))
            .sorted(Comparator.comparing(CategoryTotal::amount).reversed()).toList();
        return new MonthlySummary(month.toString(), total(all, TransactionType.INCOME), total(all, TransactionType.EXPENSE), totals);
    }
    private BigDecimal total(List<Transaction> all, TransactionType type) {
        return all.stream().filter(t -> t.type == type).map(t -> t.amount).reduce(new BigDecimal("0.00"), BigDecimal::add);
    }
    private record RecurringSource(UUID ruleId, LocalDate date) {}
    private TransactionView view(Transaction t) {
        var sources = jdbc.query("SELECT rule_id,occurrence_date FROM recurring_occurrences WHERE transaction_id = ? AND user_id = ?",
            (row, n) -> new RecurringSource(row.getObject("rule_id", UUID.class), row.getObject("occurrence_date", LocalDate.class)), t.id, DemoIdentity.USER_ID);
        return view(t, sources.isEmpty() ? null : sources.getFirst());
    }
    private TransactionView view(Transaction t, RecurringSource source) {
        return new TransactionView(t.id, t.description, t.amount, t.type, t.categoryId, t.transactionDate,
            source == null ? null : source.ruleId(), source == null ? null : source.date());
    }
}
