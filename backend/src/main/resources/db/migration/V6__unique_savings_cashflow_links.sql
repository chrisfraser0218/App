-- A whole future cash-flow reference funds one allocation schedule, never two goals.
-- NULL links remain unrestricted for independent allocation-only intentions.
ALTER TABLE savings_schedules ADD CONSTRAINT uq_savings_schedule_cash_link UNIQUE(user_id,link_type,link_id);
