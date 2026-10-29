-- Preserve Phase 1 category IDs and names. Add the one missing model category for existing demo data.
INSERT INTO categories (id, user_id, name, type)
SELECT '00000000-0000-0000-0000-000000000003', id, 'Utilities', 'EXPENSE'
FROM users WHERE id = '00000000-0000-0000-0000-000000000001'
AND NOT EXISTS (SELECT 1 FROM categories WHERE user_id = users.id AND name = 'Utilities' AND type = 'EXPENSE');

CREATE TABLE category_predictions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    description VARCHAR(160) NOT NULL,
    amount NUMERIC(19,2) NOT NULL,
    model_category VARCHAR(60),
    suggested_category_id UUID,
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    model_version VARCHAR(60) NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('suggested','uncertain','unknown')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (suggested_category_id, user_id) REFERENCES categories(id, user_id),
    UNIQUE (id, user_id)
);
CREATE TABLE category_prediction_feedback (
    prediction_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    selected_category_id UUID NOT NULL,
    outcome VARCHAR(12) NOT NULL CHECK (outcome IN ('accepted','corrected')),
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prediction_id, user_id) REFERENCES category_predictions(id, user_id),
    FOREIGN KEY (selected_category_id, user_id) REFERENCES categories(id, user_id)
);
CREATE INDEX idx_category_predictions_user ON category_predictions(user_id, created_at);
