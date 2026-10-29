package com.finsight;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class IsolatedDatabaseGuardTest {
    @Test void rejectsPersonalClustersEvenWithMisleadingDatabaseNames() {
        for (String directory : new String[] {"/tmp/finsight-pgdata", "/Users/example/Library/Application Support/FinSight AI/postgres", "/opt/homebrew/var/postgresql@15"}) {
            assertThat(IsolatedDatabaseGuard.allowsPostgres("finsight_verification", directory, true)).isFalse();
            assertThat(IsolatedDatabaseGuard.allowsPostgres("finsight_test", directory, false)).isFalse();
        }
    }
    @Test void allowsOnlyDedicatedLocalVerificationClusterAndDatabaseTogether() {
        assertThat(IsolatedDatabaseGuard.allowsPostgres("finsight_verification", "/tmp/finsight-isolated-verification-fixture/postgres", false)).isTrue();
        assertThat(IsolatedDatabaseGuard.allowsPostgres("finsight_demo", "/tmp/finsight-isolated-verification-fixture/postgres", false)).isFalse();
    }
    @Test void requiresCiContextForItsEphemeralContainer() {
        assertThat(IsolatedDatabaseGuard.allowsPostgres("finsight_verification", "/var/lib/postgresql/data", true)).isTrue();
        assertThat(IsolatedDatabaseGuard.allowsPostgres("finsight_verification", "/var/lib/postgresql/data", false)).isFalse();
    }
}
