import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Mail,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type {
  LeadRecord,
  OutreachTone,
  ScoringConfig,
} from '../shared/types';
import {
  CompanyMonogram,
  EvidenceTagBadge,
  ModeBadge,
  ScoreBadge,
  StageLabel,
} from './CompanyMonogram';

type InboxFilter = 'ALL' | 'HIGH_PRIORITY' | 'NEEDS_REVIEW' | 'FREEMAIL' | 'SYNCED';
type CockpitTab = 'SCORE' | 'DOSSIER' | 'OUTREACH' | 'TIMELINE';

interface InboxViewProps {
  leads: LeadRecord[];
  selectedLeadId: string | null;
  onSelectLead: (id: string) => void;
  scoringConfig: ScoringConfig;
  isAuthenticated: boolean;
  onReviewLead: (
    leadId: string,
    body: {
      decision?: 'APPROVE' | 'REJECT' | 'OVERRIDE_SCORE';
      overrideScore?: number;
      criteriaScores?: Record<string, number>;
      overrideReason?: string;
      assignedOwnerEmail?: string;
      assignedOwnerName?: string;
    },
  ) => Promise<void>;
  onReEnrich: (leadId: string) => Promise<void>;
  onGenerateOutreach: (leadId: string, tone: OutreachTone) => Promise<void>;
  onLogOutreachToHubspot: (leadId: string) => Promise<void>;
  onClaimLead: (leadId: string) => Promise<void>;
  onNavigateCapture: () => void;
}

export function InboxView({
  leads,
  selectedLeadId,
  onSelectLead,
  scoringConfig,
  isAuthenticated,
  onReviewLead,
  onReEnrich,
  onGenerateOutreach,
  onLogOutreachToHubspot,
  onClaimLead,
  onNavigateCapture,
}: InboxViewProps) {
  const [filter, setFilter] = useState<InboxFilter>('ALL');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<CockpitTab>('SCORE');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Score Simulator local draft state
  const [draftCriteria, setDraftCriteria] = useState<Record<string, number>>({});
  const [overrideReason, setOverrideReason] = useState('');
  const [scoreError, setScoreError] = useState<string | null>(null);

  // Outreach Studio local state
  const [outreachTone, setOutreachTone] = useState<OutreachTone>('DIRECT');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (filter === 'HIGH_PRIORITY' && lead.qualification.totalScore < 80) return false;
      if (
        filter === 'NEEDS_REVIEW' &&
        lead.stage !== 'PENDING_REVIEW' &&
        lead.stage !== 'NEW_ENRICHED'
      ) {
        return false;
      }
      if (filter === 'FREEMAIL' && !lead.isFreemail && lead.emailVerified) return false;
      if (filter === 'SYNCED' && !lead.hubspot.synced) return false;

      if (!q) return true;
      return (
        lead.contactName.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        lead.company.name.toLowerCase().includes(q) ||
        lead.company.domain.toLowerCase().includes(q) ||
        lead.company.techStack.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [leads, filter, search]);

  const activeLead = useMemo(() => {
    return (
      leads.find((l) => l.id === selectedLeadId) ||
      filteredLeads[0] ||
      leads[0] ||
      null
    );
  }, [leads, filteredLeads, selectedLeadId]);

  useEffect(() => {
    if (!activeLead) return;
    const map: Record<string, number> = {};
    for (const c of activeLead.qualification.criteria) {
      map[c.key] = c.score;
    }
    setDraftCriteria(map);
    setOverrideReason(activeLead.qualification.overrideReason || '');
    setScoreError(null);
    if (activeLead.outreach) {
      setOutreachTone(activeLead.outreach.tone);
    }
  }, [activeLead?.id, activeLead?.qualification.evaluatedAt]);

  // Keyboard shortcuts: Cmd/Ctrl + Enter to Approve & Sync; J / K to move selection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!activeLead) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (activeLead.stage !== 'APPROVED_SYNCING' && !busyAction) {
          void handleApprove();
        }
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        const idx = filteredLeads.findIndex((l) => l.id === activeLead.id);
        if (idx >= 0 && idx < filteredLeads.length - 1) {
          e.preventDefault();
          onSelectLead(filteredLeads[idx + 1].id);
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        const idx = filteredLeads.findIndex((l) => l.id === activeLead.id);
        if (idx > 0) {
          e.preventDefault();
          onSelectLead(filteredLeads[idx - 1].id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const draftTotalScore = useMemo(() => {
    if (!activeLead) return 0;
    return activeLead.qualification.criteria.reduce(
      (sum, c) => sum + (draftCriteria[c.key] ?? c.score),
      0,
    );
  }, [activeLead, draftCriteria]);

  const scoreModified = activeLead
    ? draftTotalScore !== activeLead.qualification.totalScore
    : false;

  const handleApprove = async () => {
    if (!activeLead) return;
    setBusyAction('approve');
    try {
      await onReviewLead(activeLead.id, {
        decision: 'APPROVE',
        ...(scoreModified && overrideReason.trim()
          ? {
              overrideScore: draftTotalScore,
              criteriaScores: draftCriteria,
              overrideReason: overrideReason.trim(),
            }
          : {}),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReject = async () => {
    if (!activeLead) return;
    setBusyAction('reject');
    try {
      await onReviewLead(activeLead.id, {
        decision: 'REJECT',
        overrideReason: overrideReason.trim() || 'Disqualified during SDR triage',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveScoreOverride = async () => {
    if (!activeLead) return;
    if (!overrideReason.trim()) {
      setScoreError('Provide a brief override reason before saving score calibration.');
      return;
    }
    setScoreError(null);
    setBusyAction('score');
    try {
      await onReviewLead(activeLead.id, {
        decision: 'OVERRIDE_SCORE',
        overrideScore: draftTotalScore,
        criteriaScores: draftCriteria,
        overrideReason: overrideReason.trim(),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleOwnerChange = async (email: string) => {
    if (!activeLead) return;
    const rule = scoringConfig.territoryRouting.find((r) => r.ownerEmail === email);
    setBusyAction('owner');
    try {
      await onReviewLead(activeLead.id, {
        assignedOwnerEmail: email,
        assignedOwnerName: rule?.ownerName || email.split('@')[0],
      });
    } finally {
      setBusyAction(null);
    }
  };

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const filterTabs: { id: InboxFilter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All', count: leads.length },
    {
      id: 'HIGH_PRIORITY',
      label: 'High Priority (80+)',
      count: leads.filter((l) => l.qualification.totalScore >= 80).length,
    },
    {
      id: 'NEEDS_REVIEW',
      label: 'Needs Review',
      count: leads.filter((l) => l.stage === 'PENDING_REVIEW' || l.stage === 'NEW_ENRICHED').length,
    },
    {
      id: 'FREEMAIL',
      label: 'Freemail / Unverified',
      count: leads.filter((l) => l.isFreemail || !l.emailVerified).length,
    },
    {
      id: 'SYNCED',
      label: 'Synced to HubSpot',
      count: leads.filter((l) => l.hubspot.synced).length,
    },
  ];

  const owners = useMemo(() => {
    const unique = new Map<string, string>();
    for (const r of scoringConfig.territoryRouting) {
      unique.set(r.ownerEmail, r.ownerName);
    }
    if (activeLead && !unique.has(activeLead.routing.assignedOwnerEmail)) {
      unique.set(activeLead.routing.assignedOwnerEmail, activeLead.routing.assignedOwnerName);
    }
    return Array.from(unique.entries()).map(([email, name]) => ({ email, name }));
  }, [scoringConfig, activeLead]);

  const emailWordCount = activeLead?.outreach
    ? activeLead.outreach.emailBody.trim().split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0">
      {/* LEFT PANE: Filterable Lead Stream */}
      <section
        aria-label="Inbound lead stream"
        className="w-full lg:w-[390px] xl:w-[420px] shrink-0 border-b lg:border-b-0 lg:border-r border-white/[0.08] flex flex-col bg-[#0D0F14] min-h-0 max-h-[420px] lg:max-h-none"
      >
        <div className="p-3.5 border-b border-white/[0.08] space-y-2.5">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <label htmlFor="inbox-lead-search" className="sr-only">
              Search leads by company, domain, email, or tech stack
            </label>
            <input
              id="inbox-lead-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, domain, email, or stack..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#141720] border border-white/[0.09] rounded-md text-[#E6E8EE] placeholder:text-slate-500 focus:outline-none focus:border-[#5E6AD2]"
            />
          </div>

          <div
            role="tablist"
            aria-label="Lead priority filters"
            className="flex flex-wrap items-center gap-1.5"
          >
            {filterTabs.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(tab.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-[#5E6AD2] text-white'
                      : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="font-mono tabular-nums opacity-75 ml-0.5">{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
          {filteredLeads.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-200">No leads match this filter</p>
              <p className="text-xs text-slate-400">
                Adjust your search query or capture a fresh inbound persona to populate this queue.
              </p>
              <button
                type="button"
                onClick={onNavigateCapture}
                className="px-3 py-1.5 text-xs font-medium bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors"
              >
                Open Lead Capture
              </button>
            </div>
          ) : (
            filteredLeads.map((lead) => {
              const isSelected = activeLead?.id === lead.id;
              return (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onSelectLead(lead.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`w-full text-left px-3.5 py-3 transition-colors flex flex-col gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5E6AD2] ${
                    isSelected
                      ? 'bg-[#5E6AD2]/[0.12]'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CompanyMonogram
                        name={lead.company.name}
                        domain={lead.company.domain}
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-white truncate">
                            {lead.contactName}
                          </span>
                          {lead.duplicateStatus !== 'UNIQUE' && (
                            <span className="text-[10px] font-mono text-amber-300 shrink-0">
                              Colleague
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {lead.jobTitle} · {lead.company.name}
                        </p>
                      </div>
                    </div>
                    <ScoreBadge score={lead.qualification.totalScore} />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className="text-slate-300 truncate">{lead.sourceChannel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono truncate">{lead.company.domain}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums shrink-0 text-slate-300">
                      <Clock className="w-3 h-3 text-slate-400" aria-hidden="true" />
                      {lead.hubspot.synced
                        ? 'Synced'
                        : lead.stage === 'DISQUALIFIED'
                          ? 'Closed'
                          : `${lead.slaMinutesLeft}m left`}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* RIGHT PANE: 360° Account Dossier & Action Cockpit */}
      <section
        aria-label="Lead account cockpit"
        className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#090A0D]"
      >
        {!activeLead ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="space-y-3 max-w-sm">
              <h2 className="text-base font-semibold text-white">Select an inbound lead</h2>
              <p className="text-xs text-slate-400">
                Choose any record from the triage stream to review Apollo firmographics, Gemini 2.5 Flash dossier evidence, and HubSpot sync controls.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Cockpit Header Bar */}
            <header className="px-5 py-3.5 border-b border-white/[0.08] bg-[#0D0F14] space-y-3">
              <div className="flex items-start gap-3 min-w-0">
                <CompanyMonogram
                  name={activeLead.company.name}
                  domain={activeLead.company.domain}
                  size="lg"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-white truncate">
                      {activeLead.contactName}
                    </h2>
                    <StageLabel stage={activeLead.stage} />
                    <ScoreBadge score={activeLead.qualification.totalScore} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                    <span className="text-slate-200">{activeLead.jobTitle}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-200">{activeLead.company.name}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-300">{activeLead.canonicalEmail}</span>
                    {activeLead.emailVerified ? (
                      <span className="inline-flex items-center gap-1 text-emerald-300">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        Verified Email
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <ShieldAlert className="w-3 h-3" aria-hidden="true" />
                        Unverified Freemail
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <a
                      href={activeLead.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[#8B95F2] hover:text-white transition-colors"
                    >
                      LinkedIn
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Action Cockpit Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="cockpit-owner-select" className="text-[11px] text-slate-400">
                      Owner
                    </label>
                    <select
                      id="cockpit-owner-select"
                      value={activeLead.routing.assignedOwnerEmail}
                      disabled={busyAction !== null}
                      onChange={(e) => void handleOwnerChange(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-slate-200 focus:outline-none focus:border-[#5E6AD2]"
                    >
                      {owners.map((o) => (
                        <option key={o.email} value={o.email}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isAuthenticated && (
                    <button
                      type="button"
                      onClick={() => void onClaimLead(activeLead.id)}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white/[0.05] border border-white/[0.1] text-slate-200 rounded-md hover:bg-white/[0.09] transition-colors whitespace-nowrap shrink-0"
                    >
                      <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      {activeLead.claimedByUid ? 'Synced to Queue' : 'Claim Lead'}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setBusyAction('enrich');
                      try {
                        await onReEnrich(activeLead.id);
                      } finally {
                        setBusyAction(null);
                      }
                    }}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white/[0.05] border border-white/[0.1] text-slate-200 rounded-md hover:bg-white/[0.09] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${busyAction === 'enrich' ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    Re-Enrich via Apollo
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleReject()}
                    disabled={busyAction !== null || activeLead.stage === 'DISQUALIFIED'}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-rose-500/10 border border-rose-500/25 text-rose-300 rounded-md hover:bg-rose-500/20 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                  >
                    <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    Reject / Disqualify
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleApprove()}
                    disabled={busyAction !== null || activeLead.stage === 'APPROVED_SYNCING'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    {activeLead.hubspot.synced
                      ? 'Synced to HubSpot'
                      : busyAction === 'approve'
                        ? 'Syncing...'
                        : 'Approve & Sync to HubSpot (Cmd+Enter)'}
                  </button>
                </div>
              </div>

              {/* Compact Firmographics Strip + Cockpit Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span>{activeLead.company.industry}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {activeLead.company.employeeCount.toLocaleString()} FTE
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeLead.company.city}, {activeLead.company.country}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeLead.company.fundingStage}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-300">
                    Stack: {activeLead.company.techStack.slice(0, 4).join(', ')}
                  </span>
                </div>

                {activeLead.hubspot.synced && (
                  <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-300">
                    <span>HS Co: {activeLead.hubspot.companyObjectId}</span>
                    <span aria-hidden="true">·</span>
                    <span>Contact: {activeLead.hubspot.contactObjectId}</span>
                  </div>
                )}
              </div>

              {/* Tab Navigation */}
              <div
                role="tablist"
                aria-label="Account cockpit tabs"
                className="flex items-center gap-1 border-t border-white/[0.06] pt-2.5 overflow-x-auto"
              >
                {(
                  [
                    { id: 'SCORE', label: 'ICP Score Simulator' },
                    { id: 'DOSSIER', label: 'Epistemic Sales Dossier' },
                    { id: 'OUTREACH', label: 'AI Outreach Studio' },
                    { id: 'TIMELINE', label: `Audit & Webhook Timeline (${activeLead.activities.length})` },
                  ] as const
                ).map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        active
                          ? 'bg-white/[0.1] text-white'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </header>

            {/* Tab Content Viewport */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeTab === 'SCORE' && (
                <div className="max-w-4xl space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        6-Criterion ICP Rubric Breakdown
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Adjust individual dimensions using sliders or steppers and record an override reason.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-[11px] text-slate-400">Simulated Total</div>
                        <div className="text-xl font-mono tabular-nums font-semibold text-white">
                          {draftTotalScore} <span className="text-xs text-slate-400">/ 100</span>
                        </div>
                      </div>
                      <ScoreBadge score={draftTotalScore} />
                    </div>
                  </div>

                  <div className="divide-y divide-white/[0.06]">
                    {activeLead.qualification.criteria.map((criterion) => {
                      const val = draftCriteria[criterion.key] ?? criterion.score;
                      const pct =
                        criterion.maxWeight > 0
                          ? Math.round((val / criterion.maxWeight) * 100)
                          : 0;
                      const barColor =
                        pct >= 80
                          ? 'bg-emerald-500'
                          : pct >= 50
                            ? 'bg-amber-500'
                            : 'bg-rose-500';
                      return (
                        <div key={criterion.key} className="py-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-white">
                                {criterion.label}
                              </span>
                              <EvidenceTagBadge tag={criterion.evidenceTag} />
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Decrease ${criterion.label}`}
                                onClick={() =>
                                  setDraftCriteria((prev) => ({
                                    ...prev,
                                    [criterion.key]: Math.max(0, val - 1),
                                  }))
                                }
                                className="w-6 h-6 inline-flex items-center justify-center rounded border border-white/[0.1] bg-white/[0.04] text-xs text-slate-200 hover:bg-white/[0.1]"
                              >
                                -
                              </button>
                              <span className="w-14 text-center font-mono tabular-nums text-xs text-white">
                                {val} / {criterion.maxWeight}
                              </span>
                              <button
                                type="button"
                                aria-label={`Increase ${criterion.label}`}
                                onClick={() =>
                                  setDraftCriteria((prev) => ({
                                    ...prev,
                                    [criterion.key]: Math.min(criterion.maxWeight, val + 1),
                                  }))
                                }
                                className="w-6 h-6 inline-flex items-center justify-center rounded border border-white/[0.1] bg-white/[0.04] text-xs text-slate-200 hover:bg-white/[0.1]"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-150 ${barColor}`}
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <input
                              type="range"
                              aria-label={`${criterion.label} slider`}
                              min={0}
                              max={criterion.maxWeight}
                              value={val}
                              onChange={(e) =>
                                setDraftCriteria((prev) => ({
                                  ...prev,
                                  [criterion.key]: Number(e.target.value),
                                }))
                              }
                              className="w-28 accent-[#5E6AD2] cursor-pointer"
                            />
                          </div>

                          <p className="text-xs text-slate-400">{criterion.rationale}</p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-4 border-t border-white/[0.08] space-y-3">
                    <label
                      htmlFor="override-reason-input"
                      className="block text-xs font-medium text-slate-200"
                    >
                      SDR Calibration / Override Reason
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        id="override-reason-input"
                        type="text"
                        value={overrideReason}
                        onChange={(e) => {
                          setOverrideReason(e.target.value);
                          setScoreError(null);
                        }}
                        placeholder="e.g., Confirmed Q4 enterprise budget on LinkedIn / pre-call verification"
                        className="flex-1 px-3 py-2 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white placeholder:text-slate-500 focus:outline-none focus:border-[#5E6AD2]"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveScoreOverride()}
                        disabled={busyAction !== null}
                        className="px-4 py-2 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                      >
                        {busyAction === 'score' ? 'Saving...' : 'Save Score Calibration'}
                      </button>
                    </div>
                    {scoreError && (
                      <p className="text-xs text-rose-300 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        {scoreError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'DOSSIER' && (
                <div className="max-w-4xl space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Epistemic Gemini 2.5 Flash Sales Dossier
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {activeLead.dossier.confidenceSummary}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ModeBadge mode={activeLead.dossier.mode} label="Gemini" />
                      <ModeBadge mode={activeLead.enrichment.mode} label="Apollo" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-white/[0.08]">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-200">Company Overview</span>
                        <EvidenceTagBadge tag={activeLead.dossier.companyOverview.evidence} />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        {activeLead.dossier.companyOverview.text}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-200">Business Model</span>
                        <EvidenceTagBadge tag={activeLead.dossier.businessModel.evidence} />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        {activeLead.dossier.businessModel.text}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-200">Target Audience</span>
                        <EvidenceTagBadge tag={activeLead.dossier.targetAudience.evidence} />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        {activeLead.dossier.targetAudience.text}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-200">Recommended Angle</span>
                        <EvidenceTagBadge tag={activeLead.dossier.recommendedAngle.evidence} />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        {activeLead.dossier.recommendedAngle.text}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-white/[0.08]">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-200">
                          Stated Pain ({activeLead.sourceChannel})
                        </span>
                        <EvidenceTagBadge tag={activeLead.dossier.statedPain.evidence} />
                      </div>
                      <p className="text-xs leading-relaxed text-slate-200 bg-[#12151E] p-3 rounded-md border border-white/[0.07]">
                        “{activeLead.dossier.statedPain.text}”
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <span className="text-xs font-semibold text-slate-200 block">
                        Inferred Challenges
                      </span>
                      <ul className="space-y-2">
                        {activeLead.dossier.inferredChallenges.map((item, i) => (
                          <li key={i} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-slate-300">{item.text}</span>
                              <EvidenceTagBadge tag={item.evidence} />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <span className="text-xs font-semibold text-slate-200 block">
                        3 Discovery Questions for Call
                      </span>
                      <ol className="space-y-2.5">
                        {activeLead.dossier.discoveryQuestions.map((q, i) => (
                          <li key={i} className="space-y-1 pb-2 border-b border-white/[0.05] last:border-b-0">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs text-slate-200 leading-relaxed">
                                {i + 1}. {q.text}
                              </span>
                              <EvidenceTagBadge tag={q.evidence} />
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-slate-200 block">
                          Buying Signals
                        </span>
                        <ul className="space-y-2">
                          {activeLead.dossier.buyingSignals.map((sig, i) => (
                            <li key={i} className="flex items-start justify-between gap-2">
                              <span className="text-xs text-slate-300">{sig.text}</span>
                              <EvidenceTagBadge tag={sig.evidence} />
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-2 pt-3 border-t border-white/[0.06]">
                        <span className="text-xs font-semibold text-slate-200 block">
                          Objections & Missing Info
                        </span>
                        <ul className="space-y-2">
                          {activeLead.dossier.objectionsAndMissingInfo.map((obj, i) => (
                            <li key={i} className="flex items-start justify-between gap-2">
                              <span className="text-xs text-slate-300">{obj.text}</span>
                              <EvidenceTagBadge tag={obj.evidence} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'OUTREACH' && (
                <div className="max-w-4xl space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Interactive AI Outreach Sequence Studio
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Synthesizes stated pain, Apollo tech stack, and account dossier via Gemini 2.5 Flash.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div
                        role="group"
                        aria-label="Outreach tone selector"
                        className="inline-flex items-center p-0.5 bg-[#141720] border border-white/[0.09] rounded-md"
                      >
                        {(
                          [
                            { id: 'DIRECT', label: 'Direct & Concise' },
                            { id: 'CONSULTATIVE', label: 'Consultative' },
                            { id: 'TECHNICAL', label: 'Technical / Founder-to-Founder' },
                          ] as const
                        ).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setOutreachTone(t.id)}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                              outreachTone === t.id
                                ? 'bg-[#5E6AD2] text-white'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          setBusyAction('outreach');
                          try {
                            await onGenerateOutreach(activeLead.id, outreachTone);
                          } finally {
                            setBusyAction(null);
                          }
                        }}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        {busyAction === 'outreach'
                          ? 'Generating...'
                          : activeLead.outreach
                            ? 'Regenerate Sequence'
                            : 'Generate Outreach'}
                      </button>
                    </div>
                  </div>

                  {!activeLead.outreach ? (
                    <div className="py-10 px-6 text-center bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3">
                      <p className="text-sm font-medium text-white">
                        Ready to draft personalized outreach for {activeLead.contactName}
                      </p>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        Select a tone above and click Generate Outreach to produce a &lt;75-word inbound email, &lt;280-char LinkedIn note, and AE discovery opener.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ModeBadge mode={activeLead.outreach.mode} label="Draft" />
                          <span className="text-xs text-slate-400">
                            Tone: <span className="text-slate-200">{activeLead.outreach.tone}</span>
                          </span>
                          {activeLead.outreach.loggedToHubspotAt && (
                            <span className="text-xs text-emerald-300">
                              · Logged to HubSpot
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            setBusyAction('log-outreach');
                            try {
                              await onLogOutreachToHubspot(activeLead.id);
                            } finally {
                              setBusyAction(null);
                            }
                          }}
                          disabled={busyAction !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded-md hover:bg-emerald-500/25 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Send className="w-3.5 h-3.5" aria-hidden="true" />
                          {busyAction === 'log-outreach'
                            ? 'Logging...'
                            : 'Log Draft to HubSpot'}
                        </button>
                      </div>

                      {/* 1. Email */}
                      <div className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-white">
                            <Mail className="w-3.5 h-3.5 text-[#8B95F2]" aria-hidden="true" />
                            Cold / Inbound Follow-up Email
                            <span className="font-mono tabular-nums text-[11px] font-normal text-slate-400">
                              ({emailWordCount} words)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(
                                'email',
                                `Subject: ${activeLead.outreach!.emailSubject}\n\n${activeLead.outreach!.emailBody}`,
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-300 hover:text-white bg-white/[0.04] border border-white/[0.08] rounded"
                          >
                            {copiedKey === 'email' ? (
                              <Check className="w-3 h-3 text-emerald-300" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3 h-3" aria-hidden="true" />
                            )}
                            {copiedKey === 'email' ? 'Copied' : 'Copy to Clipboard'}
                          </button>
                        </div>
                        <div className="text-xs text-slate-300">
                          <span className="text-slate-500">Subject: </span>
                          <span className="font-medium text-white">
                            {activeLead.outreach.emailSubject}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-line">
                          {activeLead.outreach.emailBody}
                        </p>
                      </div>

                      {/* 2. LinkedIn Note */}
                      <div className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-white">
                            <MessageSquare className="w-3.5 h-3.5 text-[#8B95F2]" aria-hidden="true" />
                            LinkedIn Connection Note
                            <span className="font-mono tabular-nums text-[11px] font-normal text-slate-400">
                              ({activeLead.outreach.linkedinNote.length} / 280 chars)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyText('linkedin', activeLead.outreach!.linkedinNote)
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-300 hover:text-white bg-white/[0.04] border border-white/[0.08] rounded"
                          >
                            {copiedKey === 'linkedin' ? (
                              <Check className="w-3 h-3 text-emerald-300" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3 h-3" aria-hidden="true" />
                            )}
                            {copiedKey === 'linkedin' ? 'Copied' : 'Copy to Clipboard'}
                          </button>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">
                          {activeLead.outreach.linkedinNote}
                        </p>
                      </div>

                      {/* 3. Call Opener */}
                      <div className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-white">
                            <PhoneCall className="w-3.5 h-3.5 text-[#8B95F2]" aria-hidden="true" />
                            AE Discovery Call Opener Script
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              copyText('call', activeLead.outreach!.callOpenerScript)
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-300 hover:text-white bg-white/[0.04] border border-white/[0.08] rounded"
                          >
                            {copiedKey === 'call' ? (
                              <Check className="w-3 h-3 text-emerald-300" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3 h-3" aria-hidden="true" />
                            )}
                            {copiedKey === 'call' ? 'Copied' : 'Copy to Clipboard'}
                          </button>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">
                          “{activeLead.outreach.callOpenerScript}”
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'TIMELINE' && (
                <div className="max-w-3xl space-y-4">
                  <div className="pb-3 border-b border-white/[0.08]">
                    <h3 className="text-sm font-semibold text-white">
                      Audit & Webhook Pipeline Timeline
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      End-to-end deterministic trace from webhook capture to HubSpot CRM v3 sync.
                    </p>
                  </div>

                  <ol className="space-y-0 divide-y divide-white/[0.06]">
                    {activeLead.activities.map((act) => (
                      <li key={act.id} className="py-3.5 flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-semibold text-white">
                              {act.step}
                            </span>
                            <span className="text-[11px] text-slate-400">{act.actor}</span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                act.status === 'SUCCESS'
                                  ? 'bg-emerald-500/10 text-emerald-300'
                                  : act.status === 'WARNING'
                                    ? 'bg-amber-500/10 text-amber-300'
                                    : 'bg-white/[0.06] text-slate-300'
                              }`}
                            >
                              {act.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{act.detail}</p>
                        </div>

                        <div className="text-right shrink-0 space-y-0.5">
                          <div className="text-xs font-mono tabular-nums text-emerald-300">
                            {act.latencyMs}ms
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            {new Date(act.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
