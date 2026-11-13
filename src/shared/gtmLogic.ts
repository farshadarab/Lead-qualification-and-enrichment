import type {
  AnalyticsSummary,
  LeadIngestPayload,
  LeadRecord,
  PriorityTier,
  ScoreCriterion,
  ScoringConfig,
  ScoringWeights,
} from './types.ts';

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
]);

export function normalizeEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const plusIndex = local.indexOf('+');
  const cleanLocal = plusIndex >= 0 ? local.slice(0, plusIndex) : local;
  return `${cleanLocal}@${domain}`;
}

export function extractDomainFromUrlOrEmail(email: string, website?: string): {
  domain: string;
  isFreemail: boolean;
} {
  const canonical = normalizeEmail(email);
  const emailDomain = canonical.split('@')[1] || '';
  const isFreemail = FREEMAIL_DOMAINS.has(emailDomain);

  if (website && website.trim().length > 0) {
    const cleaned = website
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0];
    if (cleaned.includes('.')) {
      return { domain: cleaned, isFreemail };
    }
  }

  return { domain: emailDomain || 'unknown.io', isFreemail };
}

export function findDuplicateLead(
  canonicalEmail: string,
  domain: string,
  isFreemail: boolean,
  existingLeads: LeadRecord[],
): {
  duplicateStatus: 'UNIQUE' | 'DUPLICATE_EMAIL' | 'COLLEAGUE_ACCOUNT_MATCH';
  duplicateOfLeadId: string | null;
} {
  const exactMatch = existingLeads.find(
    (l) => l.canonicalEmail.toLowerCase() === canonicalEmail.toLowerCase(),
  );
  if (exactMatch) {
    return { duplicateStatus: 'DUPLICATE_EMAIL', duplicateOfLeadId: exactMatch.id };
  }

  if (!isFreemail && domain && domain !== 'unknown.io') {
    const colleague = existingLeads.find(
      (l) => !l.isFreemail && l.company.domain.toLowerCase() === domain.toLowerCase(),
    );
    if (colleague) {
      return { duplicateStatus: 'COLLEAGUE_ACCOUNT_MATCH', duplicateOfLeadId: colleague.id };
    }
  }

  return { duplicateStatus: 'UNIQUE', duplicateOfLeadId: null };
}

export function validateWeightsSum(weights: ScoringWeights): boolean {
  const sum =
    weights.industryFit +
    weights.companySize +
    weights.geography +
    weights.jobSeniority +
    weights.useCaseFit +
    weights.buyingIntent;
  return Math.round(sum) === 100;
}

export function determineTier(score: number): PriorityTier {
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}

export function calculateIcpScore(
  input: {
    industry: string;
    employeeCount: number;
    country: string;
    jobTitle: string;
    statedPain: string;
    isFreemail: boolean;
    sourceChannel: string;
    techStack: string[];
  },
  config: ScoringConfig,
): {
  totalScore: number;
  tier: PriorityTier;
  criteria: ScoreCriterion[];
} {
  const w = config.weights;

  // 1. Industry Fit (ratio 0..1)
  const industryLower = input.industry.toLowerCase();
  const exactIndustry = config.targetIndustries.some((t) =>
    industryLower.includes(t.toLowerCase()) || t.toLowerCase().includes(industryLower),
  );
  const adjacentTech = /software|saas|ai|cloud|data|fintech|security|dev|infra|platform/i.test(
    input.industry,
  );
  const industryRatio = exactIndustry ? 1.0 : adjacentTech ? 0.72 : 0.35;
  const industryScore = Math.round(w.industryFit * industryRatio);

  // 2. Company Size Fit
  const emp = input.employeeCount;
  let sizeRatio = 0.35;
  if (emp >= 100 && emp <= 2000) sizeRatio = 1.0;
  else if (emp >= 50 && emp < 100) sizeRatio = 0.8;
  else if (emp > 2000) sizeRatio = 0.85;
  else if (emp >= 15 && emp < 50) sizeRatio = 0.55;
  else sizeRatio = 0.25;
  const sizeScore = Math.round(w.companySize * sizeRatio);

  // 3. Geography Fit
  const countryLower = input.country.toLowerCase();
  const isTier1Geo = config.tier1Countries.some(
    (c) => countryLower.includes(c.toLowerCase()) || c.toLowerCase().includes(countryLower),
  );
  const geoRatio = isTier1Geo ? 1.0 : 0.5;
  const geoScore = Math.round(w.geography * geoRatio);

  // 4. Job Seniority Fit
  const titleLower = input.jobTitle.toLowerCase();
  let seniorityRatio = 0.4;
  if (/(cro|ceo|cto|cfo|coo|chief|vp|vice president|svp|evp|founder|co-founder)/i.test(titleLower)) {
    seniorityRatio = 1.0;
  } else if (/(head of|director|principal)/i.test(titleLower)) {
    seniorityRatio = 0.85;
  } else if (/(manager|lead|architect)/i.test(titleLower)) {
    seniorityRatio = 0.6;
  }
  const seniorityScore = Math.round(w.jobSeniority * seniorityRatio);

  // 5. Business Use-Case Fit
  const pain = input.statedPain.toLowerCase();
  const hasHighValueUseCase =
    /(pipeline|enrichment|routing|hubspot|salesforce|outbound|sdr|inbound|revops|qualification|automation|attribution|compliance|enterprise|scale)/i.test(
      pain,
    );
  const stackMatch = input.techStack.some((t) =>
    /(hubspot|salesforce|snowflake|segment|dbt|marketo|outreach|salesloft)/i.test(t),
  );
  const useCaseRatio =
    hasHighValueUseCase && stackMatch
      ? 0.95
      : hasHighValueUseCase || stackMatch
        ? 0.78
        : pain.length > 25
          ? 0.55
          : 0.35;
  const useCaseScore = Math.round(w.useCaseFit * useCaseRatio);

  // 6. Buying Intent Fit
  let intentRatio = 0.5;
  if (input.sourceChannel === 'Cal.com' || /timeline|q4|this quarter|budget|demo|evaluate|migrate|urgent/i.test(pain)) {
    intentRatio = 1.0;
  } else if (input.sourceChannel === 'Web Form' || input.sourceChannel === 'Typeform') {
    intentRatio = 0.75;
  }
  if (input.isFreemail) {
    intentRatio = Math.max(0.2, intentRatio - 0.35);
  }
  const intentScore = Math.round(w.buyingIntent * intentRatio);

  const criteria: ScoreCriterion[] = [
    {
      key: 'industryFit',
      label: 'Industry Fit',
      score: industryScore,
      maxWeight: w.industryFit,
      rationale: exactIndustry
        ? `${input.industry} directly matches configured ICP target verticals.`
        : adjacentTech
          ? `${input.industry} is adjacent to core B2B SaaS ICP verticals.`
          : `${input.industry} falls outside primary ICP target industries.`,
      evidenceTag: 'VERIFIED_EVIDENCE',
    },
    {
      key: 'companySize',
      label: 'Company Size',
      score: sizeScore,
      maxWeight: w.companySize,
      rationale: `${emp.toLocaleString()} employees evaluated against mid-market & enterprise sweet spot.`,
      evidenceTag: input.isFreemail ? 'AI_INFERENCE' : 'VERIFIED_EVIDENCE',
    },
    {
      key: 'geography',
      label: 'Geography',
      score: geoScore,
      maxWeight: w.geography,
      rationale: isTier1Geo
        ? `${input.country} is in Tier-1 priority sales territories.`
        : `${input.country} routes to secondary regional coverage.`,
      evidenceTag: 'VERIFIED_EVIDENCE',
    },
    {
      key: 'jobSeniority',
      label: 'Job Seniority',
      score: seniorityScore,
      maxWeight: w.jobSeniority,
      rationale:
        seniorityRatio >= 0.85
          ? `${input.jobTitle} holds budget/buying committee authority.`
          : `${input.jobTitle} is an operational evaluator or champion.`,
      evidenceTag: 'VERIFIED_EVIDENCE',
    },
    {
      key: 'useCaseFit',
      label: 'Business Use-Case Fit',
      score: useCaseScore,
      maxWeight: w.useCaseFit,
      rationale: hasHighValueUseCase
        ? 'Stated pain aligns with automated GTM signal orchestration and CRM routing.'
        : 'Partial use-case overlap inferred from company profile.',
      evidenceTag: hasHighValueUseCase ? 'VERIFIED_EVIDENCE' : 'AI_INFERENCE',
    },
    {
      key: 'buyingIntent',
      label: 'Buying Intent',
      score: intentScore,
      maxWeight: w.buyingIntent,
      rationale: input.isFreemail
        ? 'Freemail domain lowers verified corporate buying intent until work email is confirmed.'
        : `Captured via ${input.sourceChannel} with active evaluation signals.`,
      evidenceTag: input.isFreemail ? 'UNVERIFIED_FREEMAIL' : 'VERIFIED_EVIDENCE',
    },
  ];

  const totalScore = Math.min(
    100,
    Math.max(
      0,
      criteria.reduce((acc, c) => acc + c.score, 0),
    ),
  );

  return {
    totalScore,
    tier: determineTier(totalScore),
    criteria,
  };
}

export function routeLeadOwner(
  country: string,
  totalScore: number,
  config: ScoringConfig,
): {
  assignedOwnerName: string;
  assignedOwnerEmail: string;
  territory: string;
  ruleMatched: string;
  slaTargetMinutes: number;
} {
  const countryLower = country.toLowerCase();
  const matchedRule =
    config.territoryRouting.find((rule) =>
      rule.countries.some(
        (c) => countryLower.includes(c.toLowerCase()) || c.toLowerCase().includes(countryLower),
      ),
    ) || config.territoryRouting[0];

  const slaTargetMinutes = totalScore >= 80 ? 15 : totalScore >= 50 ? 60 : 240;

  return {
    assignedOwnerName: matchedRule?.ownerName || 'Elena Vance',
    assignedOwnerEmail: matchedRule?.ownerEmail || 'elena.vance@gtmsignal.io',
    territory: matchedRule?.territory || 'North America Enterprise',
    ruleMatched:
      totalScore >= 80
        ? `Fast-Track ICP (>=80) -> ${matchedRule?.territory || 'NAMER'}`
        : `Standard Territory Queue -> ${matchedRule?.territory || 'NAMER'}`,
    slaTargetMinutes,
  };
}

export function computeAnalyticsSummary(
  leads: LeadRecord[],
  storageBackend: 'NEON_POSTGRES' | 'IN_MEMORY_WITH_FIRESTORE',
): AnalyticsSummary {
  const totalLeads = leads.length;
  if (totalLeads === 0) {
    return {
      totalLeads: 0,
      enrichmentMatchRate: 0,
      highPriorityShare: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      duplicatePreventionSavingsUsd: 0,
      duplicatesCaught: 0,
      hubspotSyncSuccessRate: 0,
      humanOverrideRate: 0,
      tierDistribution: [
        { tier: 'High (80+)', count: 0, color: '#10B981' },
        { tier: 'Medium (50-79)', count: 0, color: '#F59E0B' },
        { tier: 'Low (<50)', count: 0, color: '#EF4444' },
      ],
      channelBreakdown: [],
      overrideComparison: [
        { category: 'AI Score Accepted', count: 0 },
        { category: 'Human Override', count: 0 },
      ],
      storageBackend,
    };
  }

  const enrichedCount = leads.filter((l) => l.enrichment.matchConfidence >= 60).length;
  const highPriorityCount = leads.filter((l) => l.qualification.totalScore >= 80).length;
  const duplicatesCaught = leads.filter((l) => l.duplicateStatus !== 'UNIQUE').length;
  const syncedLeads = leads.filter((l) => l.hubspot.synced).length;
  const approvedOrSynced = leads.filter(
    (l) => l.stage === 'APPROVED_SYNCING' || l.hubspot.synced,
  ).length;
  const overriddenCount = leads.filter((l) => l.qualification.humanOverrideDelta !== 0).length;

  // Latency distribution across lead pipelines
  const pipelineLatencies = leads
    .map((l) => l.activities.reduce((sum, a) => sum + a.latencyMs, 0))
    .sort((a, b) => a - b);
  const p50Index = Math.floor(pipelineLatencies.length * 0.5);
  const p95Index = Math.min(
    pipelineLatencies.length - 1,
    Math.floor(pipelineLatencies.length * 0.95),
  );

  const highCount = highPriorityCount;
  const medCount = leads.filter(
    (l) => l.qualification.totalScore >= 50 && l.qualification.totalScore < 80,
  ).length;
  const lowCount = leads.filter((l) => l.qualification.totalScore < 50).length;

  const channelMap = new Map<string, { sum: number; count: number }>();
  for (const lead of leads) {
    const cur = channelMap.get(lead.sourceChannel) || { sum: 0, count: 0 };
    cur.sum += lead.qualification.totalScore;
    cur.count += 1;
    channelMap.set(lead.sourceChannel, cur);
  }
  const channelBreakdown = Array.from(channelMap.entries()).map(([channel, val]) => ({
    channel,
    avgScore: Math.round(val.sum / val.count),
    count: val.count,
  }));

  return {
    totalLeads,
    enrichmentMatchRate: Math.round((enrichedCount / totalLeads) * 100),
    highPriorityShare: Math.round((highPriorityCount / totalLeads) * 100),
    p50LatencyMs: pipelineLatencies[p50Index] || 0,
    p95LatencyMs: pipelineLatencies[p95Index] || 0,
    duplicatePreventionSavingsUsd: duplicatesCaught * 185,
    duplicatesCaught,
    hubspotSyncSuccessRate:
      approvedOrSynced > 0 ? Math.round((syncedLeads / approvedOrSynced) * 100) : 100,
    humanOverrideRate: Math.round((overriddenCount / totalLeads) * 100),
    tierDistribution: [
      { tier: 'High (80+)', count: highCount, color: '#10B981' },
      { tier: 'Medium (50-79)', count: medCount, color: '#F59E0B' },
      { tier: 'Low (<50)', count: lowCount, color: '#EF4444' },
    ],
    channelBreakdown,
    overrideComparison: [
      { category: 'AI Score Accepted', count: totalLeads - overriddenCount },
      { category: 'Human Override', count: overriddenCount },
    ],
    storageBackend,
  };
}

export function buildCompanyNameFromDomain(domain: string, fallbackName?: string): string {
  if (fallbackName && fallbackName.trim().length > 0) return fallbackName.trim();
  const root = domain.split('.')[0] || 'Stealth';
  return root.charAt(0).toUpperCase() + root.slice(1);
}

export function normalizeIngestPayload(payload: Partial<LeadIngestPayload>): LeadIngestPayload {
  return {
    contactName: (payload.contactName || 'Inbound Prospect').trim(),
    email: (payload.email || '').trim(),
    jobTitle: (payload.jobTitle || 'Operations Lead').trim(),
    companyName: payload.companyName?.trim(),
    website: payload.website?.trim(),
    sourceChannel: payload.sourceChannel || 'Web Form',
    statedPain: (payload.statedPain || 'Evaluating automated GTM enrichment and CRM routing.').trim(),
    country: payload.country?.trim(),
    employeeCount: payload.employeeCount,
    industry: payload.industry?.trim(),
  };
}
