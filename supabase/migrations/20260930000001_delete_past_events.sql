-- Deletes published one-time events once they're over, instead of leaving
-- them published forever after they drop off the site.
--
-- The public site already hides a one-time event from the day after its
-- event_date (Pacific calendar day — supabase-client.js _todayIso,
-- middleware.js, api/sitemap.js), and its URL 404s from then on. This removes
-- the row itself on the same rule: event_date before today in Bellevue.
--
-- Only published rows. A pending submission for a date that has passed is
-- left for an admin to see and reject; rejected rows follow the 12-month
-- retention in enforce_retention(). Deleting a row also deletes its
-- data_review_flags (ON DELETE CASCADE), which are moot once the event is
-- gone. Its photos become unused and are removed by the weekly
-- /api/cleanup-photos run.
--
-- Runs nightly from pg_cron at 10:07 UTC (3:07am PDT / 2:07am PST), so the
-- Pacific date at run time is already the new day.
create or replace function public.delete_past_events()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer := 0;
begin
  delete from public."Opportunities"
   where status = 'published'
     and opportunity_type = 'one_time'
     and event_date is not null
     and event_date < (now() at time zone 'America/Los_Angeles')::date;
  get diagnostics n = row_count;
  raise notice 'delete_past_events: % deleted', n;
  return n;
end;
$function$;

revoke all on function public.delete_past_events() from public, anon, authenticated;
grant execute on function public.delete_past_events() to service_role;

select cron.schedule('elpys-delete-past-events', '7 10 * * *', 'select public.delete_past_events();');
