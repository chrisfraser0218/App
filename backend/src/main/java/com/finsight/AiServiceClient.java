package com.finsight;

import java.time.Duration;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import static com.finsight.AiModels.*;

/** Bounded, optional dependency. Ledger mutations never call the model service. */
@Component
class AiServiceClient {
    private final RestClient client;

    AiServiceClient(String url,int connect,int read){this(url,connect,read,"");}
    @org.springframework.beans.factory.annotation.Autowired
    AiServiceClient(@Value("${ai.base-url:http://127.0.0.1:8000}") String baseUrl,
                    @Value("${ai.connect-timeout-ms:500}") int connectTimeout,
                    @Value("${ai.read-timeout-ms:1500}") int readTimeout,@Value("${ai.session-token:}") String token) {
        if (connectTimeout < 1 || readTimeout < 1) throw new IllegalArgumentException("AI timeouts must be positive");
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(connectTimeout));
        factory.setReadTimeout(Duration.ofMillis(readTimeout));
        client = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).defaultHeader("X-FinSight-AI",token).build();
    }

    Optional<ModelPrediction> predict(PredictionInput input) {
        try {
            ModelPrediction result = client.post().uri("/predict-category")
                .contentType(MediaType.APPLICATION_JSON).body(input).retrieve().body(ModelPrediction.class);
            if (result == null || result.confidence() == null || !Double.isFinite(result.confidence())
                || result.confidence() < 0 || result.confidence() > 1
                || result.modelVersion() == null || result.modelVersion().isBlank() || result.modelVersion().length() > 60
                || result.status() == null || !Set.of("suggested", "uncertain", "unknown").contains(result.status())
                || (result.status().equals("suggested") && (result.category() == null || result.category().length() > 60))
                || (!result.status().equals("suggested") && result.category() != null)) return Optional.empty();
            return Optional.of(result);
        } catch (RestClientException | IllegalArgumentException ex) {
            // Deliberately do not log descriptions, amounts or upstream response bodies.
            return Optional.empty();
        }
    }
}
