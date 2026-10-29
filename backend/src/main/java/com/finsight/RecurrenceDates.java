package com.finsight;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.TreeSet;

/** Calendar recurrence only; never use elapsed hours or a previously clamped month as an anchor. */
final class RecurrenceDates {
    private RecurrenceDates() {}
    static LocalDate onOrAfter(RecurringRule rule, LocalDate minimum) {
        LocalDate min = minimum.isBefore(rule.startDate) ? rule.startDate : minimum;
        try {
            LocalDate result = switch (rule.frequency) {
                case DAILY -> min;
                case WEEKLY, BIWEEKLY -> {
                    long days = rule.frequency == RecurrenceFrequency.WEEKLY ? 7 : 14;
                    long offset = ChronoUnit.DAYS.between(rule.startDate, min);
                    yield rule.startDate.plusDays(((offset + days - 1) / days) * days);
                }
                case MONTHLY, TWICE_MONTHLY -> monthly(rule, min);
                case YEARLY -> {
                    LocalDate candidate = yearly(rule.startDate, min.getYear());
                    yield candidate.isBefore(min) ? yearly(rule.startDate, min.getYear() + 1) : candidate;
                }
            };
            if (result.getYear() > 9999 || (rule.endDate != null && result.isAfter(rule.endDate))) return null;
            return result;
        } catch (DateTimeException | ArithmeticException ex) { return null; }
    }
    static LocalDate after(RecurringRule rule, LocalDate date) {
        try { return onOrAfter(rule, date.plusDays(1)); }
        catch (DateTimeException ex) { return null; }
    }
    private static LocalDate monthly(RecurringRule rule, LocalDate min) {
        YearMonth month = YearMonth.from(min);
        for (int i = 0; i < 2; i++) {
            TreeSet<LocalDate> dates = new TreeSet<>();
            dates.add(month.atDay(Math.min(rule.paymentDay, month.lengthOfMonth())));
            if (rule.frequency == RecurrenceFrequency.TWICE_MONTHLY)
                dates.add(month.atDay(Math.min(rule.secondPaymentDay, month.lengthOfMonth())));
            for (LocalDate candidate : dates) if (!candidate.isBefore(min)) return candidate;
            month = month.plusMonths(1);
        }
        throw new IllegalStateException("No monthly date found");
    }
    private static LocalDate yearly(LocalDate anchor, int year) {
        YearMonth month = YearMonth.of(year, anchor.getMonth());
        return month.atDay(Math.min(anchor.getDayOfMonth(), month.lengthOfMonth()));
    }
}
