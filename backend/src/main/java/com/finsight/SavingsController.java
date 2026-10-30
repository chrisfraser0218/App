package com.finsight;
import java.util.UUID;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import static com.finsight.SavingsModels.*;
@RestController @RequestMapping("/api/savings-goals")
class SavingsController {
 private final SavingsService savings;
 SavingsController(SavingsService savings){this.savings=savings;}
 @GetMapping Dashboard list(){return savings.dashboard();}
 @GetMapping("/{id}") Detail detail(@PathVariable UUID id){return savings.detail(id);}
 @PostMapping @ResponseStatus(HttpStatus.CREATED) Detail create(@Valid @RequestBody GoalInput input){return savings.create(input);}
 @PutMapping("/{id}") Detail update(@PathVariable UUID id,@Valid @RequestBody GoalUpdate input){return savings.update(id,input);}
 @PostMapping("/{id}/state") Detail state(@PathVariable UUID id,@Valid @RequestBody StateInput input){return savings.state(id,input);}
 @PostMapping("/{id}/entries") @ResponseStatus(HttpStatus.CREATED) Detail record(@PathVariable UUID id,@Valid @RequestBody EntryRequest input){return savings.record(id,input);}
 @PostMapping("/{id}/entries/{entryId}/correct") Detail correct(@PathVariable UUID id,@PathVariable UUID entryId,@Valid @RequestBody Correction input){return savings.correct(id,entryId,input);}
 @PutMapping("/{id}/schedule") Detail schedule(@PathVariable UUID id,@Valid @RequestBody ScheduleInput input){return savings.saveSchedule(id,input);}
}
