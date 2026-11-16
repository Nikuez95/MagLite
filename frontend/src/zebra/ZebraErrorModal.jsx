import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Popup modale ad alta visibilità per errori sui terminali Zebra:
 * rimane visibile al centro dello schermo indipendentemente dallo scrolling.
 */
const ZebraErrorModal = ({ message, title = 'Attenzione', onClose }) => {
  if (!message) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-5 bg-brand-black/85 backdrop-blur-sm animate-fade-in-up"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm bg-slate-900 border-2 border-rose-500 rounded-3xl p-6 shadow-[0_0_40px_rgba(244,63,94,0.35)] text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-400 mx-auto">
          <AlertTriangle size={36} />
        </div>
        <div>
          <h3 className="text-xl font-black text-brand-white uppercase tracking-tight">{title}</h3>
          <p className="text-sm font-bold text-rose-200 mt-2 leading-relaxed break-words">
            {message}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-400 active:scale-95 text-white font-black text-base flex items-center justify-center gap-2 transition-all shadow-lg"
        >
          <X size={18} /> CHIUDI
        </button>
      </div>
    </div>
  );
};

export default ZebraErrorModal;
