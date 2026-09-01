// The publish gate: what a listing must satisfy before it can go live.
// Two independent requirements live here, and both are required — they are
// not alternate versions of each other:
//
//  1. The eight conditions mirrored in SQL as public.opportunity_publish_gate()
//     (see supabase/migrations/) — machine-checkable facts about the org
//     (tier, domain, EIN, WA registration, a dated first-party IRS revocation
//     check). This is the actual backstop: service_role bypasses RLS but not
//     triggers, so a raw PATCH from this API is only ever the first line of
//     defense, and the SQL copy is what really holds.
//  2. The `verification.checks` array — a human's own attestation ("I looked
//     at the categorical exclusions and none apply", "I confirmed X in the
//     IRS/WA tools myself"), independent of what any automated research
//     wrote to the machine-checkable fields above. A passing machine check
//     doesn't stand in for a human having actually looked, and vice versa.
//
// Condition 8 (the IRS revocation source) is the one that matters most: on
// 2026-08-31, ProPublica's Nonprofit Explorer API reported EIN 81-1719474
// (tBUG, The Bellevue Urban Garden) as exempt and not revoked, on the same
// day the IRS's own Automatic Revocation list showed it revoked and never
// reinstated. ProPublica derives status from the IRS Business Master File and
// drops revoked records rather than marking them — it is not a revocation
// check, however current it looks. A gate that accepted "we checked, it was
// fine" without recording *where* would have passed that organization. Do
// not relax this to accept ProPublica, GuideStar, Charity Navigator or any
// other third-party source — irs.gov only.

const VERIFICATION_MAX_AGE_DAYS = 365;

const CHARITY_CHECKLIST = ['irs_exempt', 'irs_not_revoked', 'wa_charity_active', 'form_990_on_file'];
const GOVERNMENT_CHECK = 'org_official_site';
const EXCLUSIONS_CHECK = 'exclusions_confirmed';

function daysAgo(dateLike, now) {
  const t = new Date(dateLike).getTime();
  if (!isFinite(t)) return null;
  return (now.getTime() - t) / 86400000;
}

// "irs.gov" or any subdomain of it — "apps.irs.gov" passes, "irs.gov.evil.com"
// and "propublica.org" do not.
function irsSourceIsAuthoritative(source) {
  try {
    const host = new URL(String(source)).hostname.toLowerCase();
    return host === 'irs.gov' || host.endsWith('.irs.gov');
  } catch (_) {
    return false;
  }
}

function hasPassingCheck(checks, name) {
  return Array.isArray(checks) && checks.some(c => c && c.check === name && c.result === 'pass');
}

// Returns an array of { reason, message } — empty means the row may publish.
// row is whatever shape the Opportunities table / admin API produces.
function gateReasons(row, opts) {
  opts = opts || {};
  const now = opts.now || new Date();
  const maxAgeDays = opts.maxAgeDays == null ? VERIFICATION_MAX_AGE_DAYS : opts.maxAgeDays;
  const reasons = [];
  const tier = row.org_tier;
  const verification = (row.verification && typeof row.verification === 'object' && !Array.isArray(row.verification))
    ? row.verification : {};
  const checks = Array.isArray(verification.checks) ? verification.checks : null;

  // 1 / 2
  if (tier == null) {
    reasons.push({ reason: 'no_org_tier', message: 'No organization tier recorded. Research the org and set org_tier first.' });
  } else if (tier !== 'government' && tier !== 'charity') {
    reasons.push({ reason: 'invalid_org_tier', message: 'Invalid org tier.' });
  }

  // 3
  if (!row.org_domain) {
    reasons.push({ reason: 'no_org_domain', message: 'No canonical organization domain recorded.' });
  }

  // 4 / 5
  if (!row.verified_at) {
    reasons.push({ reason: 'not_verified', message: 'Not human-verified. Run the four checks, then mark verified.' });
  } else {
    const age = daysAgo(row.verified_at, now);
    if (age == null || age > maxAgeDays) {
      reasons.push({
        reason: 'stale_verification',
        message: 'Verification is stale (' + (age == null ? 'unknown age' : Math.floor(age) + ' days old') + '). Re-run the checks.',
      });
    }
  }

  if (tier === 'charity') {
    // 6
    if (!row.ein) {
      reasons.push({ reason: 'no_ein', message: 'Charity with no EIN recorded.' });
    }

    // 7 — absence from the WA registry is a failure, not an inconclusive
    // result, unless there's a documented RCW 19.09 exemption on file.
    const waExempt = verification.wa_charity && verification.wa_charity.exempt === true;
    if (!row.wa_charity_number && !waExempt) {
      reasons.push({
        reason: 'no_wa_registration',
        message: 'No Washington charity registration. Absence from the registry is a failure, not a gap — ' +
                  'record the number, or record a documented RCW 19.09 exemption.',
      });
    }

    // 8 — the tBUG condition.
    const irs = verification.irs_revocation_check;
    if (!irs || typeof irs !== 'object') {
      reasons.push({ reason: 'invalid_irs_check', message: 'No IRS auto-revocation check recorded.' });
    } else {
      const ircAge = daysAgo(irs.checked_at, now);
      if (ircAge == null) {
        reasons.push({ reason: 'invalid_irs_check', message: 'IRS auto-revocation check has no valid checked_at date.' });
      } else if (ircAge > maxAgeDays) {
        reasons.push({ reason: 'invalid_irs_check', message: 'IRS auto-revocation check is stale (' + Math.floor(ircAge) + ' days old).' });
      } else if (!irsSourceIsAuthoritative(irs.source)) {
        reasons.push({
          reason: 'invalid_irs_check',
          message: 'IRS auto-revocation check source must be an irs.gov URL (was: ' + (irs.source || 'none') + ').',
        });
      } else if (irs.result === 'listed_reinstated') {
        // Reinstatement needs a human look — never an automatic pass.
        reasons.push({
          reason: 'invalid_irs_check',
          message: 'Listed as reinstated after a prior revocation — this needs a human look, it cannot pass automatically.',
        });
      } else if (irs.result !== 'not_listed') {
        reasons.push({
          reason: 'invalid_irs_check',
          message: irs.result === 'listed_revoked'
            ? 'Organization is on the IRS automatic-revocation list.'
            : 'IRS auto-revocation check result not recognized.',
        });
      }
    }
  }

  // The human checklist attestation — separate from, and additional to, the
  // eight conditions above. Both are required.
  if (!checks) {
    reasons.push({ reason: 'no_checklist', message: 'No verification checklist recorded. Complete the checklist below.' });
  } else {
    if (!hasPassingCheck(checks, EXCLUSIONS_CHECK)) {
      reasons.push({ reason: 'exclusions_not_confirmed', message: 'Confirm none of the categorical exclusions apply.' });
    }
    if (tier === 'government' && !hasPassingCheck(checks, GOVERNMENT_CHECK)) {
      reasons.push({ reason: 'gov_checklist_incomplete', message: '"' + GOVERNMENT_CHECK + '" has not been confirmed.' });
    }
    if (tier === 'charity') {
      CHARITY_CHECKLIST.forEach(function (name) {
        if (!hasPassingCheck(checks, name)) {
          reasons.push({ reason: 'charity_checklist_incomplete', message: '"' + name + '" has not been confirmed.' });
        }
      });
    }
  }

  return reasons;
}

// Which gateReasons() reasons the 'verify' action checks — conditions 1-3 and
// 6-8 only. 4 and 5 are about verified_at itself, so an action whose entire
// purpose is to set verified_at can't be gated on it already being set. The
// checklist-attestation reasons are deliberately excluded too: verify is
// specifically an attestation about the machine-checkable org-registration
// facts, not a stand-in for completing the separate checklist, which is only
// required at approve time.
const VERIFY_ACTION_REASONS = ['no_org_tier', 'invalid_org_tier', 'no_org_domain', 'no_ein', 'no_wa_registration', 'invalid_irs_check'];

module.exports = {
  gateReasons,
  irsSourceIsAuthoritative,
  hasPassingCheck,
  VERIFICATION_MAX_AGE_DAYS,
  VERIFY_ACTION_REASONS,
  CHARITY_CHECKLIST,
  GOVERNMENT_CHECK,
  EXCLUSIONS_CHECK,
};
