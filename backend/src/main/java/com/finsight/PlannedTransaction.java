package com.finsight;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.UUID;

@Entity @Table(name="planned_transactions")
class PlannedTransaction {
    @Id UUID id;
    UUID userId;
    UUID accountId;
    UUID categoryId;
    @Column(length=160) String description;
    @Column(precision=19,scale=2) BigDecimal amount;
    @Enumerated(EnumType.STRING) TransactionType type;
    LocalDate plannedDate;
    @Column(length=10) String status;
    UUID requestId;
    @Column(length=64) String creationFingerprint;
    UUID transactionId;
    @Column(length=7) String completionMode;
    UUID completionRequestId;
    @Column(length=64) String completionFingerprint;
    Instant createdAt;
    Instant completedAt;
    @Version long version;
    protected PlannedTransaction() {}
}
