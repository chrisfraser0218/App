package com.finsight;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.*;
class SpendingAiClientTest {
 HttpServer server;String body;int status;long delay;SpendingAiClient client;AtomicReference<String> request=new AtomicReference<>();
 @BeforeEach void setup()throws Exception{body="{\"method_version\":\"robust-mad-v1\",\"min_history\":8,\"eligible\":0,\"insufficient\":1,\"alerts\":[],\"truncated\":false}";status=200;delay=0;server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/analyze-spending",e->{request.set(new String(e.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));try{Thread.sleep(delay);}catch(InterruptedException x){Thread.currentThread().interrupt();}byte[] bytes=body.getBytes(StandardCharsets.UTF_8);e.getResponseHeaders().set("Content-Type","application/json");e.sendResponseHeaders(status,bytes.length);try(var out=e.getResponseBody()){out.write(bytes);}});server.start();client=new SpendingAiClient("http://127.0.0.1:"+server.getAddress().getPort(),100,100);}
 @AfterEach void stop(){server.stop(0);}
 SpendingAiClient.Input input(){return new SpendingAiClient.Input(LocalDate.parse("2026-10-01"),LocalDate.parse("2026-10-15"),List.of(new SpendingAiClient.Feature(UUID.randomUUID(),LocalDate.parse("2026-10-01"),1234,UUID.randomUUID(),null)));}
 @Test void exactFeatureContractContainsNoDescriptionsOrBalances(){assertThat(client.analyze(input())).isPresent();assertThat(request.get()).contains("amount_cents", "1234", "category_id", "\"start\":\"2026-10-01\"", "\"end\":\"2026-10-15\"", "\"date\":\"2026-10-01\"").doesNotContain("description","balance");}
 @Test void malformedAndInvalidVersionAreUnavailable(){body="invalid";assertThat(client.analyze(input())).isEmpty();body="{\"method_version\":\"unknown\"}";assertThat(client.analyze(input())).isEmpty();}
 @Test void timeoutAndServerErrorsDoNotBreakFacts(){delay=400;long start=System.nanoTime();assertThat(client.analyze(input())).isEmpty();assertThat((System.nanoTime()-start)/1_000_000).isLessThan(1500);}
 @Test void unavailableServiceIsOptional(){server.stop(0);assertThat(client.analyze(input())).isEmpty();}
 @Test void upstreamErrorsAreUnavailable(){status=503;assertThat(client.analyze(input())).isEmpty();}
 @Test void remoteServiceUrlsAreRefused(){assertThatThrownBy(()->new SpendingAiClient("https://remote.invalid",100,100)).isInstanceOf(IllegalArgumentException.class);assertThatThrownBy(()->new SpendingAiClient("http://127.0.0.1",0,100)).isInstanceOf(IllegalArgumentException.class);}
}
