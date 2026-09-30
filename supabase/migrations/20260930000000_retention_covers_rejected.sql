-- privacy.html promises "Submissions we decline are deleted within 12 months."
-- enforce_retention() was written when declining a submission deleted the row
-- outright, so it only cleared stale *pending* rows. Since
-- 20260901000001_reject_soft_delete_columns.sql, declining keeps the row as
-- status = 'rejected' (the record of why an organization failed the check),
-- and nothing ever removed those, so the published promise wasn't kept.
--
-- Rejected rows now go 12 months after they were rejected (created_at for any
-- rejected before rejected_at existed). Stale pending rows are handled exactly
-- as before. Same signature and grants, so the pg_cron job that calls it is
-- unchanged. Their photos become unused and are removed by the weekly
-- /api/cleanup-photos run.
create or replace function public.enforce_retention()
returns table(feedback_deleted integer, submissions_deleted integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  fb integer := 0;
  sub integer := 0;
begin
  delete from public."Feedback"
   where created_at < now() - interval '12 months';
  get diagnostics fb = row_count;

  delete from public."Opportunities"
   where (status = 'pending'
          and created_at < now() - interval '12 months')
      or (status = 'rejected'
          and coalesce(rejected_at, created_at) < now() - interval '12 months');
  get diagnostics sub = row_count;

  raise notice 'enforce_retention: % feedback, % submissions deleted', fb, sub;
  return query select fb, sub;
end;
$function$;
