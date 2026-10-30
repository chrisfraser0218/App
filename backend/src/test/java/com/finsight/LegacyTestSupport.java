package com.finsight;

import java.time.Instant;
import java.util.List;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.mock.web.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/** Authenticated synthetic fixture only; never included in application code. */
@TestConfiguration
class LegacyTestSupport {
    static <T> T owned(java.util.function.Supplier<T> operation) {
        var result=new java.util.concurrent.atomic.AtomicReference<T>();
        CurrentIdentity.processAccount(DemoIdentity.USER_ID,DemoIdentity.ACCOUNT_ID,()->result.set(operation.get()));
        return result.get();
    }
    @Bean MockMvcBuilderCustomizer authenticatedFixture() {
        return builder -> builder.defaultRequest(get("/").with(request -> {
            var context=SecurityContextHolder.createEmptyContext();
            context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(
                new CurrentIdentity.Owner(DemoIdentity.USER_ID,DemoIdentity.ACCOUNT_ID,"legacy_fixture",0,Instant.now()),null,List.of()));
            var session=new MockHttpSession();
            session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,context);
            request.setSession(session);
            var repository=new HttpSessionCsrfTokenRepository();
            var token=repository.generateToken(request);
            repository.saveToken(token,request,new MockHttpServletResponse());
            new XorCsrfTokenRequestAttributeHandler().handle(request,new MockHttpServletResponse(),()->token);
            request.addHeader("X-CSRF-TOKEN",((CsrfToken)request.getAttribute(CsrfToken.class.getName())).getToken());
            return request;
        }));
    }
}
