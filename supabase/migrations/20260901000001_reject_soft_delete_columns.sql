-- Separate, genuinely new schema change (unlike the previous migration,
-- which only transcribes pre-existing state): adds the two columns
-- api/admin.js's reject action needs to record a rejection instead of
-- hard-deleting the row.
--
-- Rejecting a submission is the record of an organization that FAILED the
-- accountability check. The previous behavior — DELETE — destroyed that
-- finding along with the row, and nothing then stopped the same org being
-- resubmitted and approved by someone who never saw why it was rejected the
-- first time. That is exactly what happened to row 97 (tBUG, EIN
-- 81-1719474): it failed the check, was deleted, and the finding survives
-- today only because it was written up in a dev-log entry, not in the
-- database.
--
-- No RLS or query change is needed to keep rejected rows out of public view:
-- the existing "Public can read published opportunities" policy already
-- grants anon SELECT only where status = 'published', and
-- supabase-client.js's own query filters on status=eq.published too. A
-- status of 'rejected' is invisible on both layers with zero changes, and
-- is equally absent from the admin pending queue, which filters
-- status=eq.pending.

alter table public."Opportunities"
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;
