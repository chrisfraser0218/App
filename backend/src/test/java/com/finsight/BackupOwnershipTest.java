package com.finsight;

import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class BackupOwnershipTest {
    @Test void hidesOtherAccountsExportStatusHistoryAndOperationResults() throws Exception {
        UUID owner=UUID.randomUUID(),other=UUID.randomUUID();var json=new ObjectMapper();
        var state=json.createObjectNode();
        state.putObject("lastExport").put("userId",other.toString()).put("exportId","private-other.json");
        state.putObject("operation").put("action","export").putObject("result").put("userId",other.toString()).put("exportId","private-other.json");
        var history=state.putArray("history");history.addObject().put("reason","export").put("userId",other.toString()).put("exportId","private-other.json");
        history.addObject().put("reason","export").put("userId",owner.toString()).put("exportId","owned.json");
        history.addObject().put("reason","backup").put("id","global-maintenance");
        var service=mock(BackupService.class);when(service.status()).thenReturn(state);
        var controller=new BackupController(service,mock(BackupWorker.class));
        CurrentIdentity.processAccount(owner,UUID.randomUUID(),()->{
            String result=controller.status().toString();
            assertThat(result).doesNotContain("private-other.json").contains("owned.json","global-maintenance");
        });
    }
    @Test void exportUsesOnlyTheServerIdentity() {
        UUID owner=UUID.randomUUID();var service=mock(BackupService.class);
        var controller=new BackupController(service,mock(BackupWorker.class));
        CurrentIdentity.processAccount(owner,UUID.randomUUID(),()->controller.export(new BackupController.ExportInput("json")));
        verify(service).start("export",Map.of("format","json","userId",owner.toString()));
    }
}
