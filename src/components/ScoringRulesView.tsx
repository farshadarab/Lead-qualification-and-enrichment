import { useEffect, useState } from 'react';
import { AlertCircle, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import type { ScoringConfig, ScoringWeights, TerritoryRule } from '../shared/types';
import { DEFAULT_SCORING_CONFIG } from '../shared/seedData';

interface ScoringRulesViewProps {
  config: ScoringConfig;
  onSaveConfig: (next: ScoringConfig) => Promise<void>;
}

const WEIGHT_LABELS: { key: keyof ScoringWeights; label: string; hint: string }[] = [
  { key: 'industryFit', label: 'Industry Fit', hint: 'Match against target B2B verticals' },
  { key: 'companySize', label: 'Company Size', hint: 'Employee headcount sweet spot' },
  { key: 'geography', label: 'Geography', hint: 'Tier-1 sales territory match' },
  { key: 'jobSeniority', label: 'Job Seniority', hint: 'VP / C-suite / Head-of authority' },
  { key: 'useCaseFit', label: 'Business Use-Case Fit', hint: 'Stated pain & CRM stack match' },
  { key: 'buyingIntent', label: 'Buying Intent', hint: 'Channel urgency & work email verification' },
];

export function ScoringRulesView({ config, onSaveConfig }: ScoringRulesViewProps) {
  const [draft, setDraft] = useState<ScoringConfig>(config);
  const [newIndustry, setNewIndustry] = useState('');
  const [newSize, setNewSize] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const totalWeight =
    draft.weights.industryFit +
    draft.weights.companySize +
    draft.weights.geography +
    draft.weights.jobSeniority +
    draft.weights.useCaseFit +
    draft.weights.buyingIntent;

  const updateWeight = (key: keyof ScoringWeights, val: number) => {
    setError(null);
    setDraft((prev) => ({
      ...prev,
      weights: {
        ...prev.weights,
        [key]: Math.max(0, Math.min(100, Math.round(val))),
      },
    }));
  };

  const addTag = (
    field: 'targetIndustries' | 'idealSizeRanges' | 'tier1Countries',
    value: string,
    clear: () => void,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraft((prev) => ({
      ...prev,
      [field]: prev[field].includes(trimmed) ? prev[field] : [...prev[field], trimmed],
    }));
    clear();
  };

  const removeTag = (
    field: 'targetIndustries' | 'idealSizeRanges' | 'tier1Countries',
    value: string,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [field]: prev[field].filter((item) => item !== value),
    }));
  };

  const updateRule = (idx: number, patch: Partial<TerritoryRule>) => {
    setDraft((prev) => ({
      ...prev,
      territoryRouting: prev.territoryRouting.map((r, i) =>
        i === idx ? { ...r, ...patch } : r,
      ),
    }));
  };

  const handleSave = async () => {
    if (totalWeight !== 100) {
      setError(`Weights currently sum to ${totalWeight} pts. Adjust sliders so total equals 100 pts.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSaveConfig(draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div>
            <h2 className="text-base font-semibold text-white">
              ICP Scoring Rules & Territory Routing Matrix
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure the 100-point rubric weights and territory owners. Saving recalculates all pending queue leads immediately.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setDraft(structuredClone(DEFAULT_SCORING_CONFIG))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/[0.05] border border-white/[0.1] text-slate-200 rounded-md hover:bg-white/[0.1]"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#5E6AD2] text-white rounded-md hover:bg-[#4F5BC4] transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
              {saving ? 'Recalculating Queue...' : 'Save & Recalculate Queue'}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Criterion Weights */}
          <section className="lg:col-span-6 p-5 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">6-Criterion Rubric Weights</h3>
              <span
                className={`px-2 py-0.5 rounded font-mono tabular-nums text-xs font-semibold border ${
                  totalWeight === 100
                    ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/12 text-rose-300 border-rose-500/30'
                }`}
              >
                Total: {totalWeight} / 100 pts
              </span>
            </div>

            <div className="divide-y divide-white/[0.06]">
              {WEIGHT_LABELS.map((item) => {
                const value = draft.weights[item.key];
                return (
                  <div key={item.key} className="py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <label
                          htmlFor={`weight-${item.key}`}
                          className="text-xs font-medium text-white block"
                        >
                          {item.label}
                        </label>
                        <span className="text-[11px] text-slate-400">{item.hint}</span>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-semibold text-white">
                        {value} pts
                      </span>
                    </div>
                    <input
                      id={`weight-${item.key}`}
                      type="range"
                      min={0}
                      max={40}
                      value={value}
                      onChange={(e) => updateWeight(item.key, Number(e.target.value))}
                      className="w-full accent-[#5E6AD2] cursor-pointer"
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Target Criteria Tag Editors */}
          <section className="lg:col-span-6 p-5 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-5">
            <h3 className="text-sm font-semibold text-white">Ideal Customer Profile Criteria</h3>

            {/* Target Industries */}
            <div className="space-y-2">
              <label htmlFor="tag-industry" className="text-xs font-medium text-slate-200 block">
                Target Industries
              </label>
              <div className="flex gap-2">
                <input
                  id="tag-industry"
                  type="text"
                  value={newIndustry}
                  onChange={(e) => setNewIndustry(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag('targetIndustries', newIndustry, () => setNewIndustry(''));
                    }
                  }}
                  placeholder="Add industry (e.g. HealthTech)"
                  className="flex-1 px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
                <button
                  type="button"
                  onClick={() =>
                    addTag('targetIndustries', newIndustry, () => setNewIndustry(''))
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/[0.06] border border-white/[0.1] text-white rounded-md hover:bg-white/[0.1]"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draft.targetIndustries.map((ind) => (
                  <span
                    key={ind}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.09] text-xs text-slate-200"
                  >
                    {ind}
                    <button
                      type="button"
                      aria-label={`Remove ${ind}`}
                      onClick={() => removeTag('targetIndustries', ind)}
                      className="text-slate-400 hover:text-rose-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Ideal Employee Sizes */}
            <div className="space-y-2 pt-3 border-t border-white/[0.06]">
              <label htmlFor="tag-size" className="text-xs font-medium text-slate-200 block">
                Ideal Employee Size Buckets
              </label>
              <div className="flex gap-2">
                <input
                  id="tag-size"
                  type="text"
                  value={newSize}
                  onChange={(e) => setNewSize(e.target.value)}
                  placeholder="Add bucket (e.g. 2001+)"
                  className="flex-1 px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
                <button
                  type="button"
                  onClick={() => addTag('idealSizeRanges', newSize, () => setNewSize(''))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/[0.06] border border-white/[0.1] text-white rounded-md hover:bg-white/[0.1]"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draft.idealSizeRanges.map((sz) => (
                  <span
                    key={sz}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.09] text-xs font-mono text-slate-200"
                  >
                    {sz}
                    <button
                      type="button"
                      aria-label={`Remove ${sz}`}
                      onClick={() => removeTag('idealSizeRanges', sz)}
                      className="text-slate-400 hover:text-rose-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Tier 1 Countries */}
            <div className="space-y-2 pt-3 border-t border-white/[0.06]">
              <label htmlFor="tag-country" className="text-xs font-medium text-slate-200 block">
                Tier-1 Countries
              </label>
              <div className="flex gap-2">
                <input
                  id="tag-country"
                  type="text"
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                  placeholder="Add country (e.g. Netherlands)"
                  className="flex-1 px-3 py-1.5 text-xs bg-[#141720] border border-white/[0.1] rounded-md text-white focus:outline-none focus:border-[#5E6AD2]"
                />
                <button
                  type="button"
                  onClick={() => addTag('tier1Countries', newCountry, () => setNewCountry(''))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white/[0.06] border border-white/[0.1] text-white rounded-md hover:bg-white/[0.1]"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {draft.tier1Countries.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.09] text-xs text-slate-200"
                  >
                    {c}
                    <button
                      type="button"
                      aria-label={`Remove ${c}`}
                      onClick={() => removeTag('tier1Countries', c)}
                      className="text-slate-400 hover:text-rose-300"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Territory Owner Mapping Table */}
        <section className="p-5 bg-[#0D0F14] border border-white/[0.08] rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Territory Owner Email Mappings</h3>
            <button
              type="button"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  territoryRouting: [
                    ...prev.territoryRouting,
                    {
                      territory: 'New Region',
                      countries: ['Australia'],
                      ownerName: 'Alex Rivera',
                      ownerEmail: 'alex.rivera@gtmsignal.io',
                    },
                  ],
                }))
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white/[0.05] border border-white/[0.1] text-white rounded hover:bg-white/[0.1]"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Territory Rule
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-400">
                  <th className="py-2 pr-3 font-medium">Territory</th>
                  <th className="py-2 pr-3 font-medium">Countries (comma-separated)</th>
                  <th className="py-2 pr-3 font-medium">Owner Name</th>
                  <th className="py-2 pr-3 font-medium">Owner Email</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {draft.territoryRouting.map((rule, idx) => (
                  <tr key={idx}>
                    <td className="py-2.5 pr-3">
                      <input
                        type="text"
                        aria-label={`Territory name ${idx + 1}`}
                        value={rule.territory}
                        onChange={(e) => updateRule(idx, { territory: e.target.value })}
                        className="w-full px-2.5 py-1 bg-[#141720] border border-white/[0.09] rounded text-white"
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="text"
                        aria-label={`Countries for ${rule.territory}`}
                        value={rule.countries.join(', ')}
                        onChange={(e) =>
                          updateRule(idx, {
                            countries: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full px-2.5 py-1 bg-[#141720] border border-white/[0.09] rounded text-slate-200"
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="text"
                        aria-label={`Owner name ${idx + 1}`}
                        value={rule.ownerName}
                        onChange={(e) => updateRule(idx, { ownerName: e.target.value })}
                        className="w-full px-2.5 py-1 bg-[#141720] border border-white/[0.09] rounded text-white"
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="email"
                        aria-label={`Owner email ${idx + 1}`}
                        value={rule.ownerEmail}
                        onChange={(e) => updateRule(idx, { ownerEmail: e.target.value })}
                        className="w-full px-2.5 py-1 font-mono bg-[#141720] border border-white/[0.09] rounded text-slate-200"
                      />
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${rule.territory}`}
                        disabled={draft.territoryRouting.length <= 1}
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            territoryRouting: prev.territoryRouting.filter((_, i) => i !== idx),
                          }))
                        }
                        className="p-1.5 text-slate-400 hover:text-rose-300 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
