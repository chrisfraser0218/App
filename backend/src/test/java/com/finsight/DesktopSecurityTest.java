package com.finsight;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@org.springframework.context.annotation.Import(LegacyTestSupport.class)
@org.junit.jupiter.api.extension.ExtendWith(LegacyIdentityExtension.class)
@SpringBootTest(properties={"desktop.enabled=true","desktop.session-token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","desktop.read-only=true","desktop.instance=synthetic-desktop"})
@AutoConfigureMockMvc @ActiveProfiles("test") @ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
class DesktopSecurityTest {
 static final String TOKEN="a".repeat(64);@Autowired MockMvc mvc;@Autowired JdbcTemplate jdbc;
 @Test void unauthenticatedAndWrongSessionsAreRejected()throws Exception{mvc.perform(get("/api/account")).andExpect(status().isForbidden());mvc.perform(get("/api/account").header("X-FinSight-Session","b".repeat(64))).andExpect(status().isForbidden());}
 @Test void nativeSessionReadsAndHealthAreAllowed()throws Exception{mvc.perform(get("/api/account").header("X-FinSight-Session",TOKEN).header("Origin","http://127.0.0.1:80")).andExpect(status().isOk()).andExpect(header().string("Cache-Control",org.hamcrest.Matchers.containsString("no-store")));mvc.perform(get("/api/desktop/health").header("X-FinSight-Session",TOKEN)).andExpect(jsonPath("$.instance").value("synthetic-desktop"));}
 @Test void foreignOriginRejectedEvenWithToken()throws Exception{mvc.perform(get("/api/account").header("X-FinSight-Session",TOKEN).header("Origin","https://external.invalid")).andExpect(status().isForbidden());}
 @Test void readOnlyAcceptanceCannotPostFinancialWrites()throws Exception{int before=jdbc.queryForObject("SELECT count(*) FROM transactions",Integer.class);mvc.perform(post("/api/recurring-transactions/process-due").header("X-FinSight-Session",TOKEN).contentType("application/json")).andExpect(status().isForbidden());assertThat(jdbc.queryForObject("SELECT count(*) FROM transactions",Integer.class)).isEqualTo(before);}
 @Test void readonlyAssistantStillWorks()throws Exception{mvc.perform(post("/api/assistant/questions").header("X-FinSight-Session",TOKEN).contentType("application/json").content("{\"question\":\"Current actual balance\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.kind").value("ACTUAL"));}
 @Test void staticAssetRequestDoesNotExposeAnApi()throws Exception{mvc.perform(get("/assets/missing.js").header("Origin","http://127.0.0.1:80")).andExpect(status().isNotFound());}
}
