package com.finsight;

import com.fasterxml.jackson.databind.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.*;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Real session/CSRF/login boundary. No legacy test identity or security bypass. */
@SpringBootTest(properties="authentication.attempts-per-minute=500")
@AutoConfigureMockMvc @ActiveProfiles("test")
@ContextConfiguration(initializers=IsolatedDatabaseGuard.class) @Transactional
class AuthenticationApiTest {
    @Autowired MockMvc mvc; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc;
    static final String PASSWORD="Synthetic local test password";
    String name(){return "u"+UUID.randomUUID().toString().replace("-","").substring(0,20);}
    class Client {
        MockHttpSession session=new MockHttpSession();
        String username;
        ResultActions get(String path)throws Exception {return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path).session(session));}
        ResultActions mutate(String method,String path,Object body)throws Exception {
            var csrf=get("/api/auth/csrf").andExpect(status().isOk()).andReturn();
            String token=json.readTree(csrf.getResponse().getContentAsString()).path("token").asText();
            return mvc.perform(request(org.springframework.http.HttpMethod.valueOf(method),path).session(session)
                .contentType("application/json").header("X-CSRF-TOKEN",token).content(json.writeValueAsBytes(body)));
        }
        Client register()throws Exception {username=name();mutate("POST","/api/auth/register",Map.of("username",username,"password",PASSWORD,"confirmPassword",PASSWORD)).andExpect(status().isCreated());return this;}
        JsonNode body(ResultActions result)throws Exception {return json.readTree(result.andReturn().getResponse().getContentAsString());}
        UUID owner(){return jdbc.queryForObject("SELECT id FROM users WHERE username=?",UUID.class,username);}
        String category(String type)throws Exception {return body(mutate("POST","/api/categories",Map.of("name",type+" own","type",type)).andExpect(status().isCreated())).path("id").asText();}
    }
    @Test void registrationCreatesOnlyAnEmptyZeroBalanceAccount()throws Exception {
        var c=new Client().register();
        c.get("/api/auth/me").andExpect(jsonPath("$.username").value(c.username));
        c.get("/api/account").andExpect(jsonPath("$.startingBalance").value(0)).andExpect(jsonPath("$.balance").value(0));
        for(String route:List.of("transactions","categories","recurring-transactions","planned-transactions"))c.get("/api/"+route).andExpect(status().isOk()).andExpect(content().json("[]"));
        for(String table:List.of("transactions","categories","recurring_rules","recurring_occurrences","planned_transactions","forecast_preferences","category_predictions","category_prediction_feedback","recurring_prediction_feedback","savings_goals","savings_entries","savings_schedules","savings_corrections"))
            assertThat(jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE user_id=?",Integer.class,c.owner())).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM accounts WHERE user_id=?",Integer.class,c.owner())).isOne();
    }
    @Test void usernamesAreCaseInsensitiveAndUnique()throws Exception {
        var c=new Client().register();
        new Client().mutate("POST","/api/auth/register",Map.of("username",c.username.toUpperCase(Locale.ROOT),"password",PASSWORD,"confirmPassword",PASSWORD)).andExpect(status().isConflict());
    }
    @Test void validatesUsernamePasswordAndConfirmation()throws Exception {
        var c=new Client();
        for(String name:List.of("ab"," bad","3bad","a/b","a".repeat(33)))
            c.mutate("POST","/api/auth/register",Map.of("username",name,"password",PASSWORD,"confirmPassword",PASSWORD)).andExpect(status().isBadRequest());
        c.mutate("POST","/api/auth/register",Map.of("username",name(),"password","short","confirmPassword","short")).andExpect(status().isBadRequest());
        c.mutate("POST","/api/auth/register",Map.of("username",name(),"password",PASSWORD,"confirmPassword",PASSWORD+"x")).andExpect(status().isBadRequest());
    }
    @Test void storesOnlyVersionedSaltedHashesAndSupportsLongPasswords()throws Exception {
        var c=new Client().register();String hash=jdbc.queryForObject("SELECT password_hash FROM users WHERE username=?",String.class,c.username);
        assertThat(hash).startsWith("$argon2id$v=19$m=19456,t=2,p=1$").doesNotContain(PASSWORD);
        assertThat(LocalPasswords.matches(PASSWORD,hash)).isTrue();
        assertThat(LocalPasswords.encode(PASSWORD)).isNotEqualTo(hash);
        String longPassword="a".repeat(500)+"suffix";
        hash=LocalPasswords.encode(longPassword);
        assertThat(LocalPasswords.matches(longPassword,hash)).isTrue();
        assertThat(LocalPasswords.matches("a".repeat(500)+"different",hash)).isFalse();
    }
    @Test void successfulLoginRotatesSessionAndLogoutRetainsRecords()throws Exception {
        var c=new Client().register();String category=c.category("INCOME");
        c.mutate("POST","/api/transactions",Map.of("description","Synthetic income","amount","123.45","type","INCOME","categoryId",category,"date",LocalDate.now().toString())).andExpect(status().isCreated());
        UUID owner=c.owner();c.mutate("POST","/api/auth/logout",Map.of()).andExpect(status().isNoContent());assertThat(c.session.isInvalid()).isTrue();
        c.session=new MockHttpSession();String old=c.session.getId();
        c.mutate("POST","/api/auth/login",Map.of("username",c.username.toUpperCase(Locale.ROOT),"password",PASSWORD)).andExpect(status().isOk());
        assertThat(c.session.getId()).isNotEqualTo(old);
        c.get("/api/account").andExpect(jsonPath("$.balance").value(123.45));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM transactions WHERE user_id=?",Integer.class,owner)).isOne();
    }
    @Test void wrongAndUnknownCredentialsHaveTheSameError()throws Exception {
        var a=new Client().register();var b=new Client();
        var wrong=b.mutate("POST","/api/auth/login",Map.of("username",a.username,"password","wrong password")).andExpect(status().isUnauthorized()).andReturn().getResponse();
        var absent=b.mutate("POST","/api/auth/login",Map.of("username",name(),"password","wrong password")).andExpect(status().isUnauthorized()).andReturn().getResponse();
        assertThat(wrong.getContentAsString()).isEqualTo(absent.getContentAsString());
        b.get("/api/account").andExpect(status().isUnauthorized());
    }
    @Test void unauthenticatedFinancialApisAreDenied()throws Exception {
        var c=new Client();
        for(String route:List.of("account","categories","transactions","recurring-transactions","planned-transactions","forecast-preferences","forecasts","calendar","savings-goals","insights","backups","auth/me","auth/session"))
            c.get("/api/"+route).andExpect(status().isUnauthorized());
        c.mutate("POST","/api/assistant/questions",Map.of("question","Current actual balance")).andExpect(status().isUnauthorized());
    }
    @Test void csrfIsRequiredForRegistrationAndAuthenticatedWrites()throws Exception {
        mvc.perform(post("/api/auth/register").contentType("application/json").content("{}")).andExpect(status().isForbidden());
        var c=new Client().register();
        mvc.perform(put("/api/account/starting-balance").session(c.session).contentType("application/json").content("{\"startingBalance\":\"10.00\"}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout").session(c.session).contentType("application/json").header("X-CSRF-TOKEN","incorrect").content("{}")).andExpect(status().isForbidden());
        c.get("/api/account").andExpect(jsonPath("$.balance").value(0));
    }
    @Test void credentialChangeInvalidatesExistingSessions()throws Exception {
        var c=new Client().register();jdbc.update("UPDATE users SET credential_version=credential_version+1 WHERE id=?",c.owner());
        c.get("/api/account").andExpect(status().isUnauthorized());assertThat(c.session.isInvalid()).isTrue();
    }
    @Test void absoluteSessionExpiryDoesNotDeleteData()throws Exception {
        var c=new Client().register();UUID owner=c.owner();
        var context=(SecurityContext)c.session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        var old=(CurrentIdentity.Owner)context.getAuthentication().getPrincipal();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(new CurrentIdentity.Owner(old.userId(),old.accountId(),old.username(),old.credentialVersion(),Instant.now().minus(Duration.ofHours(13))),null,List.of()));
        c.get("/api/auth/session").andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM accounts WHERE user_id=?",Integer.class,owner)).isOne();
    }
    @Test void invalidatedIdleSessionRequiresLogin()throws Exception {
        var c=new Client().register();assertThat(c.session.getMaxInactiveInterval()).isEqualTo(1800);
        c.session.invalidate();c.session=new MockHttpSession();c.get("/api/account").andExpect(status().isUnauthorized());
    }
    @Test void financialWritesUseOnlyTheAuthenticatedOwner()throws Exception {
        var a=new Client().register();var b=new Client().register();String category=a.category("EXPENSE");
        var transaction=Map.of("description","Synthetic private expense","amount","10.25","type","EXPENSE","categoryId",category,"date",LocalDate.now().toString());
        String id=a.body(a.mutate("POST","/api/transactions",transaction).andExpect(status().isCreated())).path("id").asText();
        b.get("/api/transactions/"+id).andExpect(status().isNotFound());
        b.mutate("PUT","/api/transactions/"+id,transaction).andExpect(status().isNotFound());
        b.mutate("DELETE","/api/transactions/"+id,Map.of()).andExpect(status().isNotFound());
        b.mutate("POST","/api/transactions",transaction).andExpect(status().isBadRequest());
        b.mutate("PUT","/api/account/starting-balance",Map.of("startingBalance","20.00","accountId",a.body(a.get("/api/account")).path("id").asText())).andExpect(status().isBadRequest());
        b.get("/api/account").andExpect(jsonPath("$.balance").value(0));a.get("/api/account").andExpect(jsonPath("$.balance").value(-10.25));
    }
    @Test void recurringPlanSavingsAndForecastOwnersAreIsolated()throws Exception {
        var a=new Client().register();var b=new Client().register();String category=a.category("EXPENSE");String today=LocalDate.now().toString(),tomorrow=LocalDate.now().plusDays(1).toString();
        var recurring=new HashMap<String,Object>(Map.of("description","Synthetic private bill","amount","42.00","type","EXPENSE","categoryId",category,"frequency","DAILY","startDate",tomorrow,"enabled",true,"requestId",UUID.randomUUID().toString(),"backfillConfirmed",false));
        String rule=a.body(a.mutate("POST","/api/recurring-transactions",recurring).andExpect(status().isCreated())).path("id").asText();
        b.get("/api/recurring-transactions/"+rule).andExpect(status().isNotFound());b.get("/api/recurring-transactions/"+rule+"/history").andExpect(status().isNotFound());
        b.get("/api/recurring-transactions").andExpect(content().json("[]"));
        String plan=a.body(a.mutate("POST","/api/planned-transactions",Map.of("description","Synthetic private plan","amount","18.00","type","EXPENSE","categoryId",category,"date",tomorrow,"requestId",UUID.randomUUID().toString())).andExpect(status().isCreated())).path("id").asText();
        b.get("/api/planned-transactions").andExpect(content().json("[]"));
        b.mutate("POST","/api/planned-transactions/"+plan+"/complete",Map.of("mode","HANDLED","requestId",UUID.randomUUID().toString(),"version",0)).andExpect(status().isNotFound());
        String goal=a.body(a.mutate("POST","/api/savings-goals",Map.of("name","Private synthetic goal","description","Private","targetAmount","500.00","requestId",UUID.randomUUID().toString())).andExpect(status().isCreated())).path("goal").path("id").asText();
        b.get("/api/savings-goals/"+goal).andExpect(status().isNotFound());b.get("/api/savings-goals").andExpect(jsonPath("$.goals").isEmpty());
        a.mutate("PUT","/api/forecast-preferences",Map.of("lowBalanceThreshold","777.00","version",0)).andExpect(status().isOk());
        b.get("/api/forecast-preferences").andExpect(jsonPath("$.lowBalanceThreshold").value("100.00"));
        String forecast=b.body(b.get("/api/forecasts?months=1").andExpect(status().isOk())).toString();
        assertThat(forecast).doesNotContain(rule,plan,"Synthetic private");
        b.get("/api/forecasts?months=1").andExpect(jsonPath("$.summary.currentActualBalance").value("0.00")).andExpect(jsonPath("$.summary.projectedBalance").value("0.00"));
        String calendar=b.body(b.get("/api/calendar?month="+today.substring(0,7)).andExpect(status().isOk())).toString();assertThat(calendar).doesNotContain(rule,plan,"Synthetic private");
    }
    @Test void insightsAssistantAndCategoriesNeverExposeOtherOwners()throws Exception {
        var a=new Client().register();var b=new Client().register();String cat=a.category("EXPENSE");
        a.mutate("POST","/api/transactions",Map.of("description","Private synthetic marker","amount","888.88","type","EXPENSE","categoryId",cat,"date",LocalDate.now().toString())).andExpect(status().isCreated());
        String insights=b.body(b.get("/api/insights").andExpect(status().isOk())).toString();assertThat(insights).doesNotContain("Private synthetic marker",cat,"888.88");
        String answer=b.body(b.mutate("POST","/api/assistant/questions",Map.of("question","How much did I spend this month?")).andExpect(status().isOk())).toString();assertThat(answer).doesNotContain("Private synthetic marker",cat,"888.88");
        b.get("/api/categories").andExpect(content().json("[]"));
    }
    @Test void legacyFinancialRowsAreUnchangedByRegistration()throws Exception {
        var rows=jdbc.queryForList("SELECT * FROM transactions WHERE user_id=? ORDER BY id",DemoIdentity.USER_ID);
        var accounts=jdbc.queryForList("SELECT * FROM accounts WHERE user_id=? ORDER BY id",DemoIdentity.USER_ID);
        new Client().register();
        assertThat(jdbc.queryForList("SELECT * FROM transactions WHERE user_id=? ORDER BY id",DemoIdentity.USER_ID)).isEqualTo(rows);
        assertThat(jdbc.queryForList("SELECT * FROM accounts WHERE user_id=? ORDER BY id",DemoIdentity.USER_ID)).isEqualTo(accounts);
    }
}
