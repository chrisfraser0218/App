-- Additive only: no modification of existing financial rows or applied migrations.
CREATE TABLE recurring_rules (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    account_id UUID NOT NULL,
    category_id UUID NOT NULL,
    description VARCHAR(160) NOT NULL,
    amount NUMERIC(19,2) NOT NULL CHECK (amount > 0),
    type VARCHAR(7) NOT NULL CHECK (type IN ('INCOME','EXPENSE')),
    frequency VARCHAR(13) NOT NULL CHECK (frequency IN ('DAILY','WEEKLY','BIWEEKLY','TWICE_MONTHLY','MONTHLY','YEARLY')),
    start_date DATE NOT NULL,
    end_date DATE,
    next_date DATE,
    payment_day INTEGER CHECK (payment_day BETWEEN 1 AND 31),
    second_payment_day INTEGER CHECK (second_payment_day BETWEEN 1 AND 31),
    CHECK (frequency NOT IN ('MONTHLY','TWICE_MONTHLY') OR payment_day IS NOT NULL),
    CHECK (frequency <> 'TWICE_MONTHLY' OR (second_payment_day IS NOT NULL AND second_payment_day > payment_day)),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    request_id UUID NOT NULL,
    creation_fingerprint VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version BIGINT NOT NULL DEFAULT 0,
    CHECK (end_date IS NULL OR end_date >= start_date),
    FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
    FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id),
    UNIQUE (id, user_id),
    UNIQUE (user_id, request_id)
);
CREATE INDEX idx_recurring_rules_due ON recurring_rules(user_id, enabled, archived, next_date);
CREATE TABLE recurring_occurrences (
    rule_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    occurrence_date DATE NOT NULL,
    transaction_id UUID UNIQUE REFERENCES transactions(id) ON DELETE SET NULL,
    resolution VARCHAR(8) NOT NULL CHECK (resolution IN ('POSTED','MANUAL','HANDLED')),
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_id, occurrence_date),
    FOREIGN KEY (rule_id, user_id) REFERENCES recurring_rules(id, user_id)
);
CREATE TABLE recurring_prediction_feedback (
    prediction_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    rule_id UUID NOT NULL,
    selected_category_id UUID NOT NULL,
    outcome VARCHAR(12) NOT NULL CHECK (outcome IN ('accepted','corrected')),
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prediction_id, user_id) REFERENCES category_predictions(id, user_id),
    FOREIGN KEY (rule_id, user_id) REFERENCES recurring_rules(id, user_id),
    FOREIGN KEY (selected_category_id, user_id) REFERENCES categories(id, user_id)
);
