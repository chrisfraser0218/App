package com.finsight;

import jakarta.validation.constraints.*;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public final class RecurringModels {
    private RecurringModels() {}
    public record RuleInput(
        @NotBlank @Size(max = 160) String description,
        @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
        @NotNull TransactionType type, @NotNull UUID categoryId,
        @NotNull RecurrenceFrequency frequency, @Min(1) @Max(31) Integer paymentDay,
        @Min(1) @Max(31) Integer secondPaymentDay, @NotNull LocalDate startDate,
        LocalDate endDate, @NotNull Boolean enabled, @NotNull UUID requestId,
        boolean backfillConfirmed, UUID predictionId) {}
    public record RuleView(UUID id, String description, BigDecimal amount, TransactionType type,
        UUID categoryId, RecurrenceFrequency frequency, Integer paymentDay, Integer secondPaymentDay, LocalDate startDate, LocalDate endDate,
        LocalDate nextDate, boolean enabled, boolean archived, UUID requestId, long version,
        String status, boolean catchUpPending) {}
    public record RuleUpdate(@NotNull @Valid RuleInput rule, @NotNull @Min(0) Long version) {}
    public record StateInput(@NotNull Boolean enabled, @NotNull @Min(0) Long version) {}
    public record ArchiveInput(@NotNull @Min(0) Long version) {}
    public record ReconcileInput(@NotNull LocalDate occurrenceDate, UUID transactionId, boolean confirmAmountDifference) {}
    public record OccurrenceView(LocalDate date, String resolution, UUID transactionId,
        String description, BigDecimal amount, TransactionType type) {}
    public record ProcessResult(int posted, int pendingRules, int failedRules) {}
}
