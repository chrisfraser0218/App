package com.finsight;

import java.lang.reflect.Method;
import org.junit.jupiter.api.extension.*;

/** Supplies explicit synthetic owner for older direct-service calculation tests. */
class LegacyIdentityExtension implements InvocationInterceptor {
    private void run(Invocation<Void> invocation) throws Throwable {
        Throwable[] thrown={null};
        CurrentIdentity.processAccount(DemoIdentity.USER_ID,DemoIdentity.ACCOUNT_ID,()->{
            try { invocation.proceed(); } catch(Throwable e) { thrown[0]=e; }
        });
        if(thrown[0]!=null)throw thrown[0];
    }
    @Override public void interceptTestMethod(Invocation<Void> invocation,ReflectiveInvocationContext<Method> context,ExtensionContext extension) throws Throwable {run(invocation);}
    @Override public void interceptBeforeEachMethod(Invocation<Void> invocation,ReflectiveInvocationContext<Method> context,ExtensionContext extension) throws Throwable {run(invocation);}
    @Override public void interceptTestTemplateMethod(Invocation<Void> invocation,ReflectiveInvocationContext<Method> context,ExtensionContext extension) throws Throwable {run(invocation);}
}
