package com.finsight;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;
@Entity @Table(name = "accounts")
class Account {
    @Id UUID id;
    @Column(nullable = false) UUID userId;
    @Column(nullable = false) String name;
    @Column(nullable = false) String currency;
    @Column(nullable = false, precision = 19, scale = 2) BigDecimal startingBalance;
    @Version long version;
    protected Account() {}
}
