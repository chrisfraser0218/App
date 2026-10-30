package com.finsight;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
final class SavingsModels {
 private SavingsModels(){}
 enum Bucket { IN_ACCOUNT, EXTERNAL }
 enum EntryType { CONTRIBUTION, WITHDRAWAL }
 enum Action { ARCHIVE, RESTORE, COMPLETE, REOPEN }
 enum LinkType { NONE, PLANNED, RECURRING }
 record GoalInput(@NotBlank @Size(max=100) String name,@Size(max=1000) String description,
   @NotNull @DecimalMin("0.01") @Digits(integer=12,fraction=2) BigDecimal targetAmount,LocalDate targetDate,@NotNull UUID requestId){}
 record GoalUpdate(@NotNull @Valid GoalInput goal,@NotNull @Min(0) Long version){}
 record StateInput(@NotNull Action action,@NotNull @Min(0) Long version){}
 record EntryInput(@NotNull @DecimalMin("0.01") @Digits(integer=12,fraction=2) BigDecimal amount,@NotNull EntryType type,
   @NotNull Bucket bucket,@NotNull LocalDate date,@Size(max=500) String note,UUID transactionId){}
 record EntryRequest(@NotNull @Valid EntryInput entry,@NotNull UUID requestId,@NotNull @Min(0) Long version){}
 record Correction(@Valid EntryInput replacement,@NotBlank @Size(max=500) String reason,@NotNull UUID requestId,@NotNull @Min(0) Long version){}
 record ScheduleInput(@com.fasterxml.jackson.annotation.JsonFormat(shape=com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) @NotNull @DecimalMin("0.01") @Digits(integer=12,fraction=2) BigDecimal amount,@NotNull Bucket bucket,
   RecurrenceFrequency frequency,@Min(1) @Max(31) Integer paymentDay,@Min(1) @Max(31) Integer secondPaymentDay,
   @NotNull LocalDate startDate,LocalDate endDate,@NotNull Boolean enabled,@NotNull LinkType linkType,UUID linkId,@NotNull @Min(0) Long version){}
 record Goal(UUID id,String name,String description,String targetAmount,LocalDate targetDate,Instant createdAt,String status,
   boolean archived,boolean completed,String saved,String inAccount,String external,String remaining,String progress,long version,UUID requestId){}
 record Entry(UUID id,String amount,EntryType type,Bucket bucket,LocalDate date,String note,UUID transactionId,
   boolean active,boolean transactionMissing,boolean transactionChanged,UUID replacesId,String correctionReason,Instant createdAt){}
 record Summary(int totalGoals,int activeGoals,int archivedGoals,int completedGoals,int approachingGoals,String totalTarget,
   String totalSaved,String overallProgress,String actualBalance,String allocatedInAccount,String trackedExternal,String unallocatedBalance,LocalDate asOfDate){}
 record Point(LocalDate date,String actual,String projected){}
 record Month(String month,String contributions,String withdrawals,String net){}
 record Projection(LocalDate asOfDate,LocalDate horizon,String method,LocalDate estimatedCompletionDate,String expectedByTarget,
   String requiredMonthly,String requiredPerOccurrence,int remainingOccurrences,String bankProjectedBalance,LocalDate bankForecastDate,
   List<Point> points,List<Month> months,List<String> observations){}
 record Detail(Goal goal,List<Entry> entries,ScheduleInput schedule,Projection projection){}
 record Dashboard(Summary summary,List<Goal> goals){}
}
