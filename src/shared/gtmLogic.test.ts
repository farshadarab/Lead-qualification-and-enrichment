import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateIcpScore,
  computeAnalyticsSummary,
  extractDomainFromUrlOrEmail,
  findDuplicateLead,
  normalizeEmail,
  routeLeadOwner,
  validateWeightsSum,
} from './gtmLogic.ts';
import { createSeedLeads, DEFAULT_SCORING_CONFIG } from './seedData.ts';

test('normalizeEmail strips +alias and normalizes case', () => {
  assert.equal(normalizeEmail('  Jane.Doe+webinar@Acme.IO '), 'jane.doe@acme.io');
  assert.equal(normalizeEmail('founder@startup.ai'), 'founder@startup.ai');
});

test('extractDomainFromUrlOrEmail detects freemail vs corporate and honors website', () => {
  const freemail = extractDomainFromUrlOrEmail('alex@gmail.com');
  assert.equal(freemail.isFreemail, true);
  assert.equal(freemail.domain, 'gmail.com');

  const freemailWithSite = extractDomainFromUrlOrEmail('alex@gmail.com', 'https://www.novapay.io/demo');
  assert.equal(freemailWithSite.isFreemail, true);
  assert.equal(freemailWithSite.domain, 'novapay.io');

  const corp = extractDomainFromUrlOrEmail('vp@datadoghq.com');
  assert.equal(corp.isFreemail, false);
  assert.equal(corp.domain, 'datadoghq.com');
});

test('findDuplicateLead catches canonical +alias duplicates and colleague account matches', () => {
  const leads = createSeedLeads();
  const exactDup = findDuplicateLead('hannah.chen@latticecloud.io', 'latticecloud.io', false, leads);
  assert.equal(exactDup.duplicateStatus, 'DUPLICATE_EMAIL');
  assert.equal(exactDup.duplicateOfLeadId, 'lead-vanta-01');

  const colleague = findDuplicateLead('cto@payledger.eu', 'payledger.eu', false, leads);
  assert.equal(colleague.duplicateStatus, 'COLLEAGUE_ACCOUNT_MATCH');
  assert.equal(colleague.duplicateOfLeadId, 'lead-stripe-eu-02');

  const freemailNoMatch = findDuplicateLead('other@gmail.com', 'gmail.com', true, leads);
  assert.equal(freemailNoMatch.duplicateStatus, 'UNIQUE');
});

test('validateWeightsSum enforces 100-point rubric total', () => {
  assert.equal(validateWeightsSum(DEFAULT_SCORING_CONFIG.weights), true);
  assert.equal(
    validateWeightsSum({ ...DEFAULT_SCORING_CONFIG.weights, industryFit: 25 }),
    false,
  );
});

test('calculateIcpScore produces high tier for US SaaS VP and low tier for pre-seed freemail', () => {
  const high = calculateIcpScore(
    {
      industry: 'B2B SaaS',
      employeeCount: 450,
      country: 'United States',
      jobTitle: 'VP of Revenue Operations',
      statedPain: 'Need automated HubSpot enrichment and routing in Q4',
      isFreemail: false,
      sourceChannel: 'Cal.com',
      techStack: ['HubSpot', 'Snowflake'],
    },
    DEFAULT_SCORING_CONFIG,
  );
  assert.ok(high.totalScore >= 85, `Expected >= 85, got ${high.totalScore}`);
  assert.equal(high.tier, 'HIGH');

  const low = calculateIcpScore(
    {
      industry: 'Local Services',
      employeeCount: 4,
      country: 'Brazil',
      jobTitle: 'Intern',
      statedPain: 'Looking around',
      isFreemail: true,
      sourceChannel: 'Web Form',
      techStack: [],
    },
    DEFAULT_SCORING_CONFIG,
  );
  assert.ok(low.totalScore < 50, `Expected < 50, got ${low.totalScore}`);
  assert.equal(low.tier, 'LOW');
});

test('routeLeadOwner maps EMEA vs NAMER territories and sets SLA target', () => {
  const emea = routeLeadOwner('Germany', 90, DEFAULT_SCORING_CONFIG);
  assert.equal(emea.territory, 'EMEA Strategic');
  assert.equal(emea.assignedOwnerName, 'Marcus Sterling');
  assert.equal(emea.slaTargetMinutes, 15);

  const namerMed = routeLeadOwner('United States', 65, DEFAULT_SCORING_CONFIG);
  assert.equal(namerMed.territory, 'NAMER Enterprise');
  assert.equal(namerMed.slaTargetMinutes, 60);
});

test('computeAnalyticsSummary aggregates KPIs accurately', () => {
  const leads = createSeedLeads();
  const summary = computeAnalyticsSummary(leads, 'IN_MEMORY_WITH_FIRESTORE');
  assert.equal(summary.totalLeads, 6);
  assert.equal(summary.duplicatesCaught, 1);
  assert.equal(summary.duplicatePreventionSavingsUsd, 185);
  assert.ok(summary.p50LatencyMs > 0);
  assert.ok(summary.p95LatencyMs >= summary.p50LatencyMs);
});
