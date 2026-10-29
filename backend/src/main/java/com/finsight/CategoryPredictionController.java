package com.finsight;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import static com.finsight.AiModels.*;

@RestController
@RequestMapping("/api/category-predictions")
class CategoryPredictionController {
    private final CategoryPredictionService predictions;
    CategoryPredictionController(CategoryPredictionService predictions) { this.predictions = predictions; }

    @PostMapping
    PredictionView predict(@Valid @RequestBody PredictionInput input) { return predictions.predict(input); }
}
