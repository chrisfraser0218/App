package com.finsight;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/assistant")
class AssistantController {
    private final AssistantService assistant;
    AssistantController(AssistantService assistant){this.assistant=assistant;}
    /** POST carries a private question, but this operation is strictly read-only and not stored. */
    @PostMapping("/questions") AssistantModels.Answer ask(@Valid @RequestBody AssistantModels.Question input){return assistant.ask(input);}
}
