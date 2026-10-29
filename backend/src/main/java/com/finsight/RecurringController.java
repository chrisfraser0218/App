package com.finsight;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import static com.finsight.RecurringModels.*;

@RestController @RequestMapping("/api/recurring-transactions")
class RecurringController {
    private final RecurringRuleService service;
    private final RecurringProcessor processor;
    RecurringController(RecurringRuleService service, RecurringProcessor processor) { this.service = service; this.processor = processor; }
    @GetMapping List<RuleView> list() { return service.list(); }
    @GetMapping("/{id}") RuleView get(@PathVariable UUID id) { return service.get(id); }
    @PostMapping ResponseEntity<RuleView> create(@Valid @RequestBody RuleInput input) {
        RuleView result = service.create(input);
        return ResponseEntity.created(URI.create("/api/recurring-transactions/" + result.id())).body(result);
    }
    @PutMapping("/{id}") RuleView update(@PathVariable UUID id, @Valid @RequestBody RuleUpdate input) { return service.update(id, input); }
    @PutMapping("/{id}/state") RuleView state(@PathVariable UUID id, @Valid @RequestBody StateInput input) { return service.setEnabled(id, input); }
    @PostMapping("/{id}/stop") RuleView stop(@PathVariable UUID id, @Valid @RequestBody ArchiveInput input) { return service.archive(id, input); }
    @GetMapping("/{id}/history") List<OccurrenceView> history(@PathVariable UUID id) { return service.history(id); }
    @GetMapping("/{id}/occurrences") List<OccurrenceView> occurrences(@PathVariable UUID id,
        @RequestParam java.time.LocalDate from, @RequestParam java.time.LocalDate to) { return service.occurrences(id, from, to); }
    @PostMapping("/{id}/reconcile") OccurrenceView reconcile(@PathVariable UUID id, @Valid @RequestBody ReconcileInput input) { return service.reconcile(id, input); }
    @PostMapping("/process-due") ProcessResult process() { return processor.processDue(); }
}
