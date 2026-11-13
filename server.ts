import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  calculateIcpScore,
  computeAnalyticsSummary,
  determineTier,
  extractDomainFromUrlOrEmail,
  findDuplicateLead,
  normalizeEmail,
  normalizeIngestPayload,
  routeLeadOwner,
  validateWeightsSum,
} from './src/shared/gtmLogic.ts';
import type {
  LeadIngestPayload,
  LeadRecord,
  OutreachTone,
  PipelineStage,
  ScoringConfig,
} from './src/shared/types.ts';
import { createActivity, storage } from './src/server/storage.ts';
import {
  enrichWithApollo,
  generateOutreachSequence,
  generateSalesDossier,
  syncLeadToHubSpot,
} from './src/server/integrations.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createApp() {
  await storage.init();

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (_req, res) => {
    res.json({
      ok: true,
      storage: storage.getStorageMode(),
      integrations: {
        gemini: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
        apollo: Boolean(process.env.APOLLO_API_KEY),
        hubspot: Boolean(process.env.HUBSPOT_PRIVATE_APP_TOKEN),
      },
    });
  });

  app.get('/api/v1/leads', async (_req, res) => {
    try {
      const leads = await storage.listLeads();
      res.json({ leads, storage: storage.getStorageMode() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/leads/ingest', async (req, res) => {
    try {
      const raw = req.body as Partial<LeadIngestPayload>;
      if (!raw.email || !raw.email.includes('@')) {
        return res.status(400).json({ error: 'A valid contact email is required.' });
      }

      const payload = normalizeIngestPayload(raw);
      const canonicalEmail = normalizeEmail(payload.email);
      const { domain, isFreemail } = extractDomainFromUrlOrEmail(payload.email, payload.website);
      const existingLeads = await storage.listLeads();
      const dupCheck = findDuplicateLead(canonicalEmail, domain, isFreemail, existingLeads);
      const config = await storage.getScoringConfig();

      const leadId = `lead-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      const cached = !isFreemail ? await storage.getCachedCompanyEnrichment(domain) : null;
      const apolloResult = await enrichWithApollo({
        email: canonicalEmail,
        domain,
        isFreemail,
        payload,
        cached,
      });

      const scoreRes = calculateIcpScore(
        {
          industry: apolloResult.company.industry,
          employeeCount: apolloResult.company.employeeCount,
          country: apolloResult.company.country,
          jobTitle: payload.jobTitle,
          statedPain: payload.statedPain,
          isFreemail,
          sourceChannel: payload.sourceChannel,
          techStack: apolloResult.company.techStack,
        },
        config,
      );

      const qualification = {
        id: `qual-${leadId}`,
        leadId,
        aiScore: scoreRes.totalScore,
        totalScore: scoreRes.totalScore,
        humanOverrideDelta: 0,
        overrideReason: null,
        tier: scoreRes.tier,
        criteria: scoreRes.criteria,
        evaluatedAt: nowIso,
      };

      const dossierResult = await generateSalesDossier({
        leadId,
        payload,
        company: apolloResult.company,
        enrichment: apolloResult.enrichment,
        qualification,
        isFreemail,
      });

      const routingMatch = routeLeadOwner(
        apolloResult.company.country,
        qualification.totalScore,
        config,
      );

      const stage: PipelineStage =
        qualification.totalScore >= 80 ? 'PENDING_REVIEW' : 'NEW_ENRICHED';

      const activities = [
        createActivity(
          leadId,
          'CAPTURED',
          `${payload.sourceChannel} captured ${payload.contactName} (${payload.email}).`,
          34,
          'Webhook Receiver',
          isFreemail ? 'WARNING' : 'SUCCESS',
        ),
        createActivity(
          leadId,
          'DEDUPLICATED',
          dupCheck.duplicateStatus === 'UNIQUE'
            ? `Canonical email ${canonicalEmail} & domain ${domain} verified unique.`
            : `${dupCheck.duplicateStatus} detected against ${dupCheck.duplicateOfLeadId}.`,
          19,
          'Dedupe Engine',
          dupCheck.duplicateStatus === 'UNIQUE' ? 'SUCCESS' : 'WARNING',
        ),
        createActivity(
          leadId,
          'APOLLO_ENRICHED',
          apolloResult.cacheHit
            ? `30-day Apollo cache HIT for ${domain} (${apolloResult.company.employeeCount} FTE).`
            : `Enriched ${apolloResult.company.name} (${apolloResult.company.employeeCount} FTE, ${apolloResult.enrichment.mode}).`,
          apolloResult.latencyMs,
          apolloResult.cacheHit ? 'Apollo Cache' : 'Apollo Connector',
          apolloResult.enrichment.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
        ),
        createActivity(
          leadId,
          'GEMINI_SCORED',
          `ICP Score ${qualification.totalScore}/100 (${qualification.tier}) · Dossier via ${dossierResult.dossier.model}.`,
          dossierResult.latencyMs,
          'Gemini 2.5 Flash',
          dossierResult.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
        ),
        createActivity(
          leadId,
          'ROUTED',
          `Routed to ${routingMatch.assignedOwnerName} (${routingMatch.territory}, ${routingMatch.slaTargetMinutes}m SLA).`,
          16,
          'Routing Matrix',
          'SUCCESS',
        ),
      ];

      const newLead: LeadRecord = {
        id: leadId,
        contactName: payload.contactName,
        email: payload.email,
        canonicalEmail,
        emailVerified: !isFreemail,
        isFreemail,
        duplicateStatus: dupCheck.duplicateStatus,
        duplicateOfLeadId: dupCheck.duplicateOfLeadId,
        jobTitle: payload.jobTitle,
        linkedinUrl: `https://linkedin.com/search/results/all/?keywords=${encodeURIComponent(payload.contactName)}`,
        phone: null,
        sourceChannel: payload.sourceChannel,
        statedPain: payload.statedPain,
        stage,
        slaMinutesLeft: routingMatch.slaTargetMinutes,
        createdAt: nowIso,
        updatedAt: nowIso,
        claimedByUid: null,
        company: apolloResult.company,
        enrichment: apolloResult.enrichment,
        qualification,
        dossier: dossierResult.dossier,
        routing: {
          id: `rte-${leadId}`,
          leadId,
          ...routingMatch,
          routedAt: nowIso,
        },
        hubspot: {
          synced: false,
          mode: 'SANDBOX_FALLBACK',
          companyObjectId: null,
          contactObjectId: null,
          taskObjectId: null,
          syncedAt: null,
        },
        outreach: null,
        activities,
      };

      const saved = await storage.upsertLead(newLead);
      res.status(201).json({ lead: saved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/leads/:id/enrich', async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });

      const apolloResult = await enrichWithApollo({
        email: lead.canonicalEmail,
        domain: lead.company.domain,
        isFreemail: lead.isFreemail,
        payload: {
          contactName: lead.contactName,
          email: lead.email,
          jobTitle: lead.jobTitle,
          companyName: lead.company.name,
          website: lead.company.domain,
          sourceChannel: lead.sourceChannel,
          statedPain: lead.statedPain,
          country: lead.company.country,
          employeeCount: lead.company.employeeCount,
          industry: lead.company.industry,
        },
        cached: null,
      });

      const updated: LeadRecord = {
        ...lead,
        updatedAt: new Date().toISOString(),
        company: { ...apolloResult.company, id: lead.company.id },
        enrichment: { ...apolloResult.enrichment, companyId: lead.company.id },
        activities: [
          ...lead.activities,
          createActivity(
            lead.id,
            'APOLLO_ENRICHED',
            `Manual re-enrichment refreshed ${apolloResult.company.name} (${apolloResult.enrichment.mode}).`,
            apolloResult.latencyMs,
            'Apollo Connector',
            apolloResult.enrichment.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
          ),
        ],
      };

      const saved = await storage.upsertLead(updated);
      res.json({ lead: saved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/v1/leads/:id/review', async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });

      const body = req.body as {
        decision?: 'APPROVE' | 'REJECT' | 'OVERRIDE_SCORE' | 'STAGE_MOVE';
        stage?: PipelineStage;
        overrideScore?: number;
        criteriaScores?: Record<string, number>;
        overrideReason?: string;
        assignedOwnerEmail?: string;
        assignedOwnerName?: string;
        actorName?: string;
        claimedByUid?: string;
      };

      const nowIso = new Date().toISOString();
      const actor = body.actorName || lead.routing.assignedOwnerName || 'SDR Operator';
      let nextQualification = { ...lead.qualification };
      let nextRouting = { ...lead.routing };
      let nextStage = lead.stage;
      let nextHubSpot = { ...lead.hubspot };
      const newActivities = [...lead.activities];

      if (typeof body.overrideScore === 'number') {
        const clamped = Math.max(0, Math.min(100, Math.round(body.overrideScore)));
        const delta = clamped - lead.qualification.aiScore;
        let nextCriteria = lead.qualification.criteria;
        if (body.criteriaScores) {
          nextCriteria = lead.qualification.criteria.map((c) => ({
            ...c,
            score:
              typeof body.criteriaScores?.[c.key] === 'number'
                ? Math.max(0, Math.min(c.maxWeight, Math.round(body.criteriaScores[c.key])))
                : c.score,
          }));
        }
        nextQualification = {
          ...nextQualification,
          totalScore: clamped,
          humanOverrideDelta: delta,
          overrideReason: body.overrideReason?.trim() || 'Manual SDR calibration',
          tier: determineTier(clamped),
          criteria: nextCriteria,
          evaluatedAt: nowIso,
        };
        newActivities.push(
          createActivity(
            lead.id,
            'HUMAN_REVIEWED',
            `Score calibrated to ${clamped}/100 (${delta >= 0 ? '+' : ''}${delta}): ${nextQualification.overrideReason}`,
            14,
            actor,
          ),
        );
      }

      if (body.assignedOwnerEmail) {
        nextRouting = {
          ...nextRouting,
          assignedOwnerEmail: body.assignedOwnerEmail,
          assignedOwnerName: body.assignedOwnerName || body.assignedOwnerEmail.split('@')[0],
          routedAt: nowIso,
        };
      }

      if (body.decision === 'APPROVE') {
        nextStage = 'APPROVED_SYNCING';
        const hs = await syncLeadToHubSpot(
          { ...lead, qualification: nextQualification, routing: nextRouting },
          body.overrideReason,
        );
        nextHubSpot = hs.hubspot;
        newActivities.push(
          createActivity(
            lead.id,
            'HUBSPOT_SYNCED',
            `Upserted Company ${hs.hubspot.companyObjectId}, Contact ${hs.hubspot.contactObjectId}, Task ${hs.hubspot.taskObjectId} (${hs.hubspot.mode}).`,
            hs.latencyMs,
            'HubSpot v3 Sync',
            hs.hubspot.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
          ),
        );
      } else if (body.decision === 'REJECT') {
        nextStage = 'DISQUALIFIED';
        newActivities.push(
          createActivity(
            lead.id,
            'HUMAN_REVIEWED',
            `Disqualified by ${actor}${body.overrideReason ? `: ${body.overrideReason}` : '.'}`,
            12,
            actor,
            'WARNING',
          ),
        );
      } else if (body.stage) {
        nextStage = body.stage;
        if (body.stage === 'APPROVED_SYNCING' && !lead.hubspot.synced) {
          const hs = await syncLeadToHubSpot(
            { ...lead, qualification: nextQualification, routing: nextRouting },
            body.overrideReason,
          );
          nextHubSpot = hs.hubspot;
          newActivities.push(
            createActivity(
              lead.id,
              'HUBSPOT_SYNCED',
              `Pipeline move triggered HubSpot v3 upsert (${hs.hubspot.companyObjectId}).`,
              hs.latencyMs,
              'HubSpot v3 Sync',
              hs.hubspot.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
            ),
          );
        }
      }

      const updated: LeadRecord = {
        ...lead,
        stage: nextStage,
        slaMinutesLeft: nextStage === 'APPROVED_SYNCING' || nextStage === 'DISQUALIFIED' ? 0 : lead.slaMinutesLeft,
        updatedAt: nowIso,
        claimedByUid: body.claimedByUid !== undefined ? body.claimedByUid : lead.claimedByUid,
        qualification: nextQualification,
        routing: nextRouting,
        hubspot: nextHubSpot,
        activities: newActivities,
      };

      const saved = await storage.upsertLead(updated);
      res.json({ lead: saved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  const handleGenerateOutreach: express.RequestHandler = async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });

      const tone = ((req.body as { tone?: OutreachTone })?.tone || 'DIRECT') as OutreachTone;
      const { sequence, latencyMs } = await generateOutreachSequence(lead, tone);

      const updated: LeadRecord = {
        ...lead,
        updatedAt: new Date().toISOString(),
        outreach: sequence,
        activities: [
          ...lead.activities,
          createActivity(
            lead.id,
            'OUTREACH_DRAFTED',
            `Generated ${tone} Email + LinkedIn + Call script (${sequence.mode}).`,
            latencyMs,
            'Gemini 2.5 Flash',
            sequence.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
          ),
        ],
      };

      const saved = await storage.upsertLead(updated);
      res.json({ outreach: sequence, lead: saved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  };

  app.post('/api/v1/leads/:id/generate-outreach', handleGenerateOutreach);
  app.post('/api/leads/:id/generate-outreach', handleGenerateOutreach);

  app.post('/api/v1/leads/:id/log-outreach', async (req, res) => {
    try {
      const lead = await storage.getLeadById(req.params.id);
      if (!lead) return res.status(404).json({ error: 'Lead not found.' });
      if (!lead.outreach) {
        return res.status(400).json({ error: 'Generate an outreach sequence before logging to HubSpot.' });
      }

      const nowIso = new Date().toISOString();
      const hs = lead.hubspot.synced
        ? { hubspot: lead.hubspot, latencyMs: 68 }
        : await syncLeadToHubSpot(lead, `Outreach Draft Logged:\nSubject: ${lead.outreach.emailSubject}`);

      const updated: LeadRecord = {
        ...lead,
        updatedAt: nowIso,
        hubspot: hs.hubspot,
        outreach: {
          ...lead.outreach,
          loggedToHubspotAt: nowIso,
        },
        activities: [
          ...lead.activities,
          createActivity(
            lead.id,
            'HUBSPOT_SYNCED',
            `Logged ${lead.outreach.tone} outreach draft to HubSpot Contact ${hs.hubspot.contactObjectId}.`,
            hs.latencyMs,
            'HubSpot v3 Sync',
            hs.hubspot.mode === 'LIVE_API' ? 'SUCCESS' : 'FALLBACK',
          ),
        ],
      };

      const saved = await storage.upsertLead(updated);
      res.json({ lead: saved });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/v1/config/scoring', async (_req, res) => {
    try {
      const config = await storage.getScoringConfig();
      res.json({ config });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/v1/config/scoring', async (req, res) => {
    try {
      const nextConfig = req.body as ScoringConfig;
      if (!nextConfig?.weights || !validateWeightsSum(nextConfig.weights)) {
        return res.status(400).json({ error: 'Scoring weights must sum to exactly 100 points.' });
      }

      const savedConfig = await storage.saveScoringConfig({
        ...nextConfig,
        id: nextConfig.id || 'default-icp-v1',
        updatedAt: new Date().toISOString(),
      });

      // Recalculate pending leads in queue
      const leads = await storage.listLeads();
      const updatedLeads: LeadRecord[] = [];
      for (const lead of leads) {
        if (lead.stage === 'NEW_ENRICHED' || lead.stage === 'PENDING_REVIEW') {
          const recalculated = calculateIcpScore(
            {
              industry: lead.company.industry,
              employeeCount: lead.company.employeeCount,
              country: lead.company.country,
              jobTitle: lead.jobTitle,
              statedPain: lead.statedPain,
              isFreemail: lead.isFreemail,
              sourceChannel: lead.sourceChannel,
              techStack: lead.company.techStack,
            },
            savedConfig,
          );
          const routingMatch = routeLeadOwner(
            lead.company.country,
            recalculated.totalScore + lead.qualification.humanOverrideDelta,
            savedConfig,
          );
          const finalScore = Math.max(
            0,
            Math.min(100, recalculated.totalScore + lead.qualification.humanOverrideDelta),
          );
          const updated = await storage.upsertLead({
            ...lead,
            updatedAt: new Date().toISOString(),
            qualification: {
              ...lead.qualification,
              aiScore: recalculated.totalScore,
              totalScore: finalScore,
              tier: determineTier(finalScore),
              criteria: recalculated.criteria,
              evaluatedAt: new Date().toISOString(),
            },
            routing: {
              ...lead.routing,
              ...routingMatch,
              routedAt: new Date().toISOString(),
            },
          });
          updatedLeads.push(updated);
        } else {
          updatedLeads.push(lead);
        }
      }

      res.json({ config: savedConfig, leads: updatedLeads });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/v1/analytics/summary', async (_req, res) => {
    try {
      const leads = await storage.listLeads();
      const summary = computeAnalyticsSummary(leads, storage.getStorageMode());
      res.json({ summary });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[GTM Command Center] Server listening on http://0.0.0.0:${port}`);
  });
}

createApp().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
