package com.finsight;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.net.URI;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.*;

/** Sends only owned expense feature IDs, dates and integer cents to the local stateless service. */
@Component
class SpendingAiClient {
    record Feature(UUID id,@JsonFormat(shape=JsonFormat.Shape.STRING) LocalDate date,@JsonProperty("amount_cents") long cents,@JsonProperty("category_id") UUID categoryId,
                   @JsonProperty("recurring_rule_id") UUID ruleId) {}
    record Input(@JsonFormat(shape=JsonFormat.Shape.STRING) LocalDate start,@JsonFormat(shape=JsonFormat.Shape.STRING) LocalDate end,List<Feature> expenses) {}
    record Signal(@JsonProperty("transaction_id") UUID transactionId,String method,@JsonProperty("baseline_ids") List<UUID> baselineIds) {}
    record Result(@JsonProperty("method_version") String version,@JsonProperty("min_history") int minHistory,int eligible,int insufficient,List<Signal> alerts,boolean truncated) {}
    private final RestClient client;
    SpendingAiClient(String url,int connect,int read){this(url,connect,read,"");}
    @org.springframework.beans.factory.annotation.Autowired
    SpendingAiClient(@Value("${ai.base-url:http://127.0.0.1:8000}")String url,@Value("${ai.connect-timeout-ms:500}")int connect,
                     @Value("${ai.read-timeout-ms:1500}")int read,@Value("${ai.session-token:}") String token) {
        URI uri=URI.create(url);
        if(!"http".equals(uri.getScheme())||!Set.of("localhost","127.0.0.1","[::1]","::1").contains(uri.getHost())||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)
            throw new IllegalArgumentException("Spending analysis must use a local HTTP service");
        if(connect<1||read<1)throw new IllegalArgumentException("Timeouts must be positive");
        var factory=new SimpleClientHttpRequestFactory();factory.setConnectTimeout(Duration.ofMillis(connect));factory.setReadTimeout(Duration.ofMillis(read));
        client=RestClient.builder().baseUrl(url).requestFactory(factory).defaultHeader("X-FinSight-AI",token).build();
    }
    Optional<Result> analyze(Input input) {
        try {
            var r=client.post().uri("/analyze-spending").contentType(MediaType.APPLICATION_JSON).body(input).retrieve().body(Result.class);
            if(r==null||!"robust-mad-v1".equals(r.version())||r.minHistory()!=8||r.eligible()<0||r.insufficient()<0||r.alerts()==null||r.alerts().size()>200)return Optional.empty();
            return Optional.of(r);
        }catch(RestClientException|IllegalArgumentException e){return Optional.empty();} // No payload/response logging.
    }
}
