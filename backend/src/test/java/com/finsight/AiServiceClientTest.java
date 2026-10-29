package com.finsight;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.*;
import static com.finsight.AiModels.*;

class AiServiceClientTest {
    HttpServer server;
    AtomicReference<String> request = new AtomicReference<>();
    String body;
    int status;
    long delay;
    AiServiceClient client;

    @BeforeEach void setup() throws Exception {
        body = "{\"category\":\"Food & Drinks\",\"confidence\":0.73,\"model_version\":\"1.0\",\"status\":\"suggested\"}";
        status = 200; delay = 0;
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/predict-category", exchange -> {
            request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            try { Thread.sleep(delay); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (var out = exchange.getResponseBody()) { out.write(bytes); }
        });
        server.start();
        client = new AiServiceClient("http://127.0.0.1:" + server.getAddress().getPort(), 100, 100);
    }
    @AfterEach void stop() { server.stop(0); }
    PredictionInput input() { return new PredictionInput("Starbucks Coffee", new BigDecimal("8.75")); }
    @Test void sendsContractAndPreservesActualConfidence() {
        var result = client.predict(input()).orElseThrow();
        assertThat(result.category()).isEqualTo("Food & Drinks");
        assertThat(result.confidence()).isEqualTo(0.73);
        assertThat(request.get()).contains("Starbucks Coffee").contains("8.75");
    }
    @Test void handlesServerErrors() { status = 503; assertThat(client.predict(input())).isEmpty(); }
    @Test void handlesMalformedJson() { body = "invalid"; assertThat(client.predict(input())).isEmpty(); }
    @Test void handlesInvalidContract() { body = "{\"confidence\":1.8}"; assertThat(client.predict(input())).isEmpty(); }
    @Test void timesOutInsteadOfBlockingLedger() {
        delay = 400;
        long start = System.nanoTime();
        assertThat(client.predict(input())).isEmpty();
        assertThat((System.nanoTime() - start) / 1_000_000).isLessThan(1500);
    }
    @Test void handlesConnectionRefusal() {
        server.stop(0);
        assertThat(client.predict(input())).isEmpty();
    }
}
