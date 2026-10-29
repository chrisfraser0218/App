package com.finsight;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
interface AccountRepository extends JpaRepository<Account, UUID> {
    Optional<Account> findByIdAndUserId(UUID id, UUID userId);
}
interface CategoryRepository extends JpaRepository<Category, UUID> {
    List<Category> findByUserIdOrderByName(UUID userId);
    Optional<Category> findByIdAndUserId(UUID id, UUID userId);
}
interface TransactionRepository extends JpaRepository<Transaction, UUID> {
    List<Transaction> findByUserIdAndAccountIdOrderByTransactionDateDescCreatedAtDescIdDesc(UUID userId, UUID accountId);
    Optional<Transaction> findByIdAndUserIdAndAccountId(UUID id, UUID userId, UUID accountId);
}
