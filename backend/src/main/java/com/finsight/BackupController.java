package com.finsight;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Map;
import org.springframework.core.io.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/backups")
class BackupController {
    private final BackupService service;
    private final BackupWorker worker;
    BackupController(BackupService service,BackupWorker worker){this.service=service;this.worker=worker;}
    record Confirmation(@AssertTrue boolean confirmed) {}
    record ExportInput(@NotNull @Pattern(regexp="json|csv")String format) {}
    @GetMapping JsonNode status(){return service.status();}
    @PutMapping("/settings") JsonNode settings(@RequestBody Map<String,Object> input){return service.settings(input);}
    @PostMapping @ResponseStatus(HttpStatus.ACCEPTED) Map<String,Boolean> backup(){service.start("backup",Map.of());return Map.of("accepted",true);}
    @PostMapping("/{id}/verify") @ResponseStatus(HttpStatus.ACCEPTED) Map<String,Boolean> verify(@PathVariable String id){validateId(id);service.start("verify",Map.of("backupId",id));return Map.of("accepted",true);}
    @PostMapping("/{id}/restore-test") @ResponseStatus(HttpStatus.ACCEPTED) Map<String,Boolean> restore(@PathVariable String id,@Valid @RequestBody Confirmation input){validateId(id);service.start("restore",Map.of("backupId",id,"confirmed",input.confirmed()));return Map.of("accepted",true);}
    @PostMapping("/external-copy") @ResponseStatus(HttpStatus.ACCEPTED) Map<String,Boolean> external(){service.start("external",Map.of());return Map.of("accepted",true);}
    @PostMapping("/exports") @ResponseStatus(HttpStatus.ACCEPTED) Map<String,Boolean> export(@Valid @RequestBody ExportInput input){service.start("export",Map.of("format",input.format()));return Map.of("accepted",true);}
    @GetMapping("/exports/{name}") ResponseEntity<Resource> download(@PathVariable String name){return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\""+safeExport(name)+"\"").header(HttpHeaders.CACHE_CONTROL,"no-store").contentType(name.endsWith(".json")?MediaType.APPLICATION_JSON:MediaType.parseMediaType("application/zip")).body(new FileSystemResource(worker.exportPath(name)));}
    private String safeExport(String name){if(!name.matches("export-[a-f0-9]{32}\\.(json|zip)"))throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid export identifier");return name;}
    private void validateId(String id){if(!id.matches("[a-z0-9][a-z0-9-]{5,100}"))throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid backup identifier");}
}
