package com.finsight;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
interface AccountRepository extends JpaRepository<Account, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Account a where a.id = :id and a.userId = :userId")
    Optional<Account> lockOwned(@Param("id") UUID id, @Param("userId") UUID userId);
    Optional<Account> findByIdAndUserId(UUID id, UUID userId);
}
interface CategoryRepository extends JpaRepository<Category, UUID> {
    List<Category> findByUserIdOrderByName(UUID userId);
    Optional<Category> findByIdAndUserId(UUID id, UUID userId);
}
interface TransactionRepository extends JpaRepository<Transaction, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Transaction t where t.id = :id and t.userId = :userId and t.accountId = :accountId")
    Optional<Transaction> lockOwned(@Param("id") UUID id, @Param("userId") UUID userId, @Param("accountId") UUID accountId);
    List<Transaction> findByUserIdAndAccountIdOrderByTransactionDateDescCreatedAtDescIdDesc(UUID userId, UUID accountId);
    Optional<Transaction> findByIdAndUserIdAndAccountId(UUID id, UUID userId, UUID accountId);
}

interface RecurringRuleRepository extends JpaRepository<RecurringRule, UUID> {
    List<RecurringRule> findByUserIdAndAccountIdOrderByCreatedAtDesc(UUID userId, UUID accountId);
    Optional<RecurringRule> findByUserIdAndRequestId(UUID userId, UUID requestId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from RecurringRule r where r.id = :id and r.userId = :userId and r.accountId = :accountId")
    Optional<RecurringRule> lockOwned(@Param("id") UUID id, @Param("userId") UUID userId, @Param("accountId") UUID accountId);
    @Query("select r.id from RecurringRule r where r.userId = :userId and r.accountId = :accountId and r.enabled = true and r.archived = false and r.nextDate <= :today order by r.id")
    List<UUID> dueIds(@Param("userId") UUID userId, @Param("accountId") UUID accountId, @Param("today") java.time.LocalDate today);
}

interface PlannedTransactionRepository extends JpaRepository<PlannedTransaction,UUID> {
    List<PlannedTransaction> findByUserIdAndAccountIdOrderByPlannedDateAscCreatedAtAsc(UUID userId, UUID accountId);
    Optional<PlannedTransaction> findByUserIdAndRequestId(UUID userId, UUID requestId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PlannedTransaction p where p.id=:id and p.userId=:userId and p.accountId=:accountId")
    Optional<PlannedTransaction> lockOwned(@Param("id") UUID id,@Param("userId") UUID userId,@Param("accountId") UUID accountId);
}
