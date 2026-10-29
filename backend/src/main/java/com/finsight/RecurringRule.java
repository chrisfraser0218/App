package com.finsight;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.UUID;

@Entity @Table(name = "recurring_rules")
class RecurringRule {
    @Id UUID id;
    UUID userId;
    UUID accountId;
    UUID categoryId;
    @Column(length = 160) String description;
    @Column(precision = 19, scale = 2) BigDecimal amount;
    @Enumerated(EnumType.STRING) TransactionType type;
    @Enumerated(EnumType.STRING) RecurrenceFrequency frequency;
    LocalDate startDate;
    LocalDate endDate;
    LocalDate nextDate;
    Integer paymentDay;
    Integer secondPaymentDay;
    boolean enabled;
    boolean archived;
    UUID requestId;
    @Column(length = 64) String creationFingerprint;
    Instant createdAt;
    @Version long version;
    protected RecurringRule() {}
}
