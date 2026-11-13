import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Check, Copy, Download } from 'lucide-react';
import type { AnalyticsSummary, LeadRecord } from '../shared/types';

interface AnalyticsViewProps {
  summary: AnalyticsSummary | null;
  leads: LeadRecord[];
}

export function AnalyticsView({ summary, leads }: AnalyticsViewProps) {
  const [copiedSheets, setCopiedSheets] = useState(false);

  const exportCsv = () => {
    const headers = [
      'Lead ID',
      'Contact Name',
      'Email',
      'Job Title',
      'Company',
      'Domain',
      'Industry',
      'Employees',
      'Country',
      'Source Channel',
      'AI Score',
      'Final Score',
      'Stage',
      'Assigned Owner',
      'HubSpot Company ID',
      'HubSpot Contact ID',
    ];
    const escapeCell = (val: string | number) => {
      const str = String(val ?? '');
      return `"${str.replace(/"/g, '""')}"`;
    };
    const rows = leads.map((l) =>
      [
        l.id,
        l.contactName,
        l.canonicalEmail,
        l.jobTitle,
        l.company.name,
        l.company.domain,
        l.company.industry,
        l.company.employeeCount,
        l.company.country,
        l.sourceChannel,
        l.qualification.aiScore,
        l.qualification.totalScore,
        l.stage,
        l.routing.assignedOwnerEmail,
        l.hubspot.companyObjectId || '',
        l.hubspot.contactObjectId || '',
      ]
        .map(escapeCell)
        .join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gtm-signal-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyForSheets = () => {
    const headers = ['Contact', 'Company', 'Score', 'Stage', 'Owner', 'Channel', 'HubSpot ID'].join('\t');
    const rows = leads.map((l) =>
      [
        l.contactName,
        l.company.name,
        l.qualification.totalScore,
        l.stage,
        l.routing.assignedOwnerName,
        l.sourceChannel,
        l.hubspot.companyObjectId || 'Pending',
      ].join('\t'),
    );
    void navigator.clipboard.writeText([headers, ...rows].join('\n'));
    setCopiedSheets(true);
    setTimeout(() => setCopiedSheets(false), 1600);
  };

  if (!summary) {
    return (
      <div className="p-6 text-xs text-slate-400">Loading pipeline analytics...</div>
    );
  }

  const kpis = [
    {
      label: 'Total Leads Captured',
      value: summary.totalLeads.toLocaleString(),
      sub: `${summary.duplicatesCaught} duplicates / colleagues flagged`,
    },
    {
      label: 'Enrichment Match Rate',
      value: `${summary.enrichmentMatchRate}%`,
      sub: 'Apollo 30-day cache + org match',
    },
    {
      label: 'High-Priority ICP Share',
      value: `${summary.highPriorityShare}%`,
      sub: 'Leads scoring 80+ / 100',
    },
    {
      label: 'Pipeline Latency (P50 / P95)',
      value: `${summary.p50LatencyMs}ms / ${summary.p95LatencyMs}ms`,
      sub: 'Capture -> Enrich -> Score -> Route',
    },
    {
      label: 'Duplicate Prevention Savings',
      value: `$${summary.duplicatePreventionSavingsUsd.toLocaleString()}`,
      sub: 'Saved SDR prep & enrichment spend',
    },
    {
      label: 'HubSpot Sync Success Rate',
      value: `${summary.hubspotSyncSuccessRate}%`,
      sub: `Backend: ${summary.storageBackend === 'NEON_POSTGRES' ? 'Neon PostgreSQL' : 'Workspace + Firestore'}`,
    },
  ];

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div>
            <h2 className="text-base font-semibold text-white">
              Executive Revenue & SLA Analytics
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time operational telemetry across inbound capture, enrichment caching, ICP scoring, and HubSpot v3 delivery.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyForSheets}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/[0.05] border border-white/[0.1] text-slate-200 rounded-md hover:bg-white/[0.1] whitespace-nowrap"
            >
              {copiedSheets ? (
                <Check className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {copiedSheets ? 'Copied TSV for Sheets' : 'Copy for Google Sheets'}
            </button>

            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export Clean CSV
            </button>
          </div>
        </div>

        {/* 6 KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-1.5"
            >
              <div className="text-xs text-slate-400">{kpi.label}</div>
              <div className="text-xl font-mono tabular-nums font-semibold text-white">
                {kpi.value}
              </div>
              <div className="text-[11px] text-slate-500">{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* 3 Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Chart 1: Lead Priority Tier Distribution */}
          <div className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-white">
                Lead Priority Tier Distribution
              </h3>
              <p className="text-[11px] text-slate-400">High (80+), Medium (50-79), Low (&lt;50)</p>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.tierDistribution} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="tier" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#141720',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#E6E8EE',
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {summary.tierDistribution.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Source Channel vs Qualification Score */}
          <div className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-white">
                Source Channel vs. Avg ICP Score
              </h3>
              <p className="text-[11px] text-slate-400">Qualification quality by intake surface</p>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.channelBreakdown} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="channel"
                    interval={0}
                    tickFormatter={(v: string) => (v === 'HubSpot Webhook' ? 'HubSpot' : v)}
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#141720',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#E6E8EE',
                    }}
                  />
                  <Bar dataKey="avgScore" name="Avg ICP Score" fill="#5E6AD2" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3: AI Score vs Human SDR Override */}
          <div className="p-4 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-white">
                  AI Score vs. Human SDR Override
                </h3>
                <p className="text-[11px] text-slate-400">
                  Override rate: <span className="font-mono tabular-nums text-white">{summary.humanOverrideRate}%</span>
                </p>
              </div>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.overrideComparison} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="category" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#141720',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#E6E8EE',
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    <Cell fill="#10B981" />
                    <Cell fill="#F59E0B" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
