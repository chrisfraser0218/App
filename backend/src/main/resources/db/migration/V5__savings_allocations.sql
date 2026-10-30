-- Savings is a separate allocation book; no trigger or write to the cash ledger.
CREATE TABLE savings_goals (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), account_id UUID NOT NULL,
 name VARCHAR(100) NOT NULL, description VARCHAR(1000) NOT NULL DEFAULT '',
 target_amount NUMERIC(19,2) NOT NULL CHECK(target_amount>0), target_date DATE,
 completed BOOLEAN NOT NULL DEFAULT FALSE, archived BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP WITH TIME ZONE NOT NULL, version BIGINT NOT NULL DEFAULT 0,
 request_id UUID NOT NULL, creation_fingerprint VARCHAR(64) NOT NULL,
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id), UNIQUE(id,user_id), UNIQUE(user_id,request_id)
);
CREATE TABLE savings_entries (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), goal_id UUID NOT NULL,
 amount NUMERIC(19,2) NOT NULL CHECK(amount>0), entry_type VARCHAR(12) NOT NULL CHECK(entry_type IN ('CONTRIBUTION','WITHDRAWAL')),
 bucket VARCHAR(12) NOT NULL CHECK(bucket IN ('IN_ACCOUNT','EXTERNAL')), entry_date DATE NOT NULL,
 note VARCHAR(500) NOT NULL DEFAULT '', transaction_id UUID,
 -- Original reference is retained even if its cash transaction is later removed.
 active_link_id UUID UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE,
 replaces_id UUID REFERENCES savings_entries(id), request_id UUID NOT NULL,
 fingerprint VARCHAR(64) NOT NULL, created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 FOREIGN KEY(goal_id,user_id) REFERENCES savings_goals(id,user_id), UNIQUE(user_id,request_id), UNIQUE(replaces_id),
 CHECK(active_link_id IS NULL OR (active AND active_link_id=transaction_id))
);
CREATE INDEX idx_savings_entries_goal_date ON savings_entries(user_id,goal_id,entry_date);
CREATE TABLE savings_corrections (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), goal_id UUID NOT NULL,
 entry_id UUID NOT NULL UNIQUE REFERENCES savings_entries(id), replacement_id UUID REFERENCES savings_entries(id),
 reason VARCHAR(500) NOT NULL, request_id UUID NOT NULL, fingerprint VARCHAR(64) NOT NULL,
 created_at TIMESTAMP WITH TIME ZONE NOT NULL,
 FOREIGN KEY(goal_id,user_id) REFERENCES savings_goals(id,user_id), UNIQUE(user_id,request_id)
);
CREATE TABLE savings_schedules (
 goal_id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), amount NUMERIC(19,2) NOT NULL CHECK(amount>0),
 bucket VARCHAR(12) NOT NULL CHECK(bucket IN ('IN_ACCOUNT','EXTERNAL')), frequency VARCHAR(14),
 payment_day INTEGER CHECK(payment_day BETWEEN 1 AND 31), second_payment_day INTEGER CHECK(second_payment_day BETWEEN 1 AND 31),
 start_date DATE NOT NULL, end_date DATE, enabled BOOLEAN NOT NULL,
 link_type VARCHAR(9) NOT NULL CHECK(link_type IN ('NONE','PLANNED','RECURRING')), link_id UUID,
 FOREIGN KEY(goal_id,user_id) REFERENCES savings_goals(id,user_id),
 CHECK(end_date IS NULL OR end_date>=start_date),
 CHECK(frequency IS NULL OR frequency IN ('DAILY','WEEKLY','BIWEEKLY','TWICE_MONTHLY','MONTHLY','YEARLY')),
 CHECK((link_type='NONE' AND link_id IS NULL AND frequency IS NOT NULL) OR (link_type<>'NONE' AND link_id IS NOT NULL))
);
