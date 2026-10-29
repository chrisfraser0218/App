package com.finsight;

import java.time.*;
import org.springframework.context.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.slf4j.LoggerFactory;
import static com.finsight.RecurringModels.*;

@Configuration @EnableScheduling
class RecurringClockConfig {
    @Bean Clock recurringClock(@Value("${recurring.time-zone:America/New_York}") String zone) {
        return Clock.system(ZoneId.of(zone));
    }
}

@Component
class RecurringProcessor {
    private final RecurringRuleService rules;
    RecurringProcessor(RecurringRuleService rules) { this.rules = rules; }
    ProcessResult processDue() {
        int posted = 0; int failed = 0;
        for (var id : rules.dueIds()) {
            try { posted += rules.processOne(id); }
            catch (RuntimeException ex) {
                failed++;
                LoggerFactory.getLogger(RecurringProcessor.class).warn("A recurring schedule could not be processed; it will retry. No financial payload is logged.");
            }
        }
        return new ProcessResult(posted, rules.dueIds().size(), failed);
    }
}

@Component
@ConditionalOnProperty(name = "recurring.processing.enabled", havingValue = "true", matchIfMissing = true)
class RecurringScheduleRunner {
    private final RecurringProcessor processor;
    RecurringScheduleRunner(RecurringProcessor processor) { this.processor = processor; }
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() { tick(); }
    @Scheduled(initialDelayString = "${recurring.poll-delay-ms:30000}", fixedDelayString = "${recurring.poll-delay-ms:30000}")
    public void tick() {
        try { processor.processDue(); }
        catch (RuntimeException ex) { LoggerFactory.getLogger(getClass()).warn("Recurring processing is temporarily unavailable; it will retry."); }
    }
}
