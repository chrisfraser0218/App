package com.finsight;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.web.server.ResponseStatusException;
import java.net.URI;
import java.time.*;
import java.time.format.DateTimeParseException;
import java.util.*;
import static com.finsight.ApiModels.*;
@RestController @RequestMapping("/api")
class FinanceController {
    private final FinanceService service;
    FinanceController(FinanceService service) { this.service = service; }
    @GetMapping("/categories") List<CategoryView> categories() { return service.categories(); }
    @GetMapping("/account") AccountView account() { return service.account(); }
    @PutMapping("/account/starting-balance") AccountView balance(@Valid @RequestBody BalanceInput input) { return service.setBalance(input); }
    @GetMapping("/transactions") List<TransactionView> list() { return service.list(); }
    @GetMapping("/transactions/{id}") TransactionView get(@PathVariable UUID id) { return service.get(id); }
    @PostMapping("/transactions") ResponseEntity<TransactionView> create(@Valid @RequestBody TransactionInput input) {
        TransactionView result = service.create(input);
        return ResponseEntity.created(URI.create("/api/transactions/" + result.id())).body(result);
    }
    @PutMapping("/transactions/{id}") TransactionView update(@PathVariable UUID id, @Valid @RequestBody TransactionInput input) { return service.update(id, input); }
    @DeleteMapping("/transactions/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) void delete(@PathVariable UUID id) { service.delete(id); }
    @GetMapping("/summaries/monthly") MonthlySummary summary(@RequestParam(required = false) String month) {
        try { return service.summary(month == null ? YearMonth.now() : YearMonth.parse(month)); }
        catch (DateTimeParseException ex) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Use a month in YYYY-MM format"); }
    }
}
