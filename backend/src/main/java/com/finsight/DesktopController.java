package com.finsight;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
@RestController
class DesktopController {
 private final String instance;
 DesktopController(@Value("${desktop.instance:}") String instance){this.instance=instance;}
 @GetMapping("/api/desktop/health") Map<String,String> health(){return Map.of("status","ready","instance",instance);}
}
