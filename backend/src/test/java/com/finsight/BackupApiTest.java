package com.finsight;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import java.util.*;
import java.util.concurrent.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc @ActiveProfiles("test")
@ContextConfiguration(initializers=IsolatedDatabaseGuard.class)
class BackupApiTest {
 @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired BackupService service;
 @MockBean BackupWorker worker;
 @BeforeEach void setup(){when(worker.invoke(anyString(),anyMap())).thenAnswer(i->json.readTree("{\"busy\":false,\"operation\":{\"state\":\"idle\"}}"));}
 @AfterEach void idle()throws Exception{for(int i=0;i<100&&service.status().path("busy").asBoolean();i++)Thread.sleep(10);}
 @Test void manualBackupIsAsynchronous()throws Exception{mvc.perform(post("/api/backups").contentType("application/json").content("{}")).andExpect(status().isAccepted());verify(worker,timeout(1000)).invoke("backup",Map.of());}
 @Test void statusAndSettingsContracts()throws Exception{mvc.perform(get("/api/backups")).andExpect(status().isOk()).andExpect(jsonPath("$.operation.state").value("idle"));mvc.perform(put("/api/backups/settings").contentType("application/json").content("{\"version\":0,\"time\":\"02:00\"}")).andExpect(status().isOk());verify(worker).invoke("settings",Map.of("version",0,"time","02:00"));}
 @Test void verifyAndConfirmedRestoreDispatchOnlyKnownOperations()throws Exception{mvc.perform(post("/api/backups/bkp-synthetic/verify").contentType("application/json")).andExpect(status().isAccepted());verify(worker,timeout(1000)).invoke("verify",Map.of("backupId","bkp-synthetic"));for(int i=0;i<100&&service.status().path("busy").asBoolean();i++)Thread.sleep(10);mvc.perform(post("/api/backups/bkp-synthetic/restore-test").contentType("application/json").content("{\"confirmed\":true}")).andExpect(status().isAccepted());verify(worker,timeout(1000)).invoke("restore",Map.of("backupId","bkp-synthetic","confirmed",true));}
 @Test void restoreRequiresExplicitConfirmation()throws Exception{mvc.perform(post("/api/backups/bkp-synthetic/restore-test").contentType("application/json").content("{\"confirmed\":false}")).andExpect(status().isBadRequest());verify(worker,never()).invoke(eq("restore"),anyMap());}
 @Test void rejectsInvalidExportAndPathIdentifiers()throws Exception{mvc.perform(post("/api/backups/exports").contentType("application/json").content("{\"format\":\"sql;command\"}")).andExpect(status().isBadRequest());mvc.perform(get("/api/backups/exports/not-an-export.json")).andExpect(status().isBadRequest());mvc.perform(post("/api/backups/--file/verify").contentType("application/json")).andExpect(status().isBadRequest());}
 @Test void externalCopyAndExportAreAsync()throws Exception{mvc.perform(post("/api/backups/external-copy").contentType("application/json")).andExpect(status().isAccepted());verify(worker,timeout(1000)).invoke("external",Map.of());for(int i=0;i<100&&service.status().path("busy").asBoolean();i++)Thread.sleep(10);mvc.perform(post("/api/backups/exports").contentType("application/json").content("{\"format\":\"json\"}")).andExpect(status().isAccepted());verify(worker,timeout(1000)).invoke("export",Map.of("format","json"));}
 @Test void concurrentJobsAreRejected()throws Exception{CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);when(worker.invoke(eq("backup"),anyMap())).thenAnswer(i->{entered.countDown();release.await(5,TimeUnit.SECONDS);return json.createObjectNode();});try{mvc.perform(post("/api/backups").contentType("application/json")).andExpect(status().isAccepted());entered.await(2,TimeUnit.SECONDS);mvc.perform(post("/api/backups").contentType("application/json")).andExpect(status().isConflict());}finally{release.countDown();}}
 @Test void hostileOriginsCannotStartOperations()throws Exception{mvc.perform(post("/api/backups").header("Origin","https://hostile.invalid").contentType("application/json")).andExpect(status().isForbidden());}
}
