import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Sparkles,
  Plus,
  Wrench,
  Zap,
  Layers,
  Calendar,
  Trash2,
  X,
  ShieldCheck,
  Megaphone
} from 'lucide-react';
import { appAlert, appConfirm, appToast } from '../../utils/alerts';
import { getCurrentUser } from '../../utils/permissions';

const ITEM_TYPES = [
  { value: 'NEW', label: 'Novità', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', Icon: Sparkles },
  { value: 'FIX', label: 'Fix', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30', Icon: Wrench },
  { value: 'PERF', label: 'Performance', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: Zap },
  { value: 'IMPROVEMENT', label: 'Miglioria', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', Icon: Layers }
];

const Changelogs = () => {
  const user = getCurrentUser();
  const isEngineer =
    user?.role === 'developer' ||
    String(user?.role_name || '').toLowerCase().includes('software engineer');

  const [changelogs, setChangelogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [form, setForm] = useState({
    version: '',
    title: '',
    summary: '',
    show_popup: true,
    items: [{ type: 'NEW', text: '' }]
  });

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchChangelogs = useCallback(async () => {
    try {
      const res = await axios.get('/api/changelogs', {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setChangelogs(res.data?.changelogs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChangelogs();
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('changelog_published', fetchChangelogs);
    return () => socket.disconnect();
  }, [fetchChangelogs]);

  const addItemRow = () => {
    setForm(p => ({ ...p, items: [...p.items, { type: 'NEW', text: '' }] }));
  };

  const updateItemRow = (idx, field, val) => {
    setForm(p => ({
      ...p,
      items: p.items.map((it, i) => (i === idx ? { ...it, [field]: val } : it))
    }));
  };

  const removeItemRow = (idx) => {
    setForm(p => ({
      ...p,
      items: p.items.filter((_, i) => i !== idx)
    }));
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!form.version.trim() || !form.title.trim() || !form.summary.trim()) {
      return appAlert('Versione, titolo e riepilogo sono obbligatori.', 'Dati mancanti', 'warning');
    }
    setPublishing(true);
    try {
      await axios.post(
        '/api/changelogs',
        {
          version: form.version.trim(),
          title: form.title.trim(),
          summary: form.summary.trim(),
          show_popup: form.show_popup,
          is_published: true,
          items: form.items.filter(i => i.text.trim() !== '')
        },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setShowPublishModal(false);
      setForm({ version: '', title: '', summary: '', show_popup: true, items: [{ type: 'NEW', text: '' }] });
      appToast('Changelog pubblicato con successo!');
      await fetchChangelogs();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore pubblicazione changelog', 'Errore', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async (cl) => {
    const ok = await appConfirm(`Eliminare il changelog ${cl.version} (${cl.title})?`, 'Elimina Changelog');
    if (!ok) return;
    try {
      await axios.delete(`/api/changelogs/${cl.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      appToast('Changelog eliminato');
      await fetchChangelogs();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione', 'Errore', 'error');
    }
  };

  return (
    <div className="space-y-6 pb-16 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-brand-white flex items-center gap-3">
            <Megaphone className="text-brand-blue" size={32} />
            Canale Changelog & Aggiornamenti
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Storico completo delle release, miglioramenti e correzioni rilasciate da Software Engineering.
          </p>
        </div>

        {isEngineer && (
          <button
            type="button"
            onClick={() => setShowPublishModal(true)}
            className="px-5 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-sm flex items-center gap-2 shadow-[0_0_25px_rgba(245,158,11,0.3)] transition-all"
          >
            <Plus size={18} strokeWidth={3} />
            <span>Lancia Nuovo Changelog</span>
          </button>
        )}
      </div>

      {/* Timeline Feed */}
      {loading ? (
        <div className="p-12 text-center text-slate-500">Caricamento changelog...</div>
      ) : changelogs.length === 0 ? (
        <div className="bg-slate-900/70 border border-slate-800 border-dashed rounded-3xl p-12 text-center text-slate-500 space-y-2">
          <Sparkles size={36} className="mx-auto text-slate-700" />
          <p className="font-bold">Nessun changelog pubblicato al momento.</p>
          {isEngineer && (
            <p className="text-xs text-slate-400">
              Usa il pulsante &quot;Lancia Nuovo Changelog&quot; per annunciare un aggiornamento agli utenti.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {changelogs.map((cl) => (
            <article
              key={cl.id}
              className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4 relative"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="px-3 py-1 rounded-full bg-brand-blue text-brand-black font-mono font-black text-xs">
                    {cl.version}
                  </span>
                  <h2 className="text-xl font-black text-brand-white">{cl.title}</h2>
                  {cl.show_popup && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold uppercase">
                      Popup al primo accesso
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                    <Calendar size={14} className="text-brand-blue" />
                    {new Date(cl.published_at || cl.created_at).toLocaleString('it-IT', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  {isEngineer && (
                    <button
                      type="button"
                      onClick={() => handleDelete(cl)}
                      className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400"
                      title="Elimina Changelog"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{cl.summary}</p>

              {Array.isArray(cl.items) && cl.items.length > 0 && (
                <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 space-y-2.5">
                  {cl.items.map((item, idx) => {
                    const meta = ITEM_TYPES.find(t => t.value === item.type) || ITEM_TYPES[0];
                    const Icon = meta.Icon;
                    return (
                      <div key={idx} className="flex items-start gap-2.5 text-sm">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-black uppercase shrink-0 mt-0.5 ${meta.cls}`}>
                          <Icon size={11} />
                          {meta.label}
                        </span>
                        <span className="text-slate-200">{item.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-xs text-slate-500 pt-1">
                <ShieldCheck size={14} className="text-amber-400" />
                <span>
                  Rilasciato da <strong className="text-amber-300">{cl.created_by_username}</strong> · Software Engineering
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Publish Modal (Software Engineering Only) */}
      {showPublishModal && isEngineer && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-brand-black/85 backdrop-blur-md">
          <div className="w-full max-w-2xl bg-slate-900 border border-amber-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-black text-brand-white flex items-center gap-2">
                <Sparkles className="text-amber-400" size={20} />
                Pubblica Nuovo Changelog
              </h2>
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePublish} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Versione *</label>
                  <input
                    type="text"
                    required
                    value={form.version}
                    onChange={(e) => setForm(p => ({ ...p, version: e.target.value }))}
                    placeholder="Es. v2.5.0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold text-brand-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Titolo Aggiornamento *</label>
                  <input
                    type="text"
                    required
                    value={form.title}
                    onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="Es. Controlli Zebra, Notifiche Clienti & Ottimizzazioni"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-brand-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">Riepilogo *</label>
                <textarea
                  rows={3}
                  required
                  value={form.summary}
                  onChange={(e) => setForm(p => ({ ...p, summary: e.target.value }))}
                  placeholder="Breve panoramica delle novità incluse in questo rilascio..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-brand-white"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase text-slate-400">Voci Dettagliate</label>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-xs font-bold text-brand-blue hover:text-sky-300 flex items-center gap-1"
                  >
                    <Plus size={14} /> Aggiungi voce
                  </button>
                </div>

                {form.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={item.type}
                      onChange={(e) => updateItemRow(idx, 'type', e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-200 shrink-0"
                    >
                      {ITEM_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => updateItemRow(idx, 'text', e.target.value)}
                      placeholder="Descrivi la novità o correzione..."
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-brand-white"
                    />
                    {form.items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-rose-400"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.show_popup}
                  onChange={(e) => setForm(p => ({ ...p, show_popup: e.target.checked }))}
                  className="accent-amber-500 w-4 h-4"
                />
                <span className="text-xs font-bold text-amber-200">
                  Mostra popup automatico 1 volta al prossimo accesso di ogni utente
                </span>
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-sm"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={publishing}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm disabled:opacity-50"
                >
                  {publishing ? 'Pubblicazione...' : 'Pubblica Changelog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Changelogs;
