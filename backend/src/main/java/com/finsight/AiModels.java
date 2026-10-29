package com.finsight;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.UUID;

public final class AiModels {
    private AiModels() {}

    public record PredictionInput(
        @NotBlank @Size(min = 2, max = 160) String description,
        @NotNull @DecimalMin("0.01") @Digits(integer = 12, fraction = 2) BigDecimal amount) {}

    public record ModelPrediction(String category, Double confidence,
        @JsonProperty("model_version") String modelVersion, String status) {}

    public record PredictionView(UUID predictionId, String category, UUID categoryId, String categoryName,
        Double confidence, String modelVersion, String status) {
        static PredictionView unavailable() {
            return new PredictionView(null, null, null, null, null, null, "unavailable");
        }
    }
}
