package com.finsight;

import java.time.LocalDate;
import java.util.*;

final class SpendingModels {
    private SpendingModels() {}
    record Period(LocalDate from, LocalDate to, LocalDate comparisonFrom, LocalDate comparisonTo, LocalDate asOfDate) {}
    record Comparison(String current, String previous, String difference, String percent) {}
    record Monthly(String month,LocalDate from,LocalDate to,String income,String expenses,String net,int count,boolean partial) {}
    record Category(UUID id,String name,String expenses,String previous,String change,String percent,String share,int count) {}
    record Average(String amount,List<Monthly> months,String explanation) {}
    record Summary(String expenses,String income,String net,String currentMonthSpending,Comparison monthToDate,Average average,
                   String largestCategory,String recurringRecorded,String nonrecurringRecorded,Comparison periodChange) {}
    record Calculation(String label,String value) {}
    record Insight(String id,String kind,String severity,String title,String explanation,LocalDate from,LocalDate to,
                   String amount,String percentage,List<Calculation> calculations,List<UUID> evidenceIds,int evidenceCount) {}
    record RecurringItem(UUID id,String description,String category,String amount,String frequency,String monthlyEstimate,LocalDate startDate,LocalDate endDate) {}
    record RecurringChange(UUID ruleId,UUID previousId,UUID currentId,String previous,String current,String percent,LocalDate date) {}
    record Recurring(String recorded,String normalizedMonthlyEstimate,String pendingThisMonth,String upcomingTotal,LocalDate upcomingThrough,
                     List<RecurringItem> schedules,List<ForecastModels.Event> upcoming,List<Category> byCategory,List<RecurringChange> changes) {}
    record Detection(String status,String methodVersion,int eligible,int insufficient,boolean truncated,String explanation) {}
    record Evidence(UUID id,String description,String amount,TransactionType type,UUID categoryId,String category,LocalDate date,UUID recurringRuleId) {}
    record EvidencePage(List<Evidence> transactions,int total,boolean truncated) {}
    record Report(Period period,Summary summary,List<Category> categories,List<Monthly> months,Recurring recurring,
                  Detection detection,List<Insight> insights,List<Evidence> evidence,List<ApiModels.CategoryView> categoryNames,
                  List<String> limitations) {}
}
