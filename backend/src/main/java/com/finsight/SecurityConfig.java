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
@Configuration
class SecurityConfig {
    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
        // No cookies or authenticated sessions in this local demo. Require JSON for mutations.
        return http.csrf(c -> c.disable()).cors(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a.requestMatchers("/api/**").permitAll().anyRequest().denyAll())
            .addFilterBefore(new LocalRequestFilter(), AnonymousAuthenticationFilter.class).build();
    }
    static class LocalRequestFilter extends OncePerRequestFilter {
        private static final Set<String> HOSTS = Set.of("localhost", "127.0.0.1", "[::1]");
        private static final Set<String> ORIGINS = Set.of("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080", "http://127.0.0.1:8080");
        @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
            String origin = req.getHeader("Origin");
            if (!HOSTS.contains(req.getServerName()) || (origin != null && !ORIGINS.contains(origin))) {
                res.sendError(403); return;
            }
            if (Set.of("POST", "PUT", "PATCH").contains(req.getMethod()) &&
                (req.getContentType() == null || !req.getContentType().toLowerCase(java.util.Locale.ROOT).startsWith("application/json"))) {
                res.sendError(415); return;
            }
            chain.doFilter(req, res);
        }
    }
}
