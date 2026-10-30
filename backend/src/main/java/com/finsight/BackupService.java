package com.finsight;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
class BackupService {
    private final BackupWorker worker;
    private final boolean enabled;
    private final AtomicBoolean running=new AtomicBoolean();
    private final ExecutorService executor=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"finsight-local-backup");t.setDaemon(true);return t;});
    private volatile String dispatchError;
    BackupService(BackupWorker worker,@Value("${backup.enabled:true}")boolean enabled){this.worker=worker;this.enabled=enabled;}
    JsonNode status(){var state=(ObjectNode)worker.invoke("status",Map.of());state.put("busy",running.get()||state.path("busy").asBoolean());if(dispatchError!=null)state.put("dispatchError",dispatchError);return state;}
    synchronized void start(String action,Map<String,?> payload){
        if(!running.compareAndSet(false,true))throw new ResponseStatusException(HttpStatus.CONFLICT,"A local maintenance operation is already running");
        dispatchError=null;
        executor.submit(()->{try{worker.invoke(action,payload);}catch(ResponseStatusException e){dispatchError=e.getReason();}catch(Exception e){dispatchError="Local maintenance failed; details withheld";}finally{running.set(false);}});
    }
    JsonNode settings(Map<String,?> input){if(running.get())throw new ResponseStatusException(HttpStatus.CONFLICT,"Wait for the running operation before changing settings");return worker.invoke("settings",input);}
    @EventListener(ApplicationReadyEvent.class) public void ready(){scheduled();}
    @Scheduled(fixedDelayString="${backup.poll-delay-ms:60000}") public void scheduled(){if(enabled&&!running.get())try{start("tick",Map.of());}catch(ResponseStatusException ignored){/* shared worker lock arbitrates another process */}}
    @PreDestroy void close(){executor.shutdown();try{if(!executor.awaitTermination(30,TimeUnit.SECONDS))executor.shutdownNow();}catch(InterruptedException e){Thread.currentThread().interrupt();}}
}
