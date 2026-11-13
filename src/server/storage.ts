import pg from 'pg';
import type {
  ActivityLog,
  CompanyRecord,
  EnrichmentRecord,
  LeadRecord,
  ScoringConfig,
} from '../shared/types.ts';
import { createSeedLeads, DEFAULT_SCORING_CONFIG } from '../shared/seedData.ts';

const { Pool } = pg;

class GtmStorage {
  private pool: pg.Pool | null = null;
  private usePostgres = false;
  private initialized = false;
  private memoryLeads: LeadRecord[] = [];
  private memoryConfig: ScoringConfig = structuredClone(DEFAULT_SCORING_CONFIG);

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const dbUrl = process.env.DATABASE_URL?.trim();
    if (dbUrl) {
      try {
        this.pool = new Pool({
          connectionString: dbUrl,
          ssl: dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
          max: 5,
          connectionTimeoutMillis: 5000,
        });
        await this.pool.query('SELECT 1');
        await this.ensureSchema();
        await this.seedPostgresIfEmpty();
        this.usePostgres = true;
        console.log('[GTM Storage] Connected to Neon PostgreSQL across 8 normalized tables.');
        return;
      } catch (err) {
        console.warn('[GTM Storage] PostgreSQL connection failed; using deterministic store:', (err as Error).message);
        this.pool = null;
        this.usePostgres = false;
      }
    }

    this.memoryLeads = createSeedLeads();
    this.memoryConfig = structuredClone(DEFAULT_SCORING_CONFIG);
  }

  getStorageMode(): 'NEON_POSTGRES' | 'IN_MEMORY_WITH_FIRESTORE' {
    return this.usePostgres ? 'NEON_POSTGRES' : 'IN_MEMORY_WITH_FIRESTORE';
  }

  private async ensureSchema(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        domain TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        industry TEXT NOT NULL,
        employee_count INTEGER NOT NULL,
        country TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS scoring_configs (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        canonical_email TEXT NOT NULL,
        stage TEXT NOT NULL,
        total_score INTEGER NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS enrichment_records (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        cached_until TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL,
        enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qualification_results (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        total_score INTEGER NOT NULL,
        tier TEXT NOT NULL,
        data JSONB NOT NULL,
        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS research_dossiers (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        data JSONB NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS routing_events (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        assigned_owner_email TEXT NOT NULL,
        data JSONB NOT NULL,
        routed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async seedPostgresIfEmpty(): Promise<void> {
    if (!this.pool) return;
    const cfgRes = await this.pool.query('SELECT COUNT(*)::int AS count FROM scoring_configs');
    if (cfgRes.rows[0].count === 0) {
      await this.saveScoringConfig(DEFAULT_SCORING_CONFIG);
    }

    const leadRes = await this.pool.query('SELECT COUNT(*)::int AS count FROM leads');
    if (leadRes.rows[0].count === 0) {
      const seeds = createSeedLeads();
      for (const lead of seeds) {
        await this.upsertLead(lead);
      }
    }
  }

  async listLeads(): Promise<LeadRecord[]> {
    await this.init();
    if (this.usePostgres && this.pool) {
      const res = await this.pool.query('SELECT data FROM leads ORDER BY created_at DESC');
      return res.rows.map((r) => r.data as LeadRecord);
    }
    return [...this.memoryLeads].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async getLeadById(id: string): Promise<LeadRecord | null> {
    await this.init();
    if (this.usePostgres && this.pool) {
      const res = await this.pool.query('SELECT data FROM leads WHERE id = $1', [id]);
      return res.rows[0] ? (res.rows[0].data as LeadRecord) : null;
    }
    return this.memoryLeads.find((l) => l.id === id) || null;
  }

  async upsertLead(lead: LeadRecord): Promise<LeadRecord> {
    await this.init();
    if (this.usePostgres && this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO companies (id, domain, name, industry, employee_count, country, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (domain) DO UPDATE SET
             name = EXCLUDED.name,
             industry = EXCLUDED.industry,
             employee_count = EXCLUDED.employee_count,
             country = EXCLUDED.country,
             data = EXCLUDED.data,
             updated_at = NOW()`,
          [
            lead.company.id,
            lead.company.domain,
            lead.company.name,
            lead.company.industry,
            lead.company.employeeCount,
            lead.company.country,
            JSON.stringify(lead.company),
          ],
        );

        const compIdRow = await client.query('SELECT id FROM companies WHERE domain = $1', [
          lead.company.domain,
        ]);
        const actualCompanyId = compIdRow.rows[0]?.id || lead.company.id;
        const normalizedLead: LeadRecord = {
          ...lead,
          company: { ...lead.company, id: actualCompanyId },
          enrichment: { ...lead.enrichment, companyId: actualCompanyId },
        };

        await client.query(
          `INSERT INTO leads (id, company_id, canonical_email, stage, total_score, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET
             stage = EXCLUDED.stage,
             total_score = EXCLUDED.total_score,
             data = EXCLUDED.data,
             updated_at = EXCLUDED.updated_at`,
          [
            normalizedLead.id,
            actualCompanyId,
            normalizedLead.canonicalEmail,
            normalizedLead.stage,
            normalizedLead.qualification.totalScore,
            JSON.stringify(normalizedLead),
            normalizedLead.createdAt,
            normalizedLead.updatedAt,
          ],
        );

        await client.query(
          `INSERT INTO enrichment_records (id, company_id, cached_until, data, enriched_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             cached_until = EXCLUDED.cached_until,
             data = EXCLUDED.data`,
          [
            normalizedLead.enrichment.id,
            actualCompanyId,
            normalizedLead.enrichment.cachedUntil,
            JSON.stringify(normalizedLead.enrichment),
            normalizedLead.enrichment.enrichedAt,
          ],
        );

        await client.query(
          `INSERT INTO qualification_results (id, lead_id, total_score, tier, data, evaluated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             total_score = EXCLUDED.total_score,
             tier = EXCLUDED.tier,
             data = EXCLUDED.data,
             evaluated_at = EXCLUDED.evaluated_at`,
          [
            normalizedLead.qualification.id,
            normalizedLead.id,
            normalizedLead.qualification.totalScore,
            normalizedLead.qualification.tier,
            JSON.stringify(normalizedLead.qualification),
            normalizedLead.qualification.evaluatedAt,
          ],
        );

        await client.query(
          `INSERT INTO research_dossiers (id, lead_id, model, data, generated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             data = EXCLUDED.data`,
          [
            normalizedLead.dossier.id,
            normalizedLead.id,
            normalizedLead.dossier.model,
            JSON.stringify(normalizedLead.dossier),
            normalizedLead.dossier.generatedAt,
          ],
        );

        await client.query(
          `INSERT INTO routing_events (id, lead_id, assigned_owner_email, data, routed_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             assigned_owner_email = EXCLUDED.assigned_owner_email,
             data = EXCLUDED.data`,
          [
            normalizedLead.routing.id,
            normalizedLead.id,
            normalizedLead.routing.assignedOwnerEmail,
            JSON.stringify(normalizedLead.routing),
            normalizedLead.routing.routedAt,
          ],
        );

        for (const act of normalizedLead.activities) {
          await client.query(
            `INSERT INTO activity_logs (id, lead_id, step, latency_ms, data, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [act.id, normalizedLead.id, act.step, act.latencyMs, JSON.stringify(act), act.timestamp],
          );
        }

        await client.query('COMMIT');
        return normalizedLead;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const idx = this.memoryLeads.findIndex((l) => l.id === lead.id);
    if (idx >= 0) {
      this.memoryLeads[idx] = lead;
    } else {
      this.memoryLeads.unshift(lead);
    }
    return lead;
  }

  async getCachedCompanyEnrichment(domain: string): Promise<{
    company: CompanyRecord;
    enrichment: EnrichmentRecord;
  } | null> {
    await this.init();
    const now = Date.now();
    const leads = await this.listLeads();
    const match = leads.find(
      (l) =>
        !l.isFreemail &&
        l.company.domain.toLowerCase() === domain.toLowerCase() &&
        new Date(l.enrichment.cachedUntil).getTime() > now,
    );
    if (!match) return null;
    return {
      company: match.company,
      enrichment: match.enrichment,
    };
  }

  async getScoringConfig(): Promise<ScoringConfig> {
    await this.init();
    if (this.usePostgres && this.pool) {
      const res = await this.pool.query('SELECT data FROM scoring_configs LIMIT 1');
      if (res.rows[0]) return res.rows[0].data as ScoringConfig;
    }
    return this.memoryConfig;
  }

  async saveScoringConfig(config: ScoringConfig): Promise<ScoringConfig> {
    await this.init();
    if (this.usePostgres && this.pool) {
      await this.pool.query(
        `INSERT INTO scoring_configs (id, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [config.id, JSON.stringify(config)],
      );
      return config;
    }
    this.memoryConfig = config;
    return config;
  }
}

export const storage = new GtmStorage();

export function createActivity(
  leadId: string,
  step: ActivityLog['step'],
  detail: string,
  latencyMs: number,
  actor: string,
  status: ActivityLog['status'] = 'SUCCESS',
): ActivityLog {
  return {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    leadId,
    step,
    detail,
    latencyMs,
    status,
    actor,
    timestamp: new Date().toISOString(),
  };
}
