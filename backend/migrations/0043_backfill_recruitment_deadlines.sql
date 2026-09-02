-- Align already-open recruitment deadlines with the current rule:
-- cards are visible until 24 hours before their JST start time.
UPDATE recruitment_cards
SET expires_at = to_char(
    (((available_date::date + start_time::time) AT TIME ZONE 'Asia/Tokyo') - INTERVAL '24 hours') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
)
WHERE status IN ('open', 'matched')
  AND timezone = 'Asia/Tokyo'
  AND available_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
