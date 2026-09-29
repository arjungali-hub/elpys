-- Adds a photo credit to Opportunities, shown in small print on the homepage
-- card photo and under the photos on the detail page.
--
-- Some covers are licensed on condition of attribution (King County Parks'
-- Flickr photo, 2026-09-29), and organizations submitting their own photos can
-- name the photographer. One credit per listing covers the cover and gallery:
-- the site has no per-photo captions, and a listing's photos normally all come
-- from the same organization.
--
-- As with 20260926000000_opportunity_photos.sql, the column must also be in
-- PUBLIC_COLUMNS in supabase-client.js AND granted below, or the public site
-- fails with 42501 (see the 2026-08-26 dev-log entry). Column grants are
-- additive, so granting just this column leaves the existing list intact.

alter table public."Opportunities"
  add column if not exists photo_credit text;

alter table public."Opportunities"
  drop constraint if exists opportunities_photo_credit_len;
alter table public."Opportunities"
  add constraint opportunities_photo_credit_len
  check (photo_credit is null or char_length(photo_credit) between 1 and 200);

comment on column public."Opportunities".photo_credit is
  'Plain-text credit for the listing''s photos, e.g. "King County Parks (CC BY-NC 2.0)". Rendered after a "Photo: " prefix. Null means no credit line is shown.';

grant select (photo_credit) on public."Opportunities" to anon, authenticated;
