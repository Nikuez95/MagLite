import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Sparkles, CheckCircle2, Wrench, Zap, ArrowUpRight, X, Layers } from 'lucide-react';

const ITEM_TYPE_STYLES = {
  NEW: { label: 'Novità', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', Icon: Sparkles },
  FIX: { label: 'Fix', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', Icon: Wrench },
  PERF: { label: 'Performance', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: Zap },
  IMPROVEMENT: { label: 'Miglioria', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', Icon: Layers }
};

const ChangelogPopupModal = ({ token, onOpenChannel }) => {
  const [unseen, setUnseen] = useState([]);
  const [isClosing, setIsClosing] = useState(false);

  const checkUnseen = useCallback(async () => {
    if (!token) {
      setUnseen([]);
      return;
    }
    try {
      const res = await axios.get('/api/changelogs/unseen', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const list = res.data?.unseen || [];
      setUnseen(list);
    } catch {
      // ignore silent check error
    }
  }, [token]);

  useEffect(() => {
    checkUnseen();
  }, [checkUnseen]);

  const handleDismiss = async (openChannel = false) => {
    if (isClosing || unseen.length === 0) return;
    setIsClosing(true);
    const ids = unseen.map(c => c.id);
    try {
      await axios.post(
        '/api/changelogs/mark-seen',
        { changelog_ids: ids },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch {
      // ignore
    } finally {
      setUnseen([]);
      setIsClosing(false);
      if (openChannel && typeof onOpenChannel === 'function') {
        onOpenChannel();
      }
    }
  };

  if (!token || unseen.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-brand-black/85 backdrop-blur-md animate-fade-in-up"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl bg-slate-900 border-2 border-brand-blue/60 rounded-3xl shadow-[0_0_50px_rgba(14,165,233,0.25)] overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-sky-500/15 via-slate-900 to-amber-500/10 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-brand-blue/20 border border-brand-blue/40 flex items-center justify-center text-brand-blue shrink-0">
              <Sparkles size={26} />
            </div>
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-brand-blue/15 border border-brand-blue/30 text-brand-blue text-[10px] font-black uppercase tracking-widest mb-1">
                Aggiornamento di Sistema
              </span>
              <h2 className="text-xl font-black text-brand-white leading-tight">
                Novità in MagLite
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleDismiss(false)}
            disabled={isClosing}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="Chiudi"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {unseen.map((cl) => (
            <div key={cl.id} className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="px-3 py-1 rounded-full bg-brand-blue text-brand-black font-mono font-black text-xs">
                    {cl.version}
                  </span>
                  <h3 className="text-lg font-black text-brand-white">{cl.title}</h3>
                </div>
                <span className="text-xs font-semibold text-slate-400">
                  {new Date(cl.published_at || cl.created_at).toLocaleDateString('it-IT', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  })}
                </span>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{cl.summary}</p>

              {Array.isArray(cl.items) && cl.items.length > 0 && (
                <div className="pt-2 space-y-2 border-t border-slate-800/80">
                  {cl.items.map((item, idx) => {
                    const meta = ITEM_TYPE_STYLES[item.type] || ITEM_TYPE_STYLES.NEW;
                    const Icon = meta.Icon;
                    return (
                      <div key={idx} className="flex items-start gap-2.5 text-sm">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase shrink-0 mt-0.5 ${meta.cls}`}>
                          <Icon size={11} />
                          {meta.label}
                        </span>
                        <span className="text-slate-200 leading-snug">{item.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="text-[11px] text-slate-500 font-semibold pt-1">
                Pubblicato da <span className="text-amber-400">{cl.created_by_username}</span> · Software Engineering
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {onOpenChannel ? (
            <button
              type="button"
              onClick={() => handleDismiss(true)}
              disabled={isClosing}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-blue hover:text-sky-300 transition-colors"
            >
              <span>Apri canale completo Changelog</span>
              <ArrowUpRight size={14} />
            </button>
          ) : (
            <span className="text-xs text-slate-500">Questo avviso viene mostrato una sola volta.</span>
          )}

          <button
            type="button"
            onClick={() => handleDismiss(false)}
            disabled={isClosing}
            className="px-6 py-3 rounded-2xl bg-brand-blue hover:bg-sky-400 active:scale-95 text-brand-black font-black text-sm flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] ml-auto"
          >
            <CheckCircle2 size={18} />
            <span>Ho capito, continua</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangelogPopupModal;
