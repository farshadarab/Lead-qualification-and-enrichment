export type DataSourceMode = 'LIVE_API' | 'SANDBOX_FALLBACK';

export type SourceChannel = 'Web Form' | 'Cal.com' | 'Typeform' | 'HubSpot Webhook' | 'CSV Import';

export type PipelineStage =
  | 'NEW_ENRICHED'
  | 'PENDING_REVIEW'
  | 'APPROVED_SYNCING'
  | 'DISQUALIFIED';

export type PriorityTier = 'HIGH' | 'MEDIUM' | 'LOW';

export type EvidenceTag = 'VERIFIED_EVIDENCE' | 'AI_INFERENCE' | 'UNVERIFIED_FREEMAIL';

export type OutreachTone = 'DIRECT' | 'CONSULTATIVE' | 'TECHNICAL';

export interface ScoreCriterion {
  key: 'industryFit' | 'companySize' | 'geography' | 'jobSeniority' | 'useCaseFit' | 'buyingIntent';
  label: string;
  score: number;
  maxWeight: number;
  rationale: string;
  evidenceTag: EvidenceTag;
}

export interface DossierStatement {
  text: string;
  evidence: EvidenceTag;
  sourceLabel?: string;
}

export interface ResearchDossier {
  id: string;
  leadId: string;
  model: string;
  mode: DataSourceMode;
  companyOverview: DossierStatement;
  businessModel: DossierStatement;
  targetAudience: DossierStatement;
  statedPain: DossierStatement;
  inferredChallenges: DossierStatement[];
  discoveryQuestions: DossierStatement[];
  objectionsAndMissingInfo: DossierStatement[];
  buyingSignals: DossierStatement[];
  recommendedAngle: DossierStatement;
  confidenceSummary: string;
  generatedAt: string;
}

export interface CompanyRecord {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employeeCount: number;
  employeeRange: string;
  country: string;
  city: string;
  annualRevenue: string;
  fundingStage: string;
  techStack: string[];
  description: string;
  linkedinUrl: string;
}

export interface EnrichmentRecord {
  id: string;
  companyId: string;
  provider: 'APOLLO';
  mode: DataSourceMode;
  matchConfidence: number;
  cachedUntil: string;
  enrichedAt: string;
  rawSignals: {
    hiringVelocity: string;
    departmentHeadcountSales: number;
    departmentHeadcountEng: number;
    recentNews: string;
  };
}

export interface QualificationResult {
  id: string;
  leadId: string;
  aiScore: number;
  totalScore: number;
  humanOverrideDelta: number;
  overrideReason: string | null;
  tier: PriorityTier;
  criteria: ScoreCriterion[];
  evaluatedAt: string;
}

export interface RoutingEvent {
  id: string;
  leadId: string;
  assignedOwnerName: string;
  assignedOwnerEmail: string;
  territory: string;
  ruleMatched: string;
  slaTargetMinutes: number;
  routedAt: string;
}

export interface ActivityLog {
  id: string;
  leadId: string;
  step:
    | 'CAPTURED'
    | 'DEDUPLICATED'
    | 'APOLLO_ENRICHED'
    | 'GEMINI_SCORED'
    | 'ROUTED'
    | 'OUTREACH_DRAFTED'
    | 'HUMAN_REVIEWED'
    | 'HUBSPOT_SYNCED';
  detail: string;
  latencyMs: number;
  status: 'SUCCESS' | 'WARNING' | 'FALLBACK';
  actor: string;
  timestamp: string;
}

export interface OutreachSequence {
  leadId: string;
  tone: OutreachTone;
  mode: DataSourceMode;
  emailSubject: string;
  emailBody: string;
  linkedinNote: string;
  callOpenerScript: string;
  generatedAt: string;
  loggedToHubspotAt?: string | null;
}

export interface HubSpotSyncInfo {
  synced: boolean;
  mode: DataSourceMode;
  companyObjectId: string | null;
  contactObjectId: string | null;
  taskObjectId: string | null;
  syncedAt: string | null;
}

export interface LeadRecord {
  id: string;
  contactName: string;
  email: string;
  canonicalEmail: string;
  emailVerified: boolean;
  isFreemail: boolean;
  duplicateStatus: 'UNIQUE' | 'DUPLICATE_EMAIL' | 'COLLEAGUE_ACCOUNT_MATCH';
  duplicateOfLeadId: string | null;
  jobTitle: string;
  linkedinUrl: string;
  phone: string | null;
  sourceChannel: SourceChannel;
  statedPain: string;
  stage: PipelineStage;
  slaMinutesLeft: number;
  createdAt: string;
  updatedAt: string;
  claimedByUid: string | null;
  company: CompanyRecord;
  enrichment: EnrichmentRecord;
  qualification: QualificationResult;
  dossier: ResearchDossier;
  routing: RoutingEvent;
  hubspot: HubSpotSyncInfo;
  outreach: OutreachSequence | null;
  activities: ActivityLog[];
}

export interface ScoringWeights {
  industryFit: number;
  companySize: number;
  geography: number;
  jobSeniority: number;
  useCaseFit: number;
  buyingIntent: number;
}

export interface TerritoryRule {
  territory: string;
  countries: string[];
  ownerName: string;
  ownerEmail: string;
}

export interface ScoringConfig {
  id: string;
  weights: ScoringWeights;
  targetIndustries: string[];
  idealSizeRanges: string[];
  tier1Countries: string[];
  territoryRouting: TerritoryRule[];
  updatedAt: string;
}

export interface AnalyticsSummary {
  totalLeads: number;
  enrichmentMatchRate: number;
  highPriorityShare: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  duplicatePreventionSavingsUsd: number;
  duplicatesCaught: number;
  hubspotSyncSuccessRate: number;
  humanOverrideRate: number;
  tierDistribution: { tier: string; count: number; color: string }[];
  channelBreakdown: { channel: string; avgScore: number; count: number }[];
  overrideComparison: { category: string; count: number }[];
  storageBackend: 'NEON_POSTGRES' | 'IN_MEMORY_WITH_FIRESTORE';
}

export interface LeadIngestPayload {
  contactName: string;
  email: string;
  jobTitle: string;
  companyName?: string;
  website?: string;
  sourceChannel: SourceChannel;
  statedPain: string;
  country?: string;
  employeeCount?: number;
  industry?: string;
}
