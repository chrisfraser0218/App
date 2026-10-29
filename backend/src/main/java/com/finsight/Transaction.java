package com.finsight;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Instant;
import java.util.UUID;
@Entity @Table(name = "transactions")
class Transaction {
    @Id UUID id;
    @Column(nullable = false) UUID userId;
    @Column(nullable = false) UUID accountId;
    @Column(nullable = false) UUID categoryId;
    @Column(nullable = false, length = 160) String description;
    @Column(nullable = false, precision = 19, scale = 2) BigDecimal amount;
    @Enumerated(EnumType.STRING) @Column(nullable = false) TransactionType type;
    @Column(nullable = false) LocalDate transactionDate;
    @Column(nullable = false, updatable = false) Instant createdAt;
    @Version long version;
    protected Transaction() {}
}
