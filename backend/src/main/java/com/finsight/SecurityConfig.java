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
    @Bean SecurityFilterChain security(HttpSecurity http, AuthenticationService authentication,
            @Value("${desktop.enabled:false}") boolean desktop, @Value("${desktop.session-token:}") String token,
            @Value("${desktop.read-only:false}") boolean readOnly, @Value("${authentication.attempts-per-minute:30}") int limit) throws Exception {
        return http.cors(c -> c.disable())
            .csrf(c -> c.csrfTokenRepository(new org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository()))
            .requestCache(c -> c.disable()).logout(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
            .exceptionHandling(e -> e.authenticationEntryPoint((req,res,ex) -> res.sendError(401))
                .accessDeniedHandler((req,res,ex) -> res.sendError(403)))
            .authorizeHttpRequests(a -> {
                a.requestMatchers(HttpMethod.GET,"/api/auth/csrf","/api/desktop/health").permitAll();
                a.requestMatchers(HttpMethod.POST,"/api/auth/register","/api/auth/login").permitAll();
                a.requestMatchers("/api/**").authenticated();
                if(desktop)a.requestMatchers(HttpMethod.GET,"/","/index.html","/assets/**","/favicon.svg").permitAll();
                a.anyRequest().denyAll();
            })
            .addFilterBefore(new LocalRequestFilter(desktop,token,readOnly), org.springframework.security.web.csrf.CsrfFilter.class)
            .addFilterAfter(new SessionValidationFilter(authentication,limit), AnonymousAuthenticationFilter.class)
            .build();
    }
    static class SessionValidationFilter extends OncePerRequestFilter {
        private final AuthenticationService service;
        private long window; private int attempts; private final int limit;
        SessionValidationFilter(AuthenticationService service,int limit) { this.service=service;this.limit=Math.max(1,Math.min(limit,500)); }
        private synchronized boolean limited() {
            long now=System.currentTimeMillis();
            if(now-window>=60_000){window=now;attempts=0;}
            return ++attempts>limit;
        }
        @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain) throws ServletException,IOException {
            var auth=org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if(auth!=null && auth.getPrincipal() instanceof CurrentIdentity.Owner owner && !service.valid(owner)) {
                var session=req.getSession(false);if(session!=null)session.invalidate();
                org.springframework.security.core.context.SecurityContextHolder.clearContext();
                res.sendError(401);return;
            }
            if("POST".equals(req.getMethod()) && Set.of("/api/auth/login","/api/auth/register").contains(req.getRequestURI()) && limited()) {
                res.setHeader("Retry-After","60");res.sendError(429);return;
            }
            chain.doFilter(req,res);
        }
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
            if(req.getContentLengthLong()>1024*1024){res.sendError(413);return;}
            boolean api=req.getRequestURI().startsWith("/api/");
            if(desktop&&api){
                String supplied=req.getHeader("X-FinSight-Session");
                if(supplied==null||!MessageDigest.isEqual(token,supplied.getBytes(StandardCharsets.UTF_8))){res.sendError(403);return;}
                if(readOnly&&!Set.of("GET","HEAD").contains(req.getMethod())&&!Set.of("/api/assistant/questions","/api/forecasts/scenarios","/api/auth/login","/api/auth/logout").contains(req.getRequestURI())){res.sendError(403);return;}
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
