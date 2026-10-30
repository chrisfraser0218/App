package com.finsight;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

public final class ForecastModels {
    private ForecastModels() {}
    public record PlanInput(@NotBlank @Size(max=160) String description,
        @NotNull @DecimalMin("0.01") @Digits(integer=12,fraction=2) BigDecimal amount,
        @NotNull TransactionType type,@NotNull UUID categoryId,@NotNull LocalDate date,@NotNull UUID requestId) {}
    public record PlanUpdate(@NotNull @Valid PlanInput plan,@NotNull @Min(0) Long version) {}
    public record VersionInput(@NotNull @Min(0) Long version) {}
    public enum CompletionMode { RECORD, LINK, HANDLED }
    public record CompletionInput(@NotNull CompletionMode mode,UUID transactionId,LocalDate recordedDate,
        boolean confirmAmountDifference,@NotNull UUID requestId,@NotNull @Min(0) Long version) {}
    public record PlanView(UUID id,String description,String amount,TransactionType type,UUID categoryId,LocalDate date,
        String status,UUID requestId,long version,UUID transactionId,String completionMode,boolean overdue) {}
    public record PreferenceInput(@NotNull @DecimalMin("0.00") @Digits(integer=12,fraction=2) BigDecimal lowBalanceThreshold,
        @NotNull @Min(0) Long version) {}
    public record Preferences(String lowBalanceThreshold,long version,LocalDate asOfDate,String timeZone,LocalDate maxDate) {}
    public record Hypothetical(@NotNull UUID id,@NotBlank @Size(max=160) String description,
        @NotNull @DecimalMin("0.01") @Digits(integer=12,fraction=2) BigDecimal amount,
        @NotNull TransactionType type,@NotNull LocalDate date) {}
    public record ScenarioInput(@NotNull LocalDate endDate,
        @DecimalMin("0.00") @Digits(integer=12,fraction=2) BigDecimal lowBalanceThreshold,
        @NotNull @Size(max=100) List<@NotNull @Valid Hypothetical> transactions) {}
    // Monetary strings preserve decimal values end-to-end. Chart numbers are display-only.
    public record Event(String id,String source,UUID sourceId,String description,TransactionType type,String amount,
        String category,LocalDate scheduledDate,LocalDate effectiveDate,boolean overdue) {}
    public record Day(LocalDate date,String startingBalance,String income,String expenses,String netChange,
        String endingBalance,List<Event> transactions) {}
    public record Month(String month,LocalDate periodStart,LocalDate periodEnd,String startingBalance,
        String income,String expenses,String netChange,String endingBalance) {}
    public record Warning(LocalDate date,String balance,String severity,String kind,List<Event> transactions) {}
    public record Summary(LocalDate asOfDate,LocalDate endDate,String timeZone,String currentActualBalance,
        String projectedBalance,String totalIncome,String totalExpenses,String lowestBalance,LocalDate lowestDate,
        String netChange,String recurringIncome,String recurringExpenses,String plannedIncome,String plannedExpenses,
        String hypotheticalIncome,String hypotheticalExpenses,int overdueOccurrences,int overduePlans) {}
    public record Forecast(Summary summary,String lowBalanceThreshold,List<Day> days,List<Month> months,List<Warning> warnings) {}
    public record Comparison(Forecast baseline,Forecast scenario,String projectedDifference) {}
}
