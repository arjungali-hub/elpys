-- Card-size copy of each listing's cover photo, so the homepage downloads
-- about a fifth of the photo bytes (13 full covers were ~7.4 MB).
--
-- Matches cover_image_url (20260926000000_opportunity_photos.sql): a plain
-- nullable text column. Like the cover, the URL rule is enforced where the
-- value is written, not by a column constraint - api/submit.js and
-- api/admin.js accept only this project's
--   storage/v1/object/public/opportunity-images/uploads/<uuid>.<jpg|jpeg|png|webp>
-- and the bucket's anon INSERT policy only allows that same path pattern.
--
-- Public column, so it needs BOTH PUBLIC_COLUMNS in supabase-client.js and
-- the column grant below (anon has column grants only, no table SELECT).
-- Additive and unread by main until the branch merges; applied to
-- production on 2026-10-04 so the 13 live covers could be backfilled.
alter table public."Opportunities"
  add column if not exists cover_thumb_url text;

comment on column public."Opportunities".cover_thumb_url is
  $c$Card-size copy of cover_image_url (1200px wide, sized to cover the card's 16:10 box, JPEG, no metadata). Shown on homepage cards; the detail page keeps the full cover. Null means the card uses cover_image_url. Cleared whenever the cover is removed or replaced without a new copy.$c$;

grant select (cover_thumb_url) on public."Opportunities" to anon, authenticated;
