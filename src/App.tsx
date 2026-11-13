import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  Inbox,
  Kanban,
  LogIn,
  LogOut,
  Menu,
  Plus,
  Sliders,
  Webhook,
  X,
} from 'lucide-react';
import type {
  AnalyticsSummary,
  LeadIngestPayload,
  LeadRecord,
  OutreachTone,
  PipelineStage,
  ScoringConfig,
} from './shared/types';
import { DEFAULT_SCORING_CONFIG } from './shared/seedData';
import {
  auth,
  ensureUserWorkspaceProfile,
  signInWithGoogle,
  signOutSdr,
  subscribeUserLeadQueue,
  syncConfigToFirestore,
  syncLeadToFirestore,
  type SyncedLeadSnapshot,
} from './lib/firebase';
import { InboxView } from './components/InboxView';
import { PipelineKanbanView } from './components/PipelineKanbanView';
import { LeadCaptureView } from './components/LeadCaptureView';
import { ScoringRulesView } from './components/ScoringRulesView';
import { AnalyticsView } from './components/AnalyticsView';

type WorkspaceView = 'INBOX' | 'PIPELINE' | 'CAPTURE' | 'SCORING' | 'ANALYTICS';

interface ToastItem {
  id: string;
  title: string;
  detail?: string;
  tone: 'success' | 'info' | 'error';
}

export default function App() {
  const [view, setView] = useState<WorkspaceView>('INBOX');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig>(DEFAULT_SCORING_CONFIG);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [storageMode, setStorageMode] = useState<string>('IN_MEMORY_WITH_FIRESTORE');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncedQueue, setSyncedQueue] = useState<SyncedLeadSnapshot[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback(
    (title: string, detail?: string, tone: ToastItem['tone'] = 'info') => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, title, detail, tone }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    [],
  );

  const fetchAllData = useCallback(async () => {
    try {
      const [leadsRes, cfgRes, analyticsRes] = await Promise.all([
        fetch('/api/v1/leads'),
        fetch('/api/v1/config/scoring'),
        fetch('/api/v1/analytics/summary'),
      ]);

      if (!leadsRes.ok) throw new Error('Failed to load inbound leads.');
      const leadsJson = (await leadsRes.json()) as { leads: LeadRecord[]; storage: string };
      setLeads(leadsJson.leads);
      setStorageMode(leadsJson.storage);
      setSelectedLeadId((prev) => prev || leadsJson.leads[0]?.id || null);

      if (cfgRes.ok) {
        const cfgJson = (await cfgRes.json()) as { config: ScoringConfig };
        setScoringConfig(cfgJson.config);
      }

      if (analyticsRes.ok) {
        const anaJson = (await analyticsRes.json()) as { summary: AnalyticsSummary };
        setAnalytics(anaJson.summary);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/analytics/summary');
      if (res.ok) {
        const json = (await res.json()) as { summary: AnalyticsSummary };
        setAnalytics(json.summary);
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchAllData();
  }, [fetchAllData]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        void ensureUserWorkspaceProfile(firebaseUser);
      } else {
        setSyncedQueue([]);
      }
    });
    return () => unsub();
  }, []);

  // Firestore real-time personal queue subscription (active only when authenticated)
  useEffect(() => {
    if (!authReady || !user) return;
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeUserLeadQueue(user.uid, (items) => {
        setSyncedQueue(items);
        if (items.length === 0) return;
        setLeads((prev) =>
          prev.map((lead) => {
            const match = items.find((i) => i.leadId === lead.id);
            if (!match) return lead;
            return {
              ...lead,
              stage: match.stage || lead.stage,
              claimedByUid: user.uid,
              qualification: {
                ...lead.qualification,
                totalScore: match.totalScore ?? lead.qualification.totalScore,
                overrideReason: match.overrideReason ?? lead.qualification.overrideReason,
              },
            };
          }),
        );
      });
    } catch (err) {
      console.warn('Firestore subscription notice:', (err as Error).message);
    }
    return () => {
      if (unsub) unsub();
    };
  }, [authReady, user]);

  const upsertLocalLead = useCallback((updated: LeadRecord) => {
    setLeads((prev) => {
      const exists = prev.some((l) => l.id === updated.id);
      if (exists) {
        return prev.map((l) => (l.id === updated.id ? updated : l));
      }
      return [updated, ...prev];
    });
  }, []);

  const handleReviewLead = async (
    leadId: string,
    body: {
      decision?: 'APPROVE' | 'REJECT' | 'OVERRIDE_SCORE' | 'STAGE_MOVE';
      stage?: PipelineStage;
      overrideScore?: number;
      criteriaScores?: Record<string, number>;
      overrideReason?: string;
      assignedOwnerEmail?: string;
      assignedOwnerName?: string;
    },
  ) => {
    const res = await fetch(`/api/v1/leads/${leadId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        actorName: user?.displayName || user?.email || undefined,
      }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      pushToast('Review failed', err.error || 'Unable to update lead', 'error');
      return;
    }
    const json = (await res.json()) as { lead: LeadRecord };
    upsertLocalLead(json.lead);
    void refreshAnalytics();

    if (user && (json.lead.claimedByUid === user.uid || body.decision === 'APPROVE')) {
      void syncLeadToFirestore(user.uid, json.lead).catch(() => {});
    }

    if (body.decision === 'APPROVE' || body.stage === 'APPROVED_SYNCING') {
      pushToast(
        `Synced ${json.lead.company.name} to HubSpot CRM`,
        `Company: ${json.lead.hubspot.companyObjectId} · Contact: ${json.lead.hubspot.contactObjectId} · Task: ${json.lead.hubspot.taskObjectId}`,
        'success',
      );
    } else if (body.decision === 'REJECT') {
      pushToast(`Disqualified ${json.lead.contactName}`, 'Moved to Disqualified / Nurture', 'info');
    } else if (body.decision === 'OVERRIDE_SCORE') {
      pushToast(
        `Score calibrated to ${json.lead.qualification.totalScore}/100`,
        json.lead.qualification.overrideReason || undefined,
        'info',
      );
    } else {
      pushToast(`Updated ${json.lead.contactName}`, 'Stage & assignment saved', 'info');
    }
  };

  const handleReEnrich = async (leadId: string) => {
    const res = await fetch(`/api/v1/leads/${leadId}/enrich`, { method: 'POST' });
    if (!res.ok) {
      pushToast('Re-enrichment failed', 'Apollo connector returned an error', 'error');
      return;
    }
    const json = (await res.json()) as { lead: LeadRecord };
    upsertLocalLead(json.lead);
    pushToast(
      `Re-enriched ${json.lead.company.name}`,
      `Mode: ${json.lead.enrichment.mode} · Confidence ${json.lead.enrichment.matchConfidence}%`,
      'success',
    );
  };

  const handleGenerateOutreach = async (leadId: string, tone: OutreachTone) => {
    const res = await fetch(`/api/leads/${leadId}/generate-outreach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone }),
    });
    if (!res.ok) {
      pushToast('Outreach generation failed', 'Unable to reach Gemini endpoint', 'error');
      return;
    }
    const json = (await res.json()) as { lead: LeadRecord };
    upsertLocalLead(json.lead);
    pushToast(
      `Drafted ${tone} outreach sequence`,
      `Generated Email, LinkedIn note, and Call opener (${json.lead.outreach?.mode})`,
      'success',
    );
  };

  const handleLogOutreachToHubspot = async (leadId: string) => {
    const res = await fetch(`/api/v1/leads/${leadId}/log-outreach`, { method: 'POST' });
    if (!res.ok) {
      pushToast('HubSpot log failed', 'Generate an outreach draft first', 'error');
      return;
    }
    const json = (await res.json()) as { lead: LeadRecord };
    upsertLocalLead(json.lead);
    void refreshAnalytics();
    pushToast(
      'Logged outreach draft to HubSpot',
      `Contact ${json.lead.hubspot.contactObjectId}`,
      'success',
    );
  };

  const handleClaimLead = async (leadId: string) => {
    if (!user) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const claimed: LeadRecord = {
      ...lead,
      claimedByUid: user.uid,
      routing: {
        ...lead.routing,
        assignedOwnerName: user.displayName || user.email?.split('@')[0] || 'SDR',
        assignedOwnerEmail: user.email || lead.routing.assignedOwnerEmail,
      },
    };
    await syncLeadToFirestore(user.uid, claimed);
    await handleReviewLead(leadId, {
      assignedOwnerEmail: claimed.routing.assignedOwnerEmail,
      assignedOwnerName: claimed.routing.assignedOwnerName,
    });
    pushToast('Lead claimed to personal Firestore queue', `${lead.contactName} synced across tabs`, 'success');
  };

  const handleIngestLead = async (payload: LeadIngestPayload): Promise<LeadRecord> => {
    const res = await fetch('/api/v1/leads/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Lead ingestion failed');
    }
    const json = (await res.json()) as { lead: LeadRecord };
    upsertLocalLead(json.lead);
    setSelectedLeadId(json.lead.id);
    void refreshAnalytics();
    pushToast(
      `Captured ${json.lead.contactName} (${json.lead.qualification.totalScore}/100)`,
      `${json.lead.company.name} · ${json.lead.routing.territory}`,
      'success',
    );
    return json.lead;
  };

  const handleSaveScoringConfig = async (next: ScoringConfig) => {
    const res = await fetch('/api/v1/config/scoring', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Failed to update scoring rules');
    }
    const json = (await res.json()) as { config: ScoringConfig; leads: LeadRecord[] };
    setScoringConfig(json.config);
    setLeads(json.leads);
    void refreshAnalytics();
    if (user) {
      void syncConfigToFirestore(user.uid, json.config).catch(() => {});
    }
    pushToast(
      'Scoring matrix saved & queue recalculated',
      'Pending leads updated with new 100-pt weights',
      'success',
    );
  };

  const navItems: {
    id: WorkspaceView;
    label: string;
    icon: typeof Inbox;
    badge?: number;
  }[] = [
    {
      id: 'INBOX',
      label: 'Triage Inbox',
      icon: Inbox,
      badge: leads.filter((l) => l.stage === 'PENDING_REVIEW' || l.stage === 'NEW_ENRICHED').length,
    },
    { id: 'PIPELINE', label: 'Pipeline Board', icon: Kanban, badge: leads.length },
    { id: 'CAPTURE', label: 'Lead Capture', icon: Webhook },
    { id: 'SCORING', label: 'Scoring Rules', icon: Sliders },
    { id: 'ANALYTICS', label: 'Analytics', icon: BarChart3 },
  ];

  const viewTitles: Record<WorkspaceView, string> = {
    INBOX: 'SDR Triage Inbox',
    PIPELINE: 'Pipeline Kanban Board',
    CAPTURE: 'Live Lead Capture & Batch Importer',
    SCORING: 'ICP Scoring Rules & Routing Matrix',
    ANALYTICS: 'Executive Revenue & SLA Analytics',
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#090A0D] text-[#E6E8EE]">
      {/* Mobile Sidebar Overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* LEFT SIDEBAR NAVIGATION */}
      <aside
        aria-label="Workspace navigation"
        className={`fixed md:static inset-y-0 left-0 z-40 w-[248px] shrink-0 bg-[#0D0F14] border-r border-white/[0.08] flex flex-col justify-between transition-transform duration-150 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex flex-col min-h-0">
          {/* Brand Wordmark */}
          <div className="h-[52px] px-4 border-b border-white/[0.08] flex items-center justify-between gap-2">
            <span className="font-display font-semibold text-sm tracking-tight text-white whitespace-nowrap">
              GTM Signal
            </span>
            <button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setMobileNavOpen(false)}
              className="md:hidden p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* 5 Workspace Views */}
          <nav className="p-2.5 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setView(item.id);
                    setMobileNavOpen(false);
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#5E6AD2]/15 text-white border border-[#5E6AD2]/35'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 ${active ? 'text-[#8B95F2]' : 'text-slate-400'}`}
                      aria-hidden="true"
                    />
                    {item.label}
                  </span>
                  {typeof item.badge === 'number' && (
                    <span className="font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Personal Queue Status when signed in */}
          {user && (
            <div className="mx-3 mt-3 p-3 rounded-md bg-white/[0.03] border border-white/[0.07] space-y-1">
              <div className="text-[11px] font-medium text-slate-300">
                Firestore Personal Queue
              </div>
              <div className="text-xs font-mono tabular-nums text-emerald-300">
                {syncedQueue.length} claimed leads synced
              </div>
            </div>
          )}
        </div>

        {/* Bottom SDR Auth Block */}
        <div className="p-3 border-t border-white/[0.08] space-y-2">
          {user ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'SDR Avatar'}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full border border-white/[0.15] shrink-0 object-cover"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-[#5E6AD2]/25 border border-[#5E6AD2]/40 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                    {(user.displayName || user.email || 'S')[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate">
                    {user.displayName || 'SDR Operator'}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{user.email}</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="Sign out"
                onClick={() => void signOutSdr()}
                className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-white/[0.06]"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={async () => {
                try {
                  await signInWithGoogle();
                  pushToast('Signed in with Google', 'Personal approval queue synced to Firestore', 'success');
                } catch (err) {
                  pushToast('Sign-in cancelled', (err as Error).message, 'info');
                }
              }}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-white/[0.06] border border-white/[0.1] text-white rounded-md hover:bg-white/[0.1] transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              Sign in with Google
            </button>
          )}
        </div>
      </aside>

      {/* MAIN VIEWPORT */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Top Header Contract */}
        <header className="h-[52px] shrink-0 px-4 border-b border-white/[0.08] bg-[#090A0D] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-1.5 text-slate-300 hover:text-white rounded hover:bg-white/[0.06]"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </button>
            <h1 className="text-sm font-semibold text-white truncate">
              {viewTitles[view]}
            </h1>
            <span className="hidden sm:inline text-xs text-slate-500" aria-hidden="true">
              /
            </span>
            <span className="hidden sm:inline text-xs text-slate-400 whitespace-nowrap">
              {storageMode === 'NEON_POSTGRES' ? 'Neon PostgreSQL' : 'Dual Store + Firestore'}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setView('CAPTURE')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Capture Lead
            </button>
          </div>
        </header>

        {/* Active View Content */}
        <main className="flex-1 min-h-0 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              <div className="h-8 w-64 bg-white/[0.05] rounded animate-pulse" />
              <div className="h-48 w-full bg-white/[0.04] rounded animate-pulse" />
            </div>
          ) : loadError ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-rose-300">{loadError}</p>
              <button
                type="button"
                onClick={() => void fetchAllData()}
                className="px-3 py-1.5 text-xs font-medium bg-[#5E6AD2] text-white rounded-md"
              >
                Retry Connection
              </button>
            </div>
          ) : (
            <>
              {view === 'INBOX' && (
                <InboxView
                  leads={leads}
                  selectedLeadId={selectedLeadId}
                  onSelectLead={setSelectedLeadId}
                  scoringConfig={scoringConfig}
                  isAuthenticated={Boolean(user)}
                  onReviewLead={handleReviewLead}
                  onReEnrich={handleReEnrich}
                  onGenerateOutreach={handleGenerateOutreach}
                  onLogOutreachToHubspot={handleLogOutreachToHubspot}
                  onClaimLead={handleClaimLead}
                  onNavigateCapture={() => setView('CAPTURE')}
                />
              )}

              {view === 'PIPELINE' && (
                <PipelineKanbanView
                  leads={leads}
                  onMoveStage={async (leadId, nextStage) => {
                    await handleReviewLead(leadId, {
                      decision: nextStage === 'APPROVED_SYNCING' ? 'APPROVE' : 'STAGE_MOVE',
                      stage: nextStage,
                    });
                  }}
                  onOpenLead={(leadId) => {
                    setSelectedLeadId(leadId);
                    setView('INBOX');
                  }}
                />
              )}

              {view === 'CAPTURE' && (
                <LeadCaptureView
                  onIngestLead={handleIngestLead}
                  onOpenLeadInInbox={(leadId) => {
                    setSelectedLeadId(leadId);
                    setView('INBOX');
                  }}
                />
              )}

              {view === 'SCORING' && (
                <ScoringRulesView
                  config={scoringConfig}
                  onSaveConfig={handleSaveScoringConfig}
                />
              )}

              {view === 'ANALYTICS' && (
                <AnalyticsView summary={analytics} leads={leads} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto p-3 rounded-md border shadow-lg bg-[#141720] space-y-0.5 ${
                t.tone === 'success'
                  ? 'border-emerald-500/40'
                  : t.tone === 'error'
                    ? 'border-rose-500/40'
                    : 'border-white/[0.15]'
              }`}
            >
              <div className="text-xs font-semibold text-white">{t.title}</div>
              {t.detail && <div className="text-[11px] text-slate-300 font-mono">{t.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
