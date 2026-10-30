package com.finsight;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.web.csrf.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

@RestController @RequestMapping("/api/auth")
class AuthenticationController {
    private final AuthenticationService service;
    AuthenticationController(AuthenticationService service) { this.service = service; }
    record Registration(@NotNull @Size(max=32) String username, @NotNull @Size(max=1024) String password,
                        @NotNull @Size(max=1024) String confirmPassword) {}
    record Login(@NotNull @Size(max=32) String username, @NotNull @Size(max=1024) String password) {}
    record Session(String username, String accountId) {}
    @GetMapping("/csrf") Map<String,String> csrf(CsrfToken token) { return Map.of("token",token.getToken()); }
    @GetMapping({"/me","/session"}) Session me() { return view(CurrentIdentity.owner()); }
    @PostMapping("/register") @ResponseStatus(HttpStatus.CREATED)
    Session register(@Valid @RequestBody Registration input, HttpServletRequest req, HttpServletResponse res) {
        return establish(service.register(input.username(),input.password(),input.confirmPassword()), req, res);
    }
    @PostMapping("/login") Session login(@Valid @RequestBody Login input, HttpServletRequest req, HttpServletResponse res) {
        return establish(service.login(input.username(),input.password()), req, res);
    }
    @PostMapping("/logout") @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(HttpServletRequest req, HttpServletResponse res) {
        var session = req.getSession(false); if (session != null) session.invalidate();
        SecurityContextHolder.clearContext();
        res.addHeader("Set-Cookie", "FINSIGHT_SESSION=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
    }
    private Session establish(CurrentIdentity.Owner owner, HttpServletRequest req, HttpServletResponse res) {
        req.getSession(); req.changeSessionId(); req.getSession().setMaxInactiveInterval(1800);
        new HttpSessionCsrfTokenRepository().saveToken(null,req,res);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(owner, null, java.util.List.of()));
        SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context,req,res);
        return view(owner);
    }
    private Session view(CurrentIdentity.Owner owner) { return new Session(owner.username(),owner.accountId().toString()); }
}
