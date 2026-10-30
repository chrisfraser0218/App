package com.finsight;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/insights")
class SpendingController {
    private final SpendingService spending;
    SpendingController(SpendingService spending){this.spending=spending;}
    @GetMapping SpendingModels.Report get(@RequestParam(required=false)String range,@RequestParam(required=false)LocalDate from,@RequestParam(required=false)LocalDate to){return spending.report(spending.period(range,from,to));}
    @GetMapping("/transactions") SpendingModels.EvidencePage transactions(@RequestParam LocalDate from,@RequestParam LocalDate to,@RequestParam(required=false)UUID categoryId){return spending.transactions(spending.period("custom",from,to),categoryId);}
}
