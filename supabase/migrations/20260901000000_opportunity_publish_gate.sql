-- Captures the organization-publish gate into the repo. This trigger and its
-- two functions were already live in the database before this migration
-- existed — applied directly on 2026-09-01 while diagnosing the tBUG
-- (EIN 81-1719474) finding — with no corresponding entry in git history
-- until now. This migration is transcription of existing, verified state,
-- not new work: do not change the functions' behavior here. If a genuine
-- mismatch between this SQL and lib/verificationGate.js's gateReasons() is
-- found, fix it in a separate, clearly-labelled migration with its own
-- reasoning, not by editing this file.
--
-- Why a trigger at all, not just the API-level check in api/admin.js:
-- service_role (which api/admin.js authenticates as) bypasses RLS but does
-- NOT bypass triggers, so this is the layer that actually holds regardless
-- of how a write reaches the table — a raw PATCH, a future automated task,
-- or a bug in the API layer above it.
--
-- search_path = '' is pinned on both functions deliberately (set 2026-09-01
-- to clear a function_search_path_mutable advisor warning) — everything they
-- reference is either pg_catalog or schema-qualified. Do not remove it.
--
-- Fires only on the transition INTO published — never on a row that is
-- already published being edited, which is what would break the admin edit
-- form and the weekly data-check task if this ever regressed.

create or replace function public.opportunity_publish_gate(rec public."Opportunities")
returns text[]
language plpgsql
set search_path to ''
as $function$
declare
  reasons text[] := '{}';
  age_days numeric;
  irs jsonb;
  irc_age numeric;
  wa_exempt boolean;
  irs_host text;
begin
  if rec.org_tier is null then
    reasons := array_append(reasons, 'No organization tier recorded. Research the org and set org_tier first.');
  elsif rec.org_tier not in ('government', 'charity') then
    reasons := array_append(reasons, 'Invalid org tier.');
  end if;

  if rec.org_domain is null then
    reasons := array_append(reasons, 'No canonical organization domain recorded.');
  end if;

  if rec.verified_at is null then
    reasons := array_append(reasons, 'Not human-verified. Run the four checks, then mark verified.');
  else
    age_days := extract(epoch from (now() - rec.verified_at)) / 86400;
    if age_days > 365 then
      reasons := array_append(reasons, format('Verification is stale (%s days old). Re-run the checks.', floor(age_days)));
    end if;
  end if;

  if rec.org_tier = 'charity' then
    if rec.ein is null then
      reasons := array_append(reasons, 'Charity with no EIN recorded.');
    end if;

    wa_exempt := coalesce((rec.verification #>> '{wa_charity,exempt}')::boolean, false);
    if rec.wa_charity_number is null and not wa_exempt then
      reasons := array_append(reasons,
        'No Washington charity registration. Absence from the registry is a failure, not a gap — ' ||
        'record the number, or record a documented RCW 19.09 exemption.');
    end if;

    irs := rec.verification -> 'irs_revocation_check';
    if irs is null then
      reasons := array_append(reasons, 'No IRS auto-revocation check recorded.');
    else
      begin
        irc_age := extract(epoch from (now() - (irs ->> 'checked_at')::date)) / 86400;
      exception when others then
        irc_age := null;
      end;

      if irc_age is null then
        reasons := array_append(reasons, 'IRS auto-revocation check has no valid checked_at date.');
      elsif irc_age > 365 then
        reasons := array_append(reasons, format('IRS auto-revocation check is stale (%s days old).', floor(irc_age)));
      else
        irs_host := lower(regexp_replace(coalesce(irs ->> 'source', ''), '^[a-zA-Z]+://([^/]+).*$', '\1'));
        if irs_host = '' or not (irs_host = 'irs.gov' or irs_host like '%.irs.gov') then
          reasons := array_append(reasons,
            format('IRS auto-revocation check source must be an irs.gov URL (was: %s).', coalesce(irs ->> 'source', 'none')));
        elsif irs ->> 'result' = 'listed_reinstated' then
          reasons := array_append(reasons,
            'Listed as reinstated after a prior revocation — this needs a human look, it cannot pass automatically.');
        elsif irs ->> 'result' is distinct from 'not_listed' then
          reasons := array_append(reasons,
            case when irs ->> 'result' = 'listed_revoked'
                 then 'Organization is on the IRS automatic-revocation list.'
                 else 'IRS auto-revocation check result not recognized.'
            end);
        end if;
      end if;
    end if;
  end if;

  return reasons;
end;
$function$;

create or replace function public.opportunity_publish_gate_trigger()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  reasons text[];
begin
  if (tg_op = 'UPDATE' and old.status is distinct from 'published' and new.status = 'published')
     or (tg_op = 'INSERT' and new.status = 'published') then
    reasons := public.opportunity_publish_gate(new);
    if array_length(reasons, 1) > 0 then
      raise exception 'Cannot publish "%": %', new.name, array_to_string(reasons, ' | ')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists opportunity_publish_gate on public."Opportunities";

create trigger opportunity_publish_gate
before insert or update on public."Opportunities"
for each row
execute function public.opportunity_publish_gate_trigger();
