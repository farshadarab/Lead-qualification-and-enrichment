import { CheckCircle2, AlertTriangle, Sparkles, ShieldCheck, Database } from 'lucide-react';
import type { DataSourceMode, EvidenceTag, PipelineStage } from '../shared/types';

const PALETTES = [
  'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'bg-violet-500/15 text-violet-300 border-violet-500/30',
];

export function CompanyMonogram({
  name,
  domain,
  size = 'md',
}: {
  name: string;
  domain: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const hash = domain.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const style = PALETTES[hash % PALETTES.length];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'CO';

  const dims =
    size === 'sm'
      ? 'w-7 h-7 text-[11px] rounded-md'
      : size === 'lg'
        ? 'w-10 h-10 text-sm rounded-lg'
        : 'w-8 h-8 text-xs rounded-md';

  return (
    <div
      aria-hidden="true"
      className={`inline-flex items-center justify-center font-mono font-semibold border shrink-0 select-none ${dims} ${style}`}
    >
      {initials}
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 80
      ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30'
      : score >= 50
        ? 'bg-amber-500/12 text-amber-300 border-amber-500/30'
        : 'bg-rose-500/12 text-rose-300 border-rose-500/30';

  const label = score >= 80 ? 'High ICP' : score >= 50 ? 'Review' : 'Low Fit';

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-mono tabular-nums font-medium whitespace-nowrap shrink-0 ${tone}`}
      title={`ICP Score ${score}/100 (${label})`}
    >
      <span>{score}</span>
      <span className="text-[10px] opacity-80 font-sans">{label}</span>
    </span>
  );
}

export function EvidenceTagBadge({ tag }: { tag: EvidenceTag }) {
  if (tag === 'VERIFIED_EVIDENCE') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/12 text-emerald-300 border border-emerald-500/25 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" />
        VERIFIED EVIDENCE
      </span>
    );
  }
  if (tag === 'UNVERIFIED_FREEMAIL') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/12 text-amber-300 border border-amber-500/25 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
        UNVERIFIED FREEMAIL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-sky-500/12 text-sky-300 border border-sky-500/25 whitespace-nowrap shrink-0">
      <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
      AI INFERENCE
    </span>
  );
}

export function ModeBadge({ mode, label }: { mode: DataSourceMode; label?: string }) {
  const isLive = mode === 'LIVE_API';
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium border whitespace-nowrap shrink-0 ${
        isLive
          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
          : 'bg-white/[0.04] text-slate-300 border-white/[0.1]'
      }`}
    >
      {isLive ? (
        <ShieldCheck className="w-2.5 h-2.5" aria-hidden="true" />
      ) : (
        <Database className="w-2.5 h-2.5" aria-hidden="true" />
      )}
      {label ? `${label}: ${mode}` : mode}
    </span>
  );
}

export function StageLabel({ stage }: { stage: PipelineStage }) {
  const map: Record<PipelineStage, { text: string; cls: string }> = {
    NEW_ENRICHED: { text: 'New / Enriched', cls: 'text-sky-300 bg-sky-500/10 border-sky-500/25' },
    PENDING_REVIEW: { text: 'Pending Review', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
    APPROVED_SYNCING: {
      text: 'Synced to HubSpot',
      cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
    },
    DISQUALIFIED: { text: 'Disqualified', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/25' },
  };
  const item = map[stage];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 ${item.cls}`}
    >
      {item.text}
    </span>
  );
}
