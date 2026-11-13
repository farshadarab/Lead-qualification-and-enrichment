import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Check,
  Code2,
  Copy,
  FileSpreadsheet,
  Play,
  Upload,
  Zap,
} from 'lucide-react';
import type { LeadIngestPayload, LeadRecord, SourceChannel } from '../shared/types';
import { ScoreBadge } from './CompanyMonogram';

interface LeadCaptureViewProps {
  onIngestLead: (payload: LeadIngestPayload) => Promise<LeadRecord>;
  onOpenLeadInInbox: (leadId: string) => void;
}

const PERSONA_PRESETS: { label: string; payload: LeadIngestPayload }[] = [
  {
    label: 'Tier-1 US SaaS VP',
    payload: {
      contactName: 'Claire Donovan',
      email: 'claire.donovan@linear.app',
      jobTitle: 'VP of Revenue Operations',
      companyName: 'Linear',
      website: 'linear.app',
      sourceChannel: 'Cal.com',
      country: 'United States',
      employeeCount: 110,
      industry: 'B2B SaaS',
      statedPain:
        'Need real-time HubSpot enrichment and ICP scoring for 400+ weekly inbound enterprise signups before Q4 kickoff.',
    },
  },
  {
    label: 'Stealth AI Founder on Gmail',
    payload: {
      contactName: 'Tariq Mahmood',
      email: 'tariq.builds.ai@gmail.com',
      jobTitle: 'Founder',
      companyName: 'Stealth Vector',
      website: '',
      sourceChannel: 'Web Form',
      country: 'United States',
      employeeCount: 5,
      industry: 'AI Infrastructure',
      statedPain: 'Exploring automated outbound tools for our early pre-seed launch.',
    },
  },
  {
    label: 'European FinTech CRO',
    payload: {
      contactName: 'Sophie Laurent',
      email: 'sophie.laurent@revolut.com',
      jobTitle: 'Chief Revenue Officer',
      companyName: 'Revolut',
      website: 'revolut.com',
      sourceChannel: 'Web Form',
      country: 'United Kingdom',
      employeeCount: 9500,
      industry: 'FinTech',
      statedPain:
        'Consolidating EMEA inbound routing across HubSpot and Salesforce with strict auditability and sub-15m SLA.',
    },
  },
  {
    label: 'Duplicate Colleague Test',
    payload: {
      contactName: 'Jordan Ellis',
      email: 'jordan.ellis+demo@latticecloud.io',
      jobTitle: 'Director of GTM Systems',
      companyName: 'LatticeCloud',
      website: 'latticecloud.io',
      sourceChannel: 'HubSpot Webhook',
      country: 'United States',
      employeeCount: 420,
      industry: 'B2B SaaS',
      statedPain:
        'Joining Hannah Chen on the HubSpot + Apollo enrichment evaluation for our 78-person sales org.',
    },
  },
];

type SnippetTab = 'CURL' | 'TYPEFORM' | 'HUBSPOT';

export function LeadCaptureView({ onIngestLead, onOpenLeadInInbox }: LeadCaptureViewProps) {
  const [form, setForm] = useState<LeadIngestPayload>(PERSONA_PRESETS[0].payload);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastIngested, setLastIngested] = useState<LeadRecord | null>(null);

  // Batch CSV / domain importer state
  const [batchText, setBatchText] = useState(
    'stripe.com\nvercel.com\nattio.com\nlinear.app\nbuildgrid.dev',
  );
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [batchResults, setBatchResults] = useState<LeadRecord[]>([]);

  // Webhook inspector state
  const [snippetTab, setSnippetTab] = useState<SnippetTab>('CURL');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.run.app';
  const webhookUrl = `${origin}/api/v1/leads/ingest`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !form.email.includes('@')) {
      setFormError('Enter a valid work or personal email address.');
      return;
    }
    if (!form.contactName.trim()) {
      setFormError('Contact name is required.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await onIngestLead(form);
      setLastIngested(created);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBatchText(text);
  };

  const runBatchImport = async () => {
    const lines = batchText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().startsWith('domain,'));

    const targets = lines.slice(0, 20);
    if (targets.length === 0) return;

    setBatchRunning(true);
    setBatchProgress({ done: 0, total: targets.length });
    setBatchResults([]);

    const createdList: LeadRecord[] = [];
    for (let i = 0; i < targets.length; i++) {
      const line = targets[i];
      const cols = line.split(',').map((c) => c.trim());
      const domainOrEmail = cols[0];
      const isEmail = domainOrEmail.includes('@');
      const domain = isEmail ? domainOrEmail.split('@')[1] : domainOrEmail.replace(/^https?:\/\//, '');
      const email = isEmail ? domainOrEmail : `revops@${domain}`;
      const contactName = cols[1] || `VP RevOps (${domain.split('.')[0]})`;
      const jobTitle = cols[2] || 'VP of Revenue Operations';

      try {
        const res = await onIngestLead({
          contactName,
          email,
          jobTitle,
          website: domain,
          sourceChannel: 'CSV Import',
          statedPain: `Batch domain evaluation for ${domain} inbound enrichment and HubSpot sync.`,
        });
        createdList.push(res);
      } catch {
        // continue batch
      }
      setBatchProgress({ done: i + 1, total: targets.length });
    }
    setBatchResults(createdList);
    setBatchRunning(false);
  };

  const snippetContent: Record<SnippetTab, string> = {
    CURL: `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contactName": "Hannah Chen",
    "email": "hannah.chen@latticecloud.io",
    "jobTitle": "VP of Revenue Operations",
    "website": "latticecloud.io",
    "sourceChannel": "Web Form",
    "statedPain": "Automate inbound Apollo enrichment and HubSpot routing."
  }'`,
    TYPEFORM: `{
  "event_type": "form_response",
  "webhook_target": "${webhookUrl}",
  "mapped_payload": {
    "contactName": "{{answer_full_name}}",
    "email": "{{answer_work_email}}",
    "jobTitle": "{{answer_role}}",
    "website": "{{answer_company_url}}",
    "sourceChannel": "Typeform",
    "statedPain": "{{answer_use_case}}"
  }
}`,
    HUBSPOT: `{
  "workflow_action": "Send Webhook (POST)",
  "endpoint_url": "${webhookUrl}",
  "authentication": "None (Server-Side Verified)",
  "body": {
    "contactName": "{{contact.firstname}} {{contact.lastname}}",
    "email": "{{contact.email}}",
    "jobTitle": "{{contact.jobtitle}}",
    "website": "{{company.domain}}",
    "sourceChannel": "HubSpot Webhook",
    "statedPain": "{{contact.hs_lead_status_notes}}"
  }
}`,
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Interactive Public Form Preview */}
        <section
          aria-label="Live B2B Demo Request Form"
          className="lg:col-span-6 p-5 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-4"
        >
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-white">
              Live Inbound Form & Persona Simulator
            </h2>
            <p className="text-xs text-slate-400">
              Load a 1-click B2B persona or enter custom details to run live deduplication, Apollo enrichment, Gemini 2.5 Flash dossier synthesis, and territory routing.
            </p>
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-slate-400 block">
              1-Click Persona Presets
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PERSONA_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setForm(preset.payload);
                    setFormError(null);
                  }}
                  className="px-2.5 py-1 text-[11px] font-medium rounded border border-white/[0.1] bg-white/[0.04] text-slate-200 hover:bg-[#5E6AD2]/20 hover:border-[#5E6AD2]/50 hover:text-white transition-colors whitespace-nowrap"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 pt-2 border-t border-white/[0.06]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="cap-name" className="text-xs text-slate-300 block">
                  Contact Name
                </label>
                <input
                  id="cap-name"
                  type="text"
                  required
                  value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="cap-email" className="text-xs text-slate-300 block">
                  Work Email
                </label>
                <input
                  id="cap-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="cap-title" className="text-xs text-slate-300 block">
                  Job Title
                </label>
                <input
                  id="cap-title"
                  type="text"
                  value={form.jobTitle}
                  onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="cap-website" className="text-xs text-slate-300 block">
                  Company Domain
                </label>
                <input
                  id="cap-website"
                  type="text"
                  placeholder="e.g. latticecloud.io"
                  value={form.website || ''}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="cap-channel" className="text-xs text-slate-300 block">
                  Source Channel
                </label>
                <select
                  id="cap-channel"
                  value={form.sourceChannel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sourceChannel: e.target.value as SourceChannel }))
                  }
                  className="w-full px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                >
                  <option value="Web Form">Web Form</option>
                  <option value="Cal.com">Cal.com</option>
                  <option value="Typeform">Typeform</option>
                  <option value="HubSpot Webhook">HubSpot Webhook</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="cap-country" className="text-xs text-slate-300 block">
                  Country (Optional Override)
                </label>
                <input
                  id="cap-country"
                  type="text"
                  value={form.country || ''}
                  onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="cap-pain" className="text-xs text-slate-300 block">
                Stated Business Pain / Use Case
              </label>
              <textarea
                id="cap-pain"
                rows={3}
                value={form.statedPain}
                onChange={(e) => setForm((f) => ({ ...f, statedPain: e.target.value }))}
                className="w-full px-3 py-2 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
              />
            </div>

            {formError && <p className="text-xs text-rose-300">{formError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" aria-hidden="true" />
              {submitting ? 'Running Enrichment & Gemini Pipeline...' : 'Submit & Run Ingestion Pipeline'}
            </button>
          </form>

          {lastIngested && (
            <div className="p-3.5 rounded-md bg-emerald-500/[0.08] border border-emerald-500/25 flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate">
                    Ingested: {lastIngested.contactName}
                  </span>
                  <ScoreBadge score={lastIngested.qualification.totalScore} />
                </div>
                <p className="text-[11px] text-slate-300 truncate">
                  {lastIngested.company.name} · Routed to {lastIngested.routing.assignedOwnerName} (
                  {lastIngested.duplicateStatus})
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenLeadInInbox(lastIngested.id)}
                className="px-2.5 py-1 text-xs font-medium bg-white/[0.1] text-white rounded hover:bg-white/[0.18] whitespace-nowrap shrink-0"
              >
                Inspect Dossier
              </button>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: CSV Batch Importer + Webhook Inspector */}
        <div className="lg:col-span-6 space-y-6">
          <section
            aria-label="CSV and Bulk Domain Importer"
            className="p-5 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#8B95F2]" aria-hidden="true" />
                  CSV / Bulk Domain Batch Importer
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Paste 5–20 domains (or CSV rows: domain, contact, title) to enrich and score sequentially.
                </p>
              </div>

              <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white/[0.05] border border-white/[0.1] text-slate-200 rounded cursor-pointer hover:bg-white/[0.1]">
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                Upload CSV
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => void handleCsvUpload(e)}
                  className="sr-only"
                />
              </label>
            </div>

            <label htmlFor="batch-domain-textarea" className="sr-only">
              Domains or CSV rows
            </label>
            <textarea
              id="batch-domain-textarea"
              rows={4}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-[#141720] border border-white/[0.1] rounded-md text-slate-200 focus:outline-none focus:border-[#5E6AD2]"
            />

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void runBatchImport()}
                disabled={batchRunning}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                {batchRunning
                  ? `Enriching ${batchProgress.done}/${batchProgress.total}...`
                  : 'Run Batch Enrichment'}
              </button>

              {batchProgress.total > 0 && (
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-150"
                      style={{
                        width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-slate-300">
                    {batchProgress.done}/{batchProgress.total}
                  </span>
                </div>
              )}
            </div>

            {batchResults.length > 0 && (
              <div className="pt-2 border-t border-white/[0.06] space-y-1.5 max-h-40 overflow-y-auto">
                {batchResults.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded bg-white/[0.03]"
                  >
                    <span className="text-slate-200 truncate">
                      {r.company.name} ({r.company.domain})
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <ScoreBadge score={r.qualification.totalScore} />
                      <button
                        type="button"
                        onClick={() => onOpenLeadInInbox(r.id)}
                        className="text-[11px] text-[#8B95F2] hover:text-white"
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            aria-label="Webhook Endpoint Inspector"
            className="p-5 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-[#8B95F2]" aria-hidden="true" />
                Live Webhook Receiver
              </h2>
              <div className="inline-flex items-center p-0.5 bg-[#141720] border border-white/[0.08] rounded-md">
                {(['CURL', 'TYPEFORM', 'HUBSPOT'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSnippetTab(tab)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                      snippetTab === tab
                        ? 'bg-[#5E6AD2] text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab === 'CURL' ? 'cURL' : tab === 'TYPEFORM' ? 'Typeform' : 'HubSpot'}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-3 py-2 bg-[#141720] border border-white/[0.08] rounded flex items-center justify-between gap-2">
              <code className="text-[11px] font-mono text-emerald-300 truncate">
                POST {webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(snippetContent[snippetTab]);
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 1500);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-300 hover:text-white bg-white/[0.05] rounded shrink-0"
              >
                {copiedSnippet ? (
                  <Check className="w-3 h-3 text-emerald-300" aria-hidden="true" />
                ) : (
                  <Copy className="w-3 h-3" aria-hidden="true" />
                )}
                {copiedSnippet ? 'Copied' : 'Copy Snippet'}
              </button>
            </div>

            <pre className="p-3 bg-[#090A0D] border border-white/[0.07] rounded text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
              {snippetContent[snippetTab]}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
