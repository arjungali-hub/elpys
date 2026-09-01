// Plain-node test, no framework — run with: node test/verification-gate.test.js
// Fixtures against gateReasons(), the pure function api/admin.js calls before
// approve/verify. supabase/migrations/20260901000000_opportunity_publish_gate.sql
// implements the same eight machine-checkable conditions independently in
// SQL; that one is exercised with real SQL against the live database (see
// _work/docs/dev-log.md for the transcript — a plain node script can't run
// SQL against Supabase directly).
const { gateReasons, irsSourceIsAuthoritative, hasPassingCheck, VERIFY_ACTION_REASONS } = require('../lib/verificationGate');

let fails = 0;
const check = (label, cond, detail) => {
  if (!cond) { fails++; console.log('FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
  else console.log('ok   ' + label);
};
const reasonsOf = (row, opts) => gateReasons(row, opts).map(r => r.reason);

const NOW = new Date('2026-09-01T00:00:00Z');
const RECENT = '2026-08-15T00:00:00Z';
const OLD = '2025-01-01T00:00:00Z'; // >365 days before NOW

function baseCharity(overrides) {
  return Object.assign({
    org_tier: 'charity',
    org_domain: 'example.org',
    verified_at: RECENT,
    ein: '12-3456789',
    wa_charity_number: '1234567',
    verification: {
      checks: [
        { check: 'exclusions_confirmed', result: 'pass', source: '' },
        { check: 'irs_exempt', result: 'pass', source: '' },
        { check: 'irs_not_revoked', result: 'pass', source: '' },
        { check: 'wa_charity_active', result: 'pass', source: '' },
        { check: 'form_990_on_file', result: 'pass', source: '' },
      ],
      irs_revocation_check: { checked_at: '2026-08-30', source: 'https://apps.irs.gov/app/eos/', result: 'not_listed' },
      wa_charity: { checked_at: '2026-08-30', source: 'https://ccfs.sos.wa.gov', result: 'active', exempt: false },
    },
  }, overrides);
}
function baseGov(overrides) {
  return Object.assign({
    org_tier: 'government',
    org_domain: 'seattle.gov',
    verified_at: RECENT,
    ein: null,
    wa_charity_number: null,
    verification: {
      checks: [
        { check: 'exclusions_confirmed', result: 'pass', source: '' },
        { check: 'org_official_site', result: 'pass', source: '' },
      ],
    },
  }, overrides);
}

console.log('=== a fully compliant charity row passes both gates ===');
check('no reasons', reasonsOf(baseCharity(), { now: NOW }).length === 0, reasonsOf(baseCharity(), { now: NOW }));

console.log('\n=== a fully compliant government row passes both gates ===');
check('no reasons', reasonsOf(baseGov(), { now: NOW }).length === 0, reasonsOf(baseGov(), { now: NOW }));

console.log('\n=== condition 1: org_tier null ===');
check('no_org_tier', reasonsOf(baseCharity({ org_tier: null }), { now: NOW }).indexOf('no_org_tier') !== -1);

console.log('\n=== condition 2: invalid org_tier ===');
check('invalid_org_tier', reasonsOf(baseCharity({ org_tier: 'nonprofit' }), { now: NOW }).indexOf('invalid_org_tier') !== -1);

console.log('\n=== condition 3: no org_domain ===');
check('no_org_domain', reasonsOf(baseCharity({ org_domain: null }), { now: NOW }).indexOf('no_org_domain') !== -1);
check('government also blocked without domain', reasonsOf(baseGov({ org_domain: null }), { now: NOW }).indexOf('no_org_domain') !== -1);

console.log('\n=== condition 4: verified_at null ===');
check('not_verified', reasonsOf(baseCharity({ verified_at: null }), { now: NOW }).indexOf('not_verified') !== -1);

console.log('\n=== condition 5: verified_at stale (400 days) ===');
check('stale_verification', reasonsOf(baseCharity({ verified_at: OLD }), { now: NOW }).indexOf('stale_verification') !== -1);
check('not stale at 17 days', reasonsOf(baseCharity({ verified_at: RECENT }), { now: NOW }).indexOf('stale_verification') === -1);

console.log('\n=== condition 6: charity with no EIN ===');
check('no_ein', reasonsOf(baseCharity({ ein: null }), { now: NOW }).indexOf('no_ein') !== -1);
check('government skips EIN check (missing ein/wa# still passes)', reasonsOf(baseGov({ ein: null, wa_charity_number: null }), { now: NOW }).indexOf('no_ein') === -1);

console.log('\n=== condition 7: no WA registration is a failure, not a gap ===');
check('no_wa_registration when missing and not exempt', reasonsOf(baseCharity({ wa_charity_number: null }), { now: NOW }).indexOf('no_wa_registration') !== -1);
check('documented RCW 19.09 exemption passes without a number',
  reasonsOf(baseCharity({
    wa_charity_number: null,
    verification: Object.assign({}, baseCharity().verification, { wa_charity: { exempt: true, note: 'RCW 19.09.020 religious exemption' } }),
  }), { now: NOW }).indexOf('no_wa_registration') === -1);
check('government skips WA check', reasonsOf(baseGov({ wa_charity_number: null }), { now: NOW }).indexOf('no_wa_registration') === -1);

console.log('\n=== condition 8: the tBUG case — ProPublica must not pass as an IRS source ===');
const propublicaSource = 'https://projects.propublica.org/nonprofits/api/v2/organizations/811719474.json';
check('ProPublica source blocks',
  reasonsOf(baseCharity({
    verification: Object.assign({}, baseCharity().verification, {
      irs_revocation_check: { checked_at: '2026-08-31', source: propublicaSource, result: 'not_listed' },
    }),
  }), { now: NOW }).indexOf('invalid_irs_check') !== -1);
check('irsSourceIsAuthoritative rejects ProPublica directly', !irsSourceIsAuthoritative(propublicaSource));
check('irsSourceIsAuthoritative accepts apps.irs.gov', irsSourceIsAuthoritative('https://apps.irs.gov/app/eos/'));
check('irsSourceIsAuthoritative accepts the bulk-file ZIP URL', irsSourceIsAuthoritative('https://apps.irs.gov/pub/epostcard/data-download-revocation.zip'));
check('irsSourceIsAuthoritative rejects a lookalike host', !irsSourceIsAuthoritative('https://irs.gov.evil.com/'));
check('irsSourceIsAuthoritative rejects garbage', !irsSourceIsAuthoritative('not a url'));

console.log('\n=== condition 8: missing / stale / listed_reinstated / listed_revoked ===');
function withIrs(irs) {
  return baseCharity({ verification: Object.assign({}, baseCharity().verification, { irs_revocation_check: irs }) });
}
check('missing irs_revocation_check',
  reasonsOf(baseCharity({ verification: Object.assign({}, baseCharity().verification, { irs_revocation_check: undefined }) }), { now: NOW })
    .indexOf('invalid_irs_check') !== -1);
check('stale irs_revocation_check (checked >365d ago)',
  reasonsOf(withIrs({ checked_at: '2024-01-01', source: 'https://apps.irs.gov/app/eos/', result: 'not_listed' }), { now: NOW })
    .indexOf('invalid_irs_check') !== -1);
check('listed_revoked blocks',
  reasonsOf(withIrs({ checked_at: '2026-08-30', source: 'https://apps.irs.gov/app/eos/', result: 'listed_revoked' }), { now: NOW })
    .indexOf('invalid_irs_check') !== -1);
check('listed_reinstated blocks with its own distinct message (never an automatic pass)', (function () {
  const reasons = gateReasons(withIrs({ checked_at: '2026-08-30', source: 'https://apps.irs.gov/app/eos/', result: 'listed_reinstated' }), { now: NOW });
  const r = reasons.find(x => x.reason === 'invalid_irs_check');
  return !!r && /needs a human look/i.test(r.message) && !/automatic-revocation list/i.test(r.message);
})());

console.log('\n=== the checklist attestation (Gate A) is a SEPARATE, additional requirement ===');
check('charity with a perfect machine gate but no checklist still blocks',
  reasonsOf(baseCharity({ verification: Object.assign({}, baseCharity().verification, { checks: undefined }) }), { now: NOW })
    .indexOf('no_checklist') !== -1);
check('charity with checklist but missing one charity item blocks',
  reasonsOf(baseCharity({
    verification: Object.assign({}, baseCharity().verification, {
      checks: [
        { check: 'exclusions_confirmed', result: 'pass', source: '' },
        { check: 'irs_exempt', result: 'pass', source: '' },
        { check: 'irs_not_revoked', result: 'pass', source: '' },
        { check: 'wa_charity_active', result: 'pass', source: '' },
        // form_990_on_file missing
      ],
    }),
  }), { now: NOW }).indexOf('charity_checklist_incomplete') !== -1);
check('exclusions_confirmed missing blocks regardless of tier',
  reasonsOf(baseGov({ verification: { checks: [{ check: 'org_official_site', result: 'pass', source: '' }] } }), { now: NOW })
    .indexOf('exclusions_not_confirmed') !== -1);
check('government missing its one checklist item blocks',
  reasonsOf(baseGov({ verification: { checks: [{ check: 'exclusions_confirmed', result: 'pass', source: '' }] } }), { now: NOW })
    .indexOf('gov_checklist_incomplete') !== -1);
check('hasPassingCheck true only for an actual pass', hasPassingCheck([{ check: 'x', result: 'pass' }], 'x') === true);
check('hasPassingCheck false for a fail result', hasPassingCheck([{ check: 'x', result: 'fail' }], 'x') === false);

console.log('\n=== VERIFY_ACTION_REASONS excludes verified_at conditions and the checklist ===');
check('not_verified excluded', VERIFY_ACTION_REASONS.indexOf('not_verified') === -1);
check('stale_verification excluded', VERIFY_ACTION_REASONS.indexOf('stale_verification') === -1);
check('exclusions_not_confirmed excluded (checklist is separate from verify)', VERIFY_ACTION_REASONS.indexOf('exclusions_not_confirmed') === -1);
check('no_org_tier included', VERIFY_ACTION_REASONS.indexOf('no_org_tier') !== -1);
check('invalid_irs_check included', VERIFY_ACTION_REASONS.indexOf('invalid_irs_check') !== -1);

console.log('\nFAILURES: ' + fails);
process.exit(fails ? 1 : 0);
