-- Forecast output is never persisted in the actual transaction ledger.
CREATE TABLE planned_transactions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    account_id UUID NOT NULL,
    category_id UUID NOT NULL,
    description VARCHAR(160) NOT NULL,
    amount NUMERIC(19,2) NOT NULL CHECK (amount > 0),
    type VARCHAR(7) NOT NULL CHECK (type IN ('INCOME','EXPENSE')),
    planned_date DATE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','COMPLETED','CANCELED')),
    request_id UUID NOT NULL,
    creation_fingerprint VARCHAR(64) NOT NULL,
    transaction_id UUID UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
    completion_mode VARCHAR(7) CHECK (completion_mode IN ('RECORD','LINK','HANDLED')),
    completion_request_id UUID,
    completion_fingerprint VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    version BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY (account_id,user_id) REFERENCES accounts(id,user_id),
    FOREIGN KEY (category_id,user_id) REFERENCES categories(id,user_id),
    UNIQUE(user_id,request_id)
);
CREATE INDEX idx_plans_owner_date ON planned_transactions(user_id,account_id,status,planned_date);
CREATE TABLE forecast_preferences (
    account_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    low_balance_threshold NUMERIC(19,2) NOT NULL CHECK (low_balance_threshold >= 0),
    version BIGINT NOT NULL DEFAULT 1,
    FOREIGN KEY (account_id,user_id) REFERENCES accounts(id,user_id)
);
