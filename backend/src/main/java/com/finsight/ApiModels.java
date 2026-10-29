package com.finsight;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
public final class ApiModels {
    private ApiModels() {}
    public record TransactionInput(
        @NotBlank @Size(max = 160) String description,
        @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount,
        @NotNull TransactionType type,
        @NotNull UUID categoryId,
        @NotNull @PastOrPresent LocalDate date) {}
    public record BalanceInput(@NotNull @Digits(integer = 12, fraction = 2) BigDecimal startingBalance) {}
    public record TransactionView(UUID id, String description, BigDecimal amount, TransactionType type,
                                  UUID categoryId, LocalDate date) {}
    public record CategoryView(UUID id, String name, TransactionType type) {}
    public record AccountView(UUID id, String name, String currency, BigDecimal startingBalance,
                              BigDecimal income, BigDecimal expenses, BigDecimal balance) {}
    public record CategoryTotal(UUID categoryId, String name, BigDecimal amount) {}
    public record MonthlySummary(String month, BigDecimal income, BigDecimal expenses, List<CategoryTotal> categories) {}
}
