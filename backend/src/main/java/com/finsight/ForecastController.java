package com.finsight;

import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.web.bind.annotation.*;
import static com.finsight.ForecastModels.*;

@RestController @RequestMapping("/api")
class ForecastController {
    private final ForecastService forecast;
    private final PlannedTransactionService plans;
    ForecastController(ForecastService forecast,PlannedTransactionService plans){this.forecast=forecast;this.plans=plans;}
    @GetMapping("/forecasts") Forecast get(@RequestParam(required=false) Integer months,@RequestParam(required=false) LocalDate endDate){return forecast.forecast(forecast.resolveEnd(months,endDate));}
    @GetMapping("/forecasts/monthly") List<Month> monthly(@RequestParam(required=false) Integer months,@RequestParam(required=false) LocalDate endDate){return get(months,endDate).months();}
    @GetMapping("/forecasts/daily/{date}") Day daily(@PathVariable LocalDate date) {
        if(date.isBefore(forecast.today()))throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,"Daily forecast date cannot be before today");
        return forecast.forecast(date.equals(forecast.today())?date.plusDays(1):date).days().stream().filter(d->d.date().equals(date)).findFirst().orElseThrow();
    }
    @PostMapping("/forecasts/scenarios") Comparison scenario(@Valid @RequestBody ScenarioInput input){return forecast.evaluate(input);}
    @GetMapping("/forecast-preferences") Preferences preferences(){return forecast.preferences();}
    @PutMapping("/forecast-preferences") Preferences preferences(@Valid @RequestBody PreferenceInput input){return forecast.savePreferences(input);}
    @GetMapping("/planned-transactions") List<PlanView> plans(){return plans.list();}
    @PostMapping("/planned-transactions") @ResponseStatus(org.springframework.http.HttpStatus.CREATED) PlanView create(@Valid @RequestBody PlanInput input){return plans.create(input);}
    @PutMapping("/planned-transactions/{id}") PlanView update(@PathVariable java.util.UUID id,@Valid @RequestBody PlanUpdate input){return plans.update(id,input);}
    @PostMapping("/planned-transactions/{id}/cancel") PlanView cancel(@PathVariable java.util.UUID id,@Valid @RequestBody VersionInput input){return plans.cancel(id,input);}
    @PostMapping("/planned-transactions/{id}/complete") PlanView complete(@PathVariable java.util.UUID id,@Valid @RequestBody CompletionInput input){return plans.complete(id,input);}
}
