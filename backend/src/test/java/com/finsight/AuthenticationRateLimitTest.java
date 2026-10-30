package com.finsight;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockHttpSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="authentication.attempts-per-minute=3") @AutoConfigureMockMvc @ActiveProfiles("test")
@ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
class AuthenticationRateLimitTest {
    @Autowired MockMvc mvc; @Autowired ObjectMapper json;
    @Test void repeatedAttemptsAreBoundedAcrossUsernamesAndSessions() throws Exception {
        for(int i=0;i<4;i++) {
            var session=new MockHttpSession();
            var response=mvc.perform(get("/api/auth/csrf").session(session)).andReturn().getResponse();
            String token=json.readTree(response.getContentAsString()).path("token").asText();
            mvc.perform(post("/api/auth/login").session(session).contentType("application/json")
                .header("X-CSRF-TOKEN",token).content("{\"username\":\"absent"+i+"\",\"password\":\"Invalid synthetic password\"}"))
                .andExpect(i<3?status().isUnauthorized():status().isTooManyRequests());
        }
    }
}
