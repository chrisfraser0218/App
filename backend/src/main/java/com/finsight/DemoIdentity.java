package com.finsight;
import java.util.UUID;
/** Replace with the authenticated principal when production identity is introduced. */
final class DemoIdentity {
    static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    static final UUID ACCOUNT_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private DemoIdentity() {}
}
