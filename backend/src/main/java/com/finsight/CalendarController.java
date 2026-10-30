package com.finsight;

import java.time.YearMonth;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api/calendar")
class CalendarController {
    private final CalendarService calendar;
    CalendarController(CalendarService calendar) { this.calendar = calendar; }
    @GetMapping CalendarModels.Month month(@RequestParam(required = false) String month) {
        try { return calendar.month(month == null ? null : YearMonth.parse(month)); }
        catch (java.time.DateTimeException error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Use a valid calendar month in YYYY-MM format"); }
    }
}
