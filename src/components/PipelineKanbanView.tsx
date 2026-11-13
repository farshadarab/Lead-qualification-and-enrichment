import { useState, type DragEvent } from 'react';
import { ArrowRight, CheckCircle2, GripVertical } from 'lucide-react';
import type { LeadRecord, PipelineStage } from '../shared/types';
import { CompanyMonogram, ScoreBadge } from './CompanyMonogram';

interface PipelineKanbanViewProps {
  leads: LeadRecord[];
  onMoveStage: (leadId: string, nextStage: PipelineStage) => Promise<void>;
  onOpenLead: (leadId: string) => void;
}

const COLUMNS: { id: PipelineStage; title: string; subtitle: string }[] = [
  { id: 'NEW_ENRICHED', title: 'New / Enriched', subtitle: 'Apollo + Gemini evaluated' },
  { id: 'PENDING_REVIEW', title: 'Pending SDR Review', subtitle: 'Awaiting human approval' },
  {
    id: 'APPROVED_SYNCING',
    title: 'Approved (Syncing to HubSpot)',
    subtitle: 'CRM v3 objects upserted',
  },
  { id: 'DISQUALIFIED', title: 'Disqualified / Nurture', subtitle: 'Out of ICP / freemail hold' },
];

export function PipelineKanbanView({
  leads,
  onMoveStage,
  onOpenLead,
}: PipelineKanbanViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<PipelineStage | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const handleDragStart = (e: DragEvent<HTMLDivElement>, leadId: string) => {
    setDraggingId(leadId);
    e.dataTransfer.setData('text/plain', leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>, targetStage: PipelineStage) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    if (!leadId) return;
    const current = leads.find((l) => l.id === leadId);
    if (!current || current.stage === targetStage) return;
    setMovingId(leadId);
    try {
      await onMoveStage(leadId, targetStage);
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="h-full overflow-x-auto p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-w-[920px] h-full">
        {COLUMNS.map((col) => {
          const colLeads = leads.filter((l) => l.stage === col.id);
          const isOver = dragOverCol === col.id;
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.id);
              }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={(e) => void handleDrop(e, col.id)}
              className={`flex flex-col rounded-lg border transition-colors min-h-[420px] ${
                isOver
                  ? 'border-[#5E6AD2] bg-[#5E6AD2]/[0.08]'
                  : 'border-white/[0.08] bg-[#0D0F14]'
              }`}
            >
              <div className="px-3.5 py-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-white truncate">{col.title}</h3>
                  <p className="text-[11px] text-slate-400 truncate">{col.subtitle}</p>
                </div>
                <span className="px-2 py-0.5 rounded bg-white/[0.06] text-xs font-mono tabular-nums text-slate-200 shrink-0">
                  {colLeads.length}
                </span>
              </div>

              <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto">
                {colLeads.length === 0 ? (
                  <div className="py-10 px-3 text-center text-xs text-slate-500 border border-dashed border-white/[0.08] rounded-md">
                    Drag a lead card here
                  </div>
                ) : (
                  colLeads.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                      }}
                      className={`p-3 rounded-md border border-white/[0.08] bg-[#131620] space-y-2.5 cursor-grab active:cursor-grabbing transition-opacity ${
                        draggingId === lead.id || movingId === lead.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <GripVertical
                            className="w-3.5 h-3.5 text-slate-500 shrink-0"
                            aria-hidden="true"
                          />
                          <CompanyMonogram
                            name={lead.company.name}
                            domain={lead.company.domain}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenLead(lead.id)}
                              className="text-xs font-semibold text-white hover:text-[#8B95F2] text-left truncate block max-w-full"
                            >
                              {lead.contactName}
                            </button>
                            <p className="text-[11px] text-slate-400 truncate">
                              {lead.company.name} · {lead.jobTitle}
                            </p>
                          </div>
                        </div>
                        <ScoreBadge score={lead.qualification.totalScore} />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span className="truncate">{lead.routing.assignedOwnerName}</span>
                        <span className="font-mono truncate">{lead.sourceChannel}</span>
                      </div>

                      {lead.hubspot.synced && (
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{lead.hubspot.companyObjectId}</span>
                        </div>
                      )}

                      <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2 min-w-0">
                        <label
                          htmlFor={`kanban-move-${lead.id}`}
                          className="text-[10px] text-slate-500 shrink-0"
                        >
                          Stage
                        </label>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <select
                            id={`kanban-move-${lead.id}`}
                            aria-label={`Move ${lead.contactName} to stage`}
                            value={lead.stage}
                            disabled={movingId === lead.id}
                            onChange={async (e) => {
                              const next = e.target.value as PipelineStage;
                              setMovingId(lead.id);
                              try {
                                await onMoveStage(lead.id, next);
                              } finally {
                                setMovingId(null);
                              }
                            }}
                            className="flex-1 min-w-0 w-full px-2 py-1 text-[11px] bg-[#0D0F14] border border-white/[0.1] rounded text-slate-200 focus:outline-none focus:border-[#5E6AD2] truncate"
                          >
                            {COLUMNS.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                          </select>

                          {lead.stage !== 'APPROVED_SYNCING' && (
                            <button
                              type="button"
                              aria-label={`Approve and sync ${lead.contactName} to HubSpot`}
                              disabled={movingId === lead.id}
                              onClick={async () => {
                                setMovingId(lead.id);
                                try {
                                  await onMoveStage(lead.id, 'APPROVED_SYNCING');
                                } finally {
                                  setMovingId(null);
                                }
                              }}
                              className="p-1.5 rounded bg-[#5E6AD2]/20 text-[#8B95F2] hover:bg-[#5E6AD2] hover:text-white transition-colors shrink-0"
                              title="Approve & Sync to HubSpot"
                            >
                              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
