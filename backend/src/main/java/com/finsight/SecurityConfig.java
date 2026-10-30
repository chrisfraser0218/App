package com.finsight;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Set;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
@Configuration
class SecurityConfig {
    @Bean SecurityFilterChain security(HttpSecurity http, @Value("${desktop.enabled:false}") boolean desktop, @Value("${desktop.session-token:}") String token, @Value("${desktop.read-only:false}") boolean readOnly) throws Exception {
        // No cookies or authenticated sessions in this local demo. Require JSON for mutations.
        return http.csrf(c -> c.disable()).cors(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> { a.requestMatchers("/api/**").permitAll(); if(desktop)a.requestMatchers(HttpMethod.GET,"/","/index.html","/assets/**","/favicon.svg").permitAll(); a.anyRequest().denyAll(); })
            .addFilterBefore(new LocalRequestFilter(desktop,token,readOnly), AnonymousAuthenticationFilter.class).build();
    }
    static class LocalRequestFilter extends OncePerRequestFilter {
        private final boolean desktop,readOnly;
        private final byte[] token;
        LocalRequestFilter(){this(false,"",false);}
        LocalRequestFilter(boolean desktop,String token,boolean readOnly){
            if(desktop&&!token.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Desktop mode requires a strong session token");
            this.desktop=desktop;this.token=token.getBytes(StandardCharsets.UTF_8);this.readOnly=readOnly;
        }
        private static final Set<String> HOSTS = Set.of("localhost", "127.0.0.1", "[::1]");
        private static final Set<String> ORIGINS = Set.of("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080", "http://127.0.0.1:8080");
        @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
            boolean api=req.getRequestURI().startsWith("/api/");
            if(desktop&&api){
                String supplied=req.getHeader("X-FinSight-Session");
                if(supplied==null||!MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.UTF_8))){res.sendError(403);return;}
                if(readOnly&&!Set.of("GET","HEAD").contains(req.getMethod())&&!Set.of("/api/assistant/questions","/api/forecasts/scenarios").contains(req.getRequestURI())){res.sendError(403);return;}
            }
            String origin = req.getHeader("Origin");
            boolean desktopOrigin=desktop&&("http://127.0.0.1:"+req.getServerPort()).equals(origin);
            if (!HOSTS.contains(req.getServerName()) || (origin != null && !ORIGINS.contains(origin) && !desktopOrigin)) {
                res.sendError(403); return;
            }
            if (Set.of("POST", "PUT", "PATCH").contains(req.getMethod()) &&
                (req.getContentType() == null || !req.getContentType().toLowerCase(java.util.Locale.ROOT).startsWith("application/json"))) {
                res.sendError(415); return;
            }
            if(desktop)res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self'");
            chain.doFilter(req, res);
        }
    }
}
