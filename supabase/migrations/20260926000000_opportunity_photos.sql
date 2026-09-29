-- Adds cover photo + gallery photo support to Opportunities, plus the public
-- storage bucket organizations' photos are uploaded into.
--
-- Two places besides this file MUST also be updated for these columns to
-- actually reach the public site, or they silently 42501/permission-deny —
-- this exact trap is already documented in the 2026-08-26 dev-log entry:
--   1. PUBLIC_COLUMNS in supabase-client.js
--   2. The column-level grant to anon/authenticated on public."Opportunities" below
-- Both are done in this same PR.

alter table public."Opportunities"
  add column if not exists cover_image_url text,
  add column if not exists gallery_image_urls text[] not null default '{}';

comment on column public."Opportunities".cover_image_url is
  'Organization-uploaded cover photo shown on the homepage card and atop the detail page. Null means: show the category fallback icon client-side — never store a fallback path here.';
comment on column public."Opportunities".gallery_image_urls is
  'Ordered list of additional photo URLs shown only on the detail page gallery/lightbox. Empty array, not null, when there are none.';

-- Deliberately NOT touching opportunity_publish_gate, its trigger, or
-- opportunity_publish_gate_trigger (see 20260901000000_opportunity_publish_gate.sql)
-- — a missing or empty cover/gallery must never block publishing. Photos are
-- encouraged, never required, to go live.

-- Re-grant: the same column list from the 2026-08-26 lockdown (see
-- PUBLIC_COLUMNS in supabase-client.js), plus the two columns above. If this
-- list ever drifts from PUBLIC_COLUMNS again, that mismatch is the bug to
-- fix, not this file — table-level grant stays revoked on purpose.
grant select (
  name, description, long_description, category,
  age_display, age_min, age_condition, age_filter,
  "when", "where", address, lat, lng, approx,
  signup_link, signup_label, signup_steps, section, slug,
  live_url, card_note, website, contact_email, contact_phone,
  schedule, opportunity_type, event_date, status,
  cover_image_url, gallery_image_urls
) on public."Opportunities" to anon, authenticated;

-- ── Storage bucket for organization-uploaded photos ─────────────────────────
-- Public-read so the site can display uploads directly by URL. Size and MIME
-- type are enforced here, at the bucket level, independent of anything a
-- client claims — this is what "server-side validation on the upload path"
-- actually means for a direct-to-Storage upload (see dev-log for why the
-- upload doesn't go through a Vercel function: a 5MB image already exceeds
-- Vercel's serverless request body limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('opportunity-images', 'opportunity-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read: anyone can view any uploaded photo by URL. The bucket's own
-- `public` flag and this policy both have to agree for that to actually work
-- through the API/SDK path, not just the CDN path.
drop policy if exists "opportunity-images public read" on storage.objects;
create policy "opportunity-images public read"
  on storage.objects for select
  using (bucket_id = 'opportunity-images');

-- Anon (and authenticated) may INSERT new photos, but only under uploads/,
-- and only using the filename pattern the client generates itself
-- (<uuid>.<jpg|jpeg|png|webp>) — never a name taken from the visitor's own
-- file. Deliberately no UPDATE or DELETE policy for anon/authenticated: once
-- uploaded, an object can't be overwritten or removed by a non-admin client,
-- only superseded by pointing the row at a different URL. This is the same
-- upload path the admin edit form uses too — there is no separate elevated
-- path, since replacing a listing's photo from the admin panel is the same
-- operation as a submitter uploading one.
drop policy if exists "opportunity-images anon upload" on storage.objects;
create policy "opportunity-images anon upload"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'opportunity-images'
    and name ~ '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  );
