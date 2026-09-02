-- Align already-open recruitment deadlines with the current rule:
-- cards are visible until 24 hours before their JST start time. Parse and
-- validate TEXT dates before make_date so malformed legacy rows do not abort
-- the whole migration.
WITH parsed AS (
    SELECT
        id,
        substring(available_date from 1 for 4)::integer AS year_value,
        substring(available_date from 6 for 2)::integer AS month_value,
        substring(available_date from 9 for 2)::integer AS day_value,
        start_time
    FROM recruitment_cards
    WHERE status IN ('open', 'matched')
      AND timezone = 'Asia/Tokyo'
      AND available_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
),
valid AS (
    SELECT
        id,
        make_date(year_value, month_value, day_value) + start_time::time AS starts_at_jst
    FROM parsed
    WHERE year_value BETWEEN 1 AND 9999
      AND month_value BETWEEN 1 AND 12
      AND CASE
          WHEN year_value BETWEEN 1 AND 9999 AND month_value BETWEEN 1 AND 12 THEN day_value BETWEEN 1 AND EXTRACT(
              DAY FROM date_trunc('month', make_date(year_value, month_value, 1)) + INTERVAL '1 month - 1 day'
          )::integer
          ELSE false
      END
)
UPDATE recruitment_cards AS cards
SET expires_at = to_char(
    ((valid.starts_at_jst AT TIME ZONE 'Asia/Tokyo') - INTERVAL '24 hours') AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
)
FROM valid
WHERE cards.id = valid.id;
