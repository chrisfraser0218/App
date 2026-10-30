package com.finsight;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.*;

final class AssistantModels {
    private AssistantModels() {}
    enum Intent { SAVINGS, SPENDING, LARGEST, COMPARISON, RECURRING_EXPENSES, UNUSUAL, INCOME, MONTHLY_INCOME, RECURRING_INCOME, PAYCHECK, BALANCE, FORECAST, LOWEST, WARNINGS, SCENARIO, BILLS, NEXT_PAYMENT }
    record Context(@NotNull Intent intent, UUID categoryId, @NotNull LocalDate from, @NotNull LocalDate to) {}
    record Question(@NotBlank @Size(max=1000) String question, @Valid Context context) {}
    record Metric(String label,String value) {}
    record Evidence(String id,String description,String amount,String type,LocalDate date,String category,String source) {}
    record Link(String label,String href) {}
    record Answer(String status,String mode,String kind,String title,String text,LocalDate asOfDate,LocalDate from,LocalDate to,
                  List<Metric> metrics,List<Evidence> evidence,int evidenceCount,List<String> assumptions,List<Link> links,List<String> suggestions,Context context) {}
}
