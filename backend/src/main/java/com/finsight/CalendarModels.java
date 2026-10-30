package com.finsight;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

final class CalendarModels {
    private CalendarModels() {}
    record Entry(String id, String description, String amount, TransactionType type, String category,
                 String source, String status, LocalDate scheduledDate, UUID recurringRuleId,
                 UUID plannedTransactionId, UUID transactionId, boolean projected, String note) {}
    record Flows(String scheduledIncome, String scheduledExpenses, String plannedIncome, String plannedExpenses) {}
    record Day(LocalDate date, boolean today, ForecastModels.Day projection, Flows flows,
               List<ForecastModels.Warning> warnings, List<Entry> entries) {}
    record Summary(String upcomingExpenses, String expectedIncome, Entry nextBill,
                   String monthEndBalance, String lowestBalance, LocalDate lowestDate) {}
    record Month(String month, LocalDate asOfDate, String timeZone, String minMonth, String maxMonth,
                 String lowBalanceThreshold, String historicalExplanation, Summary summary, List<Day> days) {}
}
