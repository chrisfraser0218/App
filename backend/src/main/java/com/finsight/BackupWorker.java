package com.finsight;

import com.fasterxml.jackson.databind.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Narrow command bridge to the stdlib-only native PostgreSQL maintenance worker; no shell or credential arguments. */
@Component
class BackupWorker {
    private final ObjectMapper json;
    private final String python;
    private final Path script;
    BackupWorker(ObjectMapper json,@Value("${backup.python:python3}") String python,
                 @Value("${backup.script:../scripts/backup_manager.py}") String script) {
        this.json=json;this.python=python;this.script=Path.of(script).toAbsolutePath().normalize();
    }
    JsonNode invoke(String action,Map<String,?> input) {
        if(!Set.of("status","settings","backup","tick","verify","restore","external","export").contains(action))throw new IllegalArgumentException();
        try {
            var builder=new ProcessBuilder(python,script.toString(),action).redirectError(ProcessBuilder.Redirect.DISCARD);
            var process=builder.start();
            try(var stdin=process.getOutputStream()){json.writeValue(stdin,input);}
            var output=CompletableFuture.supplyAsync(()->{
                try{return process.getInputStream().readNBytes(4*1024*1024);}catch(java.io.IOException e){return new byte[0];}
            });
            if(!process.waitFor(action.equals("status")?20:3600,TimeUnit.SECONDS)){process.destroyForcibly();throw new IllegalStateException();}
            JsonNode result=json.readTree(output.get(5,TimeUnit.SECONDS));
            if(process.exitValue()!=0)throw new ResponseStatusException(process.exitValue()==2?HttpStatus.CONFLICT:HttpStatus.BAD_REQUEST,
                result!=null?result.path("error").asText("Local maintenance failed"):"Local maintenance failed");
            if(result==null)throw new IllegalStateException();return result;
        } catch(ResponseStatusException e){throw e;}
        catch(Exception e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Local backup worker unavailable; check Python and PostgreSQL tool configuration");}
    }
    Path exportPath(String name) {
        if(!name.matches("export-[a-f0-9]{32}\\.(json|zip)"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid export identifier");
        Path base=Path.of(System.getenv().getOrDefault("FINSIGHT_DATA_HOME",System.getProperty("user.home")+"/Library/Application Support/FinSight AI"));
        Path path=base.resolve("backups/managed/exports").resolve(name);
        if(Files.isSymbolicLink(path)||!Files.isRegularFile(path))throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Export not found");
        try {
            Path ownership=path.resolveSibling(name.substring(0,name.lastIndexOf('.'))+".owner.json");
            if(Files.isSymbolicLink(ownership)||!Files.isRegularFile(ownership) ||
                !CurrentIdentity.userId().toString().equals(json.readTree(ownership.toFile()).path("userId").asText()))
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Export not found");
        } catch(java.io.IOException e) {throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Export not found");}
        return path;
    }
}
