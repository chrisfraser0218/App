package com.finsight;
import jakarta.persistence.*;
import java.util.UUID;
@Entity @Table(name = "categories")
class Category {
    @Id UUID id;
    @Column(nullable = false) UUID userId;
    @Column(nullable = false) String name;
    @Enumerated(EnumType.STRING) @Column(nullable = false) TransactionType type;
    protected Category() {}
}
