import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  ClipboardList,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Search,
  Filter,
  Eye,
  KeyRound,
  ArrowRight,
  GripVertical,
  Check,
  X,
  Truck,
  RotateCcw,
  Sparkles,
  Smartphone,
  Layers,
  Thermometer,
  FileText,
  Lock,
  RefreshCw
} from 'lucide-react';
import { appAlert, appConfirm } from '../../utils/alerts';
import { hasPerm } from '../../utils/permissions';

const STEP_TYPES = [
  { value: 'CHOICE', label: 'Bottoni a Scelta (Opzioni)', desc: 'Pulsanti tattili con biforcazione condizionale' },
  { value: 'TEXT', label: 'Campo di Testo Libero', desc: 'L\'operatore scrive un dato (DDT, Sigillo, Targa)' },
  { value: 'TEMPERATURE', label: 'Misura Temperatura (°C)', desc: 'Input termico con verifica range e allarme discrepanza' },
  { value: 'CHECKLIST', label: 'Checklist Multi-Spunta', desc: 'Ispezione visiva/sanitaria con caselle di controllo' },
  { value: 'STANDBY', label: '⚠️ Fermo Standby QA/GDP', desc: 'Blocca lo Zebra in attesa di sblocco da ufficio o PIN' },
  { value: 'REJECT', label: '🛑 Alt Scarico (Non Conforme)', desc: 'Messaggio di stop scarico e invito alla sosta' },
  { value: 'SUMMARY', label: 'Riepilogo & Conferma', desc: 'Riepilogo dati inseriti e salvataggio finale' }
];

// Componente per formattazione e lettura ultra-chiara delle risposte acquisite per l'ufficio
const SubmissionAnswersViewer = ({ submission, forms = [] }) => {
  if (!submission) return null;
  const answers = submission.answers || {};
  const formSteps = (submission.form_steps && submission.form_steps.length > 0)
    ? submission.form_steps
    : (forms.find(f => f.id === submission.form_id || f.code === submission.form_code)?.steps || []);

  const friendlyLabels = {
    step_mezzo: { label: 'Mezzo di Trasporto', icon: Truck },
    tipo_mezzo: { label: 'Mezzo di Trasporto', icon: Truck },
    step_ddt: { label: 'Numero Documento di Trasporto (DDT)', icon: FileText },
    numero_ddt: { label: 'Numero Documento di Trasporto (DDT)', icon: FileText },
    step_container: { label: 'Codice / Matricola Container', icon: Smartphone },
    numero_container: { label: 'Codice / Matricola Container', icon: Smartphone },
    step_sigillo: { label: 'Controllo Sigillo di Sicurezza', icon: CheckCircle2 },
    step_sigillo_num: { label: 'Numero Matricola Sigillo', icon: KeyRound },
    step_temp_check: { label: 'Catena del Freddo Richiesta', icon: Thermometer },
    step_temp_range: { label: 'Fascia Termica Prescritta', icon: Thermometer },
    step_temp_value: { label: 'Temperatura Misurata nel Vano', icon: Thermometer },
    step_igiene: { label: 'Ispezione Igienico-Sanitaria Mezzo', icon: ClipboardList },
    step_summary: { label: 'Conferma Finale Operatore', icon: CheckCircle2 }
  };

  const getStepDefinition = (key) => formSteps.find(s => s.id === key || s.field_key === key);

  return (
    <div className="space-y-3">
      {Object.entries(answers).map(([key, val]) => {
        if (key === 'step_summary' && val === 'CONFIRMED') return null;

        const stepDef = getStepDefinition(key);
        const friendly = friendlyLabels[key] || { label: stepDef?.title || key.replace(/^step_/, '').replace(/_/g, ' ').toUpperCase() };
        const IconComponent = friendly.icon || FileText;

        // Gestione Checklist Multi-Spunta (ispezione visiva/sanitaria)
        if (stepDef?.type === 'CHECKLIST' || (typeof val === 'object' && val !== null && !Array.isArray(val))) {
          const checklistItems = stepDef?.items || [];
          const entries = Object.entries(val || {});
          const totalCount = entries.length;
          const compliantCount = entries.filter(([itemId, isChecked]) => {
            const itemDef = checklistItems.find(it => it.id === itemId);
            const req = itemDef?.required_condition || 'CHECKED';
            return req === 'UNCHECKED' ? !isChecked : Boolean(isChecked);
          }).length;

          return (
            <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <ClipboardList size={17} className="text-brand-blue" />
                  <span className="text-xs font-black text-brand-white">{friendly.label}</span>
                </div>
                <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                  compliantCount === totalCount
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}>
                  {compliantCount} / {totalCount} Conforme
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-0.5">
                {entries.map(([itemId, isChecked]) => {
                  const itemDef = checklistItems.find(it => it.id === itemId);
                  const itemLabel = itemDef?.label || itemId.replace(/_/g, ' ');
                  const req = itemDef?.required_condition || 'CHECKED';
                  const isCompliant = req === 'UNCHECKED' ? !isChecked : Boolean(isChecked);

                  return (
                    <div 
                      key={itemId}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                        isCompliant 
                          ? 'bg-slate-950/70 border-slate-800 text-slate-200' 
                          : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-5 h-5 rounded-lg flex items-center justify-center shrink-0 ${
                          isCompliant ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {isCompliant ? <Check size={13} /> : <X size={13} />}
                        </span>
                        <span className="font-semibold">{itemLabel}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                          isCompliant ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                        }`}>
                          {isCompliant ? 'CONFORME' : 'ANOMALIA'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        // Valori semplici formattati
        let displayVal = String(val ?? '');
        let valueBadgeStyle = 'bg-slate-950 text-slate-200 border-slate-800';

        if (key === 'step_mezzo' || key === 'tipo_mezzo') {
          displayVal = val === 'CAMION' ? '🚛 Camion Standard' : (val === 'CONTAINER' ? '📦 Container' : val);
          valueBadgeStyle = 'bg-sky-500/15 text-sky-400 border-sky-500/30 font-black';
        } else if (key === 'step_temp_check') {
          displayVal = val === 'SI' ? '✅ Sì (Catena del Freddo)' : 'Temperatura Ambiente';
          valueBadgeStyle = val === 'SI' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' : 'bg-slate-800 text-slate-400';
        } else if (key === 'step_temp_range') {
          displayVal = val === '2_8' ? '+2°C / +8°C (Refrigerato)' : (val === '15_25' ? '+15°C / +25°C (Fresco)' : (val === 'UNDER_25' ? '< 25°C' : val));
          valueBadgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-bold';
        } else if (key === 'step_temp_value') {
          displayVal = `${val} °C`;
          valueBadgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-black text-sm';
        } else if (key === 'step_sigillo') {
          displayVal = val === 'SI' ? '✅ Sigillo Presente' : '❌ Sigillo Assente o Manomesso';
          valueBadgeStyle = val === 'SI' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/40';
        } else if (key === 'step_ddt' || key === 'step_container' || key === 'step_sigillo_num') {
          valueBadgeStyle = 'bg-brand-blue/15 text-brand-blue border-brand-blue/30 font-mono font-black';
        }

        return (
          <div key={key} className="p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                <IconComponent size={14} className="text-brand-blue" />
              </div>
              <span className="text-slate-400 font-bold truncate">{friendly.label}:</span>
            </div>
            <span className={`px-3 py-1 rounded-xl border text-xs text-right max-w-[60%] truncate ${valueBadgeStyle}`}>
              {displayVal}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const CustomFormsManager = () => {
  const token = localStorage.getItem('maglite_token');
  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');

  const canManageForms = hasPerm('manage_custom_forms', user);
  const canApprove = hasPerm('approve_custom_forms', user) || user.role === 'developer';
  const canDeleteCheckin = hasPerm('delete_checkin', user) || user.role === 'developer';
  const canDeleteForms = hasPerm('delete_custom_forms', user) || user.role === 'developer';

  const [activeTab, setActiveTab] = useState('SUBMISSIONS'); // 'SUBMISSIONS' | 'FORMS'
  const [submissions, setSubmissions] = useState([]);
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchFilter, setSearchFilter] = useState('');

  // Standby Counts & Alerts
  const [pendingStandbyCount, setPendingStandbyCount] = useState(0);

  // Modal Dettaglio Compilazione
  const [inspectSubmission, setInspectSubmission] = useState(null);

  // Modal Sblocco Standby
  const [approvalModal, setApprovalModal] = useState({ show: false, submission: null, notes: '' });

  // Modal Builder Form
  const [builderModal, setBuilderModal] = useState({
    show: false,
    isNew: false,
    formId: null,
    code: '',
    title: '',
    description: '',
    category: 'INBOUND',
    target_device: 'ZEBRA',
    is_active: true,
    icon: 'Truck',
    color_accent: 'cyan',
    display_mode: 'SHOW_ON_HOME',
    is_default: false,
    steps: []
  });

  // Step in fase di editing nel builder
  const [editingStepIndex, setEditingStepIndex] = useState(null);

  // 1. Fetch Dati
  const fetchData = async () => {
    try {
      setLoading(true);
      const [subsRes, formsRes, standbyRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/custom-forms/submissions?status=${statusFilter}&search=${encodeURIComponent(searchFilter)}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`http://${window.location.hostname}:3000/api/custom-forms`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`http://${window.location.hostname}:3000/api/custom-forms/submissions/pending-standby`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      setSubmissions(subsRes.data || []);
      setForms(formsRes.data || []);
      setPendingStandbyCount(standbyRes.data?.count || 0);
    } catch (err) {
      console.error('Errore caricamento dati moduli:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Ascolto WebSocket per arrivi in standby in tempo reale
    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('custom_form_standby_alert', (data) => {
      fetchData();
      appAlert(`⚠️ Nuovo arrivo in standby: ${data.session_code} (${data.operator_name || 'Operatore'}). Richiesta autorizzazione QA!`, 'Arrivo in Standby', 'warning');
    });

    socket.on('custom_form_approval', () => fetchData());
    socket.on('custom_form_aborted', () => fetchData());

    return () => socket.disconnect();
  }, [statusFilter, searchFilter]);

  // 2. Azione Sblocco Standby dall'Ufficio
  const handleApproveStandby = async () => {
    const sub = approvalModal.submission;
    if (!sub) return;

    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sub.session_code}/approve`,
        {
          approval_notes: approvalModal.notes.trim() || 'Autorizzato da ufficio/QA'
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      appAlert(`Sessione ${sub.session_code} sbloccata con successo! Il terminale Zebra è ora autorizzato a proseguire.`, 'Sblocco Effettuato', 'success');
      setApprovalModal({ show: false, submission: null, notes: '' });
      setInspectSubmission(null);
      fetchData();
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore durante lo sblocco della procedura.', 'Errore', 'error');
    }
  };

  // 2b. Azione Eliminazione Arrivo/Check-in
  const handleDeleteSubmission = async (sub) => {
    if (!canDeleteCheckin) return appAlert('Permesso delete_checkin richiesto.');
    if (!await appConfirm(`Vuoi eliminare definitivamente la registrazione di arrivo ${sub.session_code}? L'azione è irreversibile e scollegherà la merce.`, 'Eliminare Arrivo?')) {
      return;
    }

    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/custom-forms/submissions/${sub.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      appAlert(`Registrazione arrivo ${sub.session_code} eliminata.`, 'Arrivo Eliminato', 'success');
      if (inspectSubmission?.id === sub.id) setInspectSubmission(null);
      fetchData();
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione dell\'arrivo.', 'Errore', 'error');
    }
  };

  // 2c. Azione Eliminazione Modulo Configurato
  const handleDeleteForm = async (f) => {
    if (!canDeleteForms) return appAlert('Permesso delete_custom_forms richiesto.');
    if (f.code === 'ARRIVO_MERCE') {
      return appAlert('Il modulo base ARRIVO_MERCE è protetto e non può essere eliminato.', 'Modulo Protetto', 'warning');
    }
    if (!await appConfirm(`Vuoi eliminare definitivamente il modulo "${f.title}" (${f.code}) dal catalogo?`, 'Eliminare Modulo?')) {
      return;
    }

    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/custom-forms/${f.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      appAlert(`Modulo "${f.title}" eliminato.`, 'Modulo Eliminato', 'success');
      fetchData();
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione del modulo.', 'Errore', 'error');
    }
  };

  // 3. Azione Rifiuta/Annulla Standby
  const handleRejectStandby = async (sub) => {
    if (!await appConfirm(`Vuoi annullare definitivamente l'arrivo ${sub.session_code}? L'operatore su Zebra verrà reindirizzato alla Home.`, 'Annullare Arrivo?')) {
      return;
    }

    try {
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sub.session_code}/abort`,
        { reason: 'Rifiutato dall\'ufficio/QA da pannello desktop' },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      appAlert(`Sessione ${sub.session_code} annullata.`, 'Operazione Conclusa', 'info');
      setInspectSubmission(null);
      fetchData();
    } catch (err) {
      console.error(err);
      appAlert('Errore durante l\'annullamento.', 'Errore', 'error');
    }
  };

  // 4. Gestione Builder Form
  const handleOpenNewForm = () => {
    setBuilderModal({
      show: true,
      isNew: true,
      formId: null,
      code: 'FORM_' + Date.now().toString(36).toUpperCase(),
      title: 'Nuovo Modulo Guidato',
      description: '',
      category: 'INBOUND',
      target_device: 'ZEBRA',
      is_active: true,
      icon: 'Truck',
      color_accent: 'cyan',
      display_mode: 'SHOW_ON_HOME',
      is_default: false,
      steps: [
        {
          id: 'step_1',
          title: 'Domanda Iniziale',
          subtitle: 'Istruzioni per l\'operatore',
          type: 'CHOICE',
          options: [
            { label: 'Opzione A', value: 'A', next_step_id: 'step_2', color: 'blue' },
            { label: 'Opzione B', value: 'B', next_step_id: 'step_2', color: 'amber' }
          ]
        },
        {
          id: 'step_2',
          title: 'Riepilogo & Conferma',
          type: 'SUMMARY'
        }
      ]
    });
    setEditingStepIndex(0);
  };

  const handleEditForm = (formItem) => {
    setBuilderModal({
      show: true,
      isNew: false,
      formId: formItem.id,
      code: formItem.code,
      title: formItem.title,
      description: formItem.description || '',
      category: formItem.category || 'INBOUND',
      target_device: formItem.target_device || 'ZEBRA',
      is_active: Boolean(formItem.is_active),
      icon: formItem.icon || 'Truck',
      color_accent: formItem.color_accent || 'cyan',
      display_mode: formItem.display_mode || 'SHOW_ON_HOME',
      is_default: Boolean(formItem.is_default),
      steps: Array.isArray(formItem.steps) ? JSON.parse(JSON.stringify(formItem.steps)) : []
    });
    setEditingStepIndex(0);
  };

  const handleSaveForm = async () => {
    if (!builderModal.title.trim()) {
      return appAlert('Il titolo del modulo è obbligatorio.', 'Dato Mancante', 'warning');
    }
    if (builderModal.steps.length === 0) {
      return appAlert('Il modulo deve contenere almeno un passaggio.', 'Passaggi Vuoti', 'warning');
    }

    try {
      if (builderModal.isNew) {
        await axios.post(
          `http://${window.location.hostname}:3000/api/custom-forms`,
          {
            code: builderModal.code,
            title: builderModal.title,
            description: builderModal.description,
            category: builderModal.category,
            target_device: builderModal.target_device,
            is_active: builderModal.is_active,
            icon: builderModal.icon || 'Truck',
            color_accent: builderModal.color_accent || 'cyan',
            display_mode: builderModal.display_mode || 'SHOW_ON_HOME',
            is_default: Boolean(builderModal.is_default),
            steps: builderModal.steps
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        appAlert('Modulo creato con successo!', 'Operazione Completata', 'success');
      } else {
        await axios.put(
          `http://${window.location.hostname}:3000/api/custom-forms/${builderModal.formId}`,
          {
            title: builderModal.title,
            description: builderModal.description,
            category: builderModal.category,
            target_device: builderModal.target_device,
            is_active: builderModal.is_active,
            icon: builderModal.icon || 'Truck',
            color_accent: builderModal.color_accent || 'cyan',
            display_mode: builderModal.display_mode || 'SHOW_ON_HOME',
            is_default: Boolean(builderModal.is_default),
            steps: builderModal.steps
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        appAlert('Modulo aggiornato con successo!', 'Operazione Completata', 'success');
      }

      setBuilderModal(prev => ({ ...prev, show: false }));
      fetchData();
    } catch (err) {
      console.error(err);
      appAlert(err.response?.data?.error || 'Errore nel salvataggio del modulo.', 'Errore', 'error');
    }
  };

  // Helper gestione steps nel builder
  const handleAddStep = () => {
    const newId = 'step_' + (builderModal.steps.length + 1) + '_' + Math.random().toString(36).substring(2, 5);
    const newStep = {
      id: newId,
      title: 'Nuovo Passaggio',
      subtitle: '',
      type: 'CHOICE',
      options: [
        { label: 'Sì', value: 'SI', next_step_id: '', color: 'emerald' },
        { label: 'No', value: 'NO', next_step_id: '', color: 'rose' }
      ]
    };
    setBuilderModal(prev => ({
      ...prev,
      steps: [...prev.steps, newStep]
    }));
    setEditingStepIndex(builderModal.steps.length);
  };

  const handleDeleteStep = (idx) => {
    const newSteps = [...builderModal.steps];
    newSteps.splice(idx, 1);
    setBuilderModal(prev => ({ ...prev, steps: newSteps }));
    if (editingStepIndex >= newSteps.length) {
      setEditingStepIndex(Math.max(0, newSteps.length - 1));
    }
  };

  const handleMoveStep = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= builderModal.steps.length) return;
    const newSteps = [...builderModal.steps];
    const temp = newSteps[idx];
    newSteps[idx] = newSteps[targetIdx];
    newSteps[targetIdx] = temp;
    setBuilderModal(prev => ({ ...prev, steps: newSteps }));
    setEditingStepIndex(targetIdx);
  };

  const updateCurrentStepField = (field, value) => {
    if (editingStepIndex === null || !builderModal.steps[editingStepIndex]) return;
    const newSteps = [...builderModal.steps];
    newSteps[editingStepIndex] = {
      ...newSteps[editingStepIndex],
      [field]: value
    };
    setBuilderModal(prev => ({ ...prev, steps: newSteps }));
  };

  const currentEditingStep = builderModal.steps[editingStepIndex];

  return (
    <div className="space-y-6">
      {/* HEADER PRINCIPALE */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-brand-blue/15 border border-brand-blue/30 rounded-2xl text-brand-blue">
              <ClipboardList size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black text-brand-white tracking-tight">
                  Moduli Dinamici & Check-in Arrivi
                </h1>
                {pendingStandbyCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-black animate-pulse">
                    <ShieldAlert size={14} />
                    {pendingStandbyCount} in Attesa QA
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                Crea sequenze guidate per terminale Zebra e gestisci in tempo reale gli arrivi merce camion/container.
              </p>
            </div>
          </div>
        </div>

        {/* TABS & AZIONI */}
        <div className="flex items-center gap-2">
          <div className="bg-slate-900/90 border border-slate-800 p-1 rounded-2xl flex items-center">
            <button
              onClick={() => setActiveTab('SUBMISSIONS')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === 'SUBMISSIONS'
                  ? 'bg-brand-blue text-brand-black shadow-lg'
                  : 'text-slate-400 hover:text-brand-white'
              }`}
            >
              Arrivi & Check-in ({submissions.length})
            </button>
            <button
              onClick={() => setActiveTab('FORMS')}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === 'FORMS'
                  ? 'bg-brand-blue text-brand-black shadow-lg'
                  : 'text-slate-400 hover:text-brand-white'
              }`}
            >
              Moduli Configurati ({forms.length})
            </button>
          </div>

          {canManageForms && activeTab === 'FORMS' && (
            <button
              onClick={handleOpenNewForm}
              className="px-4 py-2.5 rounded-2xl bg-brand-blue text-brand-black font-black text-xs flex items-center gap-2 hover:bg-sky-400 active:scale-95 transition-all shadow-lg"
            >
              <Plus size={16} />
              Nuovo Modulo
            </button>
          )}

          <button
            onClick={fetchData}
            className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-brand-white active:bg-slate-800"
            title="Ricarica"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* TAB 1: ARRIVI E COMPILAZIONI */}
      {activeTab === 'SUBMISSIONS' && (
        <div className="space-y-4">
          {/* BARRA FILTRI */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-center justify-between shadow-xl">
            <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
              <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider mr-1">Filtro Stato:</span>
              {[
                { id: 'ALL', label: 'Tutti' },
                { id: 'STANDBY_APPROVAL', label: '⚠️ In Attesa QA', badge: pendingStandbyCount },
                { id: 'COMPLETED', label: 'Conclusi' },
                { id: 'IN_PROGRESS', label: 'In Corso' },
                { id: 'REJECTED', label: 'Respinti' },
                { id: 'ABORTED', label: 'Annullati' }
              ].map(st => (
                <button
                  key={st.id}
                  onClick={() => setStatusFilter(st.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    statusFilter === st.id
                      ? 'bg-brand-blue text-brand-black font-black'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span>{st.label}</span>
                  {st.badge > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black">
                      {st.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Cerca DDT, Container, Codice..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-brand-blue rounded-xl pl-9 pr-3 py-2 text-xs text-brand-white focus:outline-none"
              />
            </div>
          </div>

          {/* TABELLA REGISTRAZIONI ARRIVI */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-black uppercase tracking-wider text-slate-400 bg-slate-950/40">
                    <th className="py-4 px-5">Sessione / Data</th>
                    <th className="py-4 px-5">Modulo</th>
                    <th className="py-4 px-5">Operatore Zebra</th>
                    <th className="py-4 px-5">Mezzo / Documento</th>
                    <th className="py-4 px-5">Temperatura</th>
                    <th className="py-4 px-5">Stato & Esito</th>
                    <th className="py-4 px-5 text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs text-slate-300">
                  {submissions.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-12 text-center text-slate-500 font-semibold">
                        Nessun arrivo merce trovato per i filtri selezionati.
                      </td>
                    </tr>
                  ) : (
                    submissions.map((sub) => {
                      const answers = sub.answers || {};
                      const isWaitingQA = sub.status === 'STANDBY_APPROVAL';

                      return (
                        <tr
                          key={sub.id}
                          className={`hover:bg-slate-800/40 transition-colors ${
                            isWaitingQA ? 'bg-amber-500/5' : ''
                          }`}
                        >
                          <td className="py-4 px-5 font-mono">
                            <span className="font-bold text-brand-blue block text-sm">
                              {sub.session_code}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {new Date(sub.created_at).toLocaleString('it-IT')}
                            </span>
                          </td>
                          <td className="py-4 px-5">
                            <span className="font-bold text-brand-white block">{sub.form_title}</span>
                            <span className="text-[10px] text-slate-500 font-mono">{sub.form_code}</span>
                          </td>
                          <td className="py-4 px-5 font-semibold text-slate-200">
                            {sub.operator_name || 'Operatore'}
                          </td>
                          <td className="py-4 px-5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-brand-white">
                                {answers['step_mezzo'] || 'Automezzo'}
                              </span>
                              {answers['step_ddt'] && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[11px] text-slate-300 font-mono">
                                  DDT: {answers['step_ddt']}
                                </span>
                              )}
                              {answers['step_container'] && (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-[11px] text-amber-400 font-mono border border-amber-500/30">
                                  Cont: {answers['step_container']}
                                </span>
                              )}
                            </div>
                            {answers['step_sigillo'] && (
                              <span className="text-[11px] text-slate-400 block mt-0.5">
                                Sigillo: {answers['step_sigillo'] === 'SI' ? (answers['step_sigillo_num'] || 'Presente') : 'Assente / Non conforme'}
                              </span>
                            )}
                            {sub.unloaded_pallets_count > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold mt-1">
                                📦 {sub.unloaded_pallets_count} {sub.unloaded_pallets_count === 1 ? 'Paletta scaricata' : 'Palette scaricate'}
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-5">
                            {answers['step_temp_value'] !== undefined ? (
                              <span className="font-bold font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-xl">
                                {answers['step_temp_value']} °C
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[11px]">Ambiente</span>
                            )}
                          </td>
                          <td className="py-4 px-5">
                            {sub.status === 'COMPLETED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]">
                                <CheckCircle2 size={12} /> Confermato
                              </span>
                            )}
                            {sub.status === 'STANDBY_APPROVAL' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-400 font-black text-[11px] animate-pulse">
                                <ShieldAlert size={12} /> Standby QA/GDP
                              </span>
                            )}
                            {sub.status === 'IN_PROGRESS' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 font-bold text-[11px]">
                                <Clock size={12} /> In Corso
                              </span>
                            )}
                            {sub.status === 'REJECTED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 font-bold text-[11px]">
                                <AlertTriangle size={12} /> Respinto
                              </span>
                            )}
                            {sub.status === 'ABORTED' && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-bold text-[11px]">
                                <X size={12} /> Annullato
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* TASTI AZIONE SBLOCCO RAPIDO SE IN STANDBY */}
                              {isWaitingQA && canApprove && (
                                <>
                                  <button
                                    onClick={() => setApprovalModal({ show: true, submission: sub, notes: '' })}
                                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg active:scale-95 transition-all flex items-center gap-1.5"
                                    title="Sblocca e autorizza lo Zebra a proseguire"
                                  >
                                    <KeyRound size={14} /> Sblocca QA
                                  </button>
                                  <button
                                    onClick={() => handleRejectStandby(sub)}
                                    className="p-1.5 rounded-xl bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 active:scale-95 transition-all"
                                    title="Rifiuta e annulla arrivo"
                                  >
                                    <X size={16} />
                                  </button>
                                </>
                              )}

                              <button
                                onClick={() => setInspectSubmission(sub)}
                                className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-brand-blue hover:bg-slate-700 active:scale-95 transition-all"
                                title="Visualizza Dettagli Completi"
                              >
                                <Eye size={16} />
                              </button>

                              {canDeleteCheckin && (
                                <button
                                  onClick={() => handleDeleteSubmission(sub)}
                                  className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
                                  title="Elimina Registrazione Arrivo"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ELENCO E GESTIONE MODULI CONFIGURATI */}
      {activeTab === 'FORMS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {forms.map((f) => (
            <div
              key={f.id}
              className="bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-3xl p-5 shadow-xl flex flex-col justify-between transition-all"
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg bg-brand-blue/10 border border-brand-blue/20 text-brand-blue font-mono text-[10px] font-black uppercase">
                      {f.code}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      {f.target_device || 'ZEBRA'}
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                      f.is_active
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                        : 'bg-slate-800 border border-slate-700 text-slate-500'
                    }`}
                  >
                    {f.is_active ? 'Attivo' : 'Disattivato'}
                  </span>
                </div>

                <h3 className="text-lg font-black text-brand-white leading-tight mb-1">
                  {f.title}
                </h3>
                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-4">
                  {f.description || 'Nessuna descrizione.'}
                </p>

                <div className="flex items-center gap-4 text-xs text-slate-400 font-semibold bg-slate-950/50 rounded-2xl p-3 border border-slate-800/80 mb-4">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Passaggi</span>
                    <span className="font-bold text-brand-white font-mono">
                      {(f.steps || []).length} step
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Categoria</span>
                    <span className="font-bold text-brand-white">{f.category || 'INBOUND'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2">
                  {canManageForms && (
                    <button
                      onClick={() => handleEditForm(f)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-brand-blue hover:text-brand-black text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all"
                    >
                      <Edit2 size={14} /> Modifica Flusso
                    </button>
                  )}
                  {canDeleteForms && f.code !== 'ARRIVO_MERCE' && (
                    <button
                      onClick={() => handleDeleteForm(f)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all"
                      title="Elimina Modulo"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL DETTAGLIO COMPILAZIONE / SCHEDA ARRIVO */}
      {inspectSubmission && (
        <div className="fixed inset-0 z-50 bg-brand-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-xl shadow-2xl max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-start pb-4 border-b border-slate-800">
              <div>
                <span className="text-xs font-mono font-bold text-brand-blue uppercase block mb-1">
                  {inspectSubmission.session_code}
                </span>
                <h3 className="text-xl font-black text-brand-white">
                  Dettaglio Arrivo Merce
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Registrato il {new Date(inspectSubmission.created_at).toLocaleString('it-IT')} da {inspectSubmission.operator_name || 'Operatore'}
                </p>
              </div>
              <button
                onClick={() => setInspectSubmission(null)}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-brand-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              {/* Box Stato */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400">Stato Registrazione:</span>
                <span className="font-black text-xs px-3 py-1 rounded-full bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                  {inspectSubmission.status}
                </span>
              </div>

              {/* Se in standby o autorizzato */}
              {inspectSubmission.standby_reason && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs">
                  <span className="font-black text-amber-400 block mb-1">Motivo Blocco Standby:</span>
                  <p className="text-slate-300 leading-relaxed">{inspectSubmission.standby_reason}</p>
                  {inspectSubmission.approved_by_name && (
                    <div className="mt-2 pt-2 border-t border-amber-500/20 text-[11px] text-emerald-400 font-bold">
                      ✅ Sbloccato da {inspectSubmission.approved_by_name} il {new Date(inspectSubmission.approved_at).toLocaleString('it-IT')}
                      {inspectSubmission.approval_notes && <p className="text-slate-400 font-normal mt-0.5">Note: {inspectSubmission.approval_notes}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* Risposte fornite e Controlli Effettuati (Formattazione Avanzata) */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <ClipboardList size={16} className="text-brand-blue" />
                  Riepilogo Controlli & Risposte Acquisite
                </h4>
                <SubmissionAnswersViewer submission={inspectSubmission} forms={forms} />
              </div>

              {/* Sezione Speciale: Merce e Palette Scaricate da Questo Mezzo */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                      📦 Merce Scaricata da Questo Mezzo
                    </span>
                    {inspectSubmission.unloaded_goods?.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-black">
                        {inspectSubmission.unloaded_goods.length} {inspectSubmission.unloaded_goods.length === 1 ? 'Bancale' : 'Bancali'}
                      </span>
                    )}
                  </div>
                </div>

                {inspectSubmission.unloaded_goods && inspectSubmission.unloaded_goods.length > 0 ? (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {inspectSubmission.unloaded_goods.map((p, idx) => (
                      <div key={p.id || idx} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-brand-blue">{p.pallet_code}</span>
                            <span className="font-bold text-brand-white truncate">{p.product_name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                            <span>SKU: <strong className="text-slate-300 font-mono">{p.sku}</strong></span>
                            {p.batch && <span>Lotto: <strong className="text-slate-300">{p.batch}</strong></span>}
                            {p.location && <span>Ubicazione: <strong className="text-brand-blue font-mono">{p.location}</strong></span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <span className="font-black text-sm text-emerald-400 block">
                            {p.quantity} {p.uom || 'pz'}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(p.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 text-center text-xs text-slate-500">
                    <p>Nessun bancale o merce ancora scaricato per questo DDT/Container.</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Quando carichi la merce in <strong>Nuova Merce (Inbound)</strong> indicando il DDT/Container di questo mezzo, comparirà qui con tutti i dettagli e orari di scarico.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end gap-2">
              {inspectSubmission.status === 'STANDBY_APPROVAL' && canApprove && (
                <button
                  onClick={() => {
                    setApprovalModal({ show: true, submission: inspectSubmission, notes: '' });
                  }}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1.5"
                >
                  <KeyRound size={15} /> Sblocca Questa Sessione
                </button>
              )}
              <button
                onClick={() => setInspectSubmission(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AUTORIZZAZIONE E SBLOCCO STANDBY */}
      {approvalModal.show && (
        <div className="fixed inset-0 z-50 bg-brand-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-amber-500/40 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <KeyRound size={26} />
              </div>
              <div>
                <h3 className="text-lg font-black text-brand-white">
                  Autorizza Sblocco Arrivo
                </h3>
                <span className="text-xs font-mono text-brand-blue font-bold">
                  {approvalModal.submission?.session_code}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed bg-slate-950 p-3 rounded-xl border border-slate-800">
              {approvalModal.submission?.standby_reason || 'Richiesta sblocco procedura in standby.'}
            </p>

            <div className="mb-4">
              <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                Note o Motivazione di Sblocco QA
              </label>
              <textarea
                rows="3"
                value={approvalModal.notes}
                onChange={(e) => setApprovalModal(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Es. Verificato sigillo alternativo conforme da QA; autorizzato allo scarico."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-brand-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApprovalModal({ show: false, submission: null, notes: '' })}
                className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
              >
                Annulla
              </button>
              <button
                onClick={handleApproveStandby}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-lg active:scale-95 transition-all flex items-center gap-1.5"
              >
                <Check size={16} /> Conferma Sblocco in Tempo Reale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL VISUAL BUILDER MODULI GUIDATI */}
      {builderModal.show && (
        <div className="fixed inset-0 z-50 bg-brand-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-5xl shadow-2xl h-[90vh] flex flex-col">
            {/* BUILDER HEADER */}
            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
                  <Layers size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-brand-white">
                    {builderModal.isNew ? 'Crea Nuovo Modulo Guidato' : `Modifica Flusso: ${builderModal.title}`}
                  </h3>
                  <span className="text-xs font-mono text-slate-400">Codice: {builderModal.code}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveForm}
                  className="px-5 py-2.5 rounded-xl bg-brand-blue text-brand-black font-black text-xs hover:bg-sky-400 active:scale-95 transition-all shadow-lg flex items-center gap-1.5"
                >
                  <Check size={16} /> Salva Flusso Modulo
                </button>
                <button
                  onClick={() => setBuilderModal(prev => ({ ...prev, show: false }))}
                  className="p-2.5 rounded-xl bg-slate-800 text-slate-400 hover:text-brand-white"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* BUILDER MAIN CONTENT: 2 COLONNE (STEPS LIST + STEP EDITOR) */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-5 py-4 overflow-hidden">
              {/* COLONNA SINISTRA: METADATA & LISTA STEPS (4 cols) */}
              <div className="md:col-span-4 flex flex-col gap-3 overflow-y-auto pr-1 border-r border-slate-800/80">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Titolo Modulo</label>
                    <input
                      type="text"
                      value={builderModal.title}
                      onChange={(e) => setBuilderModal(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-brand-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Descrizione</label>
                    <input
                      type="text"
                      value={builderModal.description}
                      onChange={(e) => setBuilderModal(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Obiettivo del modulo"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-brand-white"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs font-bold text-slate-300">Stato Modulo:</span>
                    <button
                      type="button"
                      onClick={() => setBuilderModal(prev => ({ ...prev, is_active: !prev.is_active }))}
                      className={`px-3 py-1 rounded-xl text-xs font-black uppercase ${
                        builderModal.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {builderModal.is_active ? 'Attivo' : 'Bozza'}
                    </button>
                  </div>

                  {/* Configurazione Visiva & Posizione su Zebra */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                    <div>
                      <label className="text-[10px] font-bold text-brand-blue uppercase block mb-1">
                        Posizione sul Terminale Zebra
                      </label>
                      <select
                        value={builderModal.display_mode || 'SHOW_ON_HOME'}
                        onChange={(e) => setBuilderModal(prev => ({ ...prev, display_mode: e.target.value }))}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-brand-white font-semibold"
                      >
                        <option value="SHOW_ON_HOME">Pulsante Diretto su Home Zebra</option>
                        <option value="MENU">Nel Menu Moduli & Check-in</option>
                        <option value="DEFAULT_ARRIVAL">Flusso Principale "Arrivo Merce"</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Icona</label>
                        <select
                          value={builderModal.icon || 'Truck'}
                          onChange={(e) => setBuilderModal(prev => ({ ...prev, icon: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-brand-white"
                        >
                          <option value="Truck">Camion 🚛</option>
                          <option value="Box">Pacco 📦</option>
                          <option value="ClipboardList">Checklist 📋</option>
                          <option value="Thermometer">Termometro 🌡️</option>
                          <option value="ShieldAlert">Sicurezza 🛡️</option>
                          <option value="Sparkles">Qualità ✨</option>
                          <option value="Smartphone">Zebra 📱</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Colore Accento</label>
                        <select
                          value={builderModal.color_accent || 'cyan'}
                          onChange={(e) => setBuilderModal(prev => ({ ...prev, color_accent: e.target.value }))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-brand-white"
                        >
                          <option value="cyan">Ciano Luminoso</option>
                          <option value="blue">Blu MagLite</option>
                          <option value="amber">Ambra / Giallo</option>
                          <option value="emerald">Verde Smeraldo</option>
                          <option value="rose">Rosso Allerta</option>
                        </select>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 pt-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(builderModal.is_default)}
                        onChange={(e) => setBuilderModal(prev => ({ ...prev, is_default: e.target.checked }))}
                        className="rounded bg-slate-900 border-slate-700 text-brand-blue"
                      />
                      <span className="text-[11px] font-bold text-slate-300">
                        Imposta come modulo predefinito Arrivo Merce
                      </span>
                    </label>
                  </div>
                </div>

                {/* LISTA PASSAGGI */}
                <div className="flex justify-between items-center pt-2">
                  <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider">
                    Sequenza Passaggi ({builderModal.steps.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="text-xs font-bold text-brand-blue hover:underline flex items-center gap-1"
                  >
                    <Plus size={14} /> Aggiungi Passo
                  </button>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto">
                  {builderModal.steps.map((st, idx) => (
                    <div
                      key={st.id || idx}
                      onClick={() => setEditingStepIndex(idx)}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                        editingStepIndex === idx
                          ? 'border-brand-blue bg-brand-blue/10 text-brand-white shadow-md'
                          : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-lg bg-slate-800 text-[10px] font-black text-slate-300 flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="font-bold text-xs truncate block text-brand-white">
                            {st.title || 'Senza titolo'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {st.type}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleMoveStep(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 rounded text-slate-500 hover:text-brand-white disabled:opacity-20"
                          title="Sposta Su"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveStep(idx, 1)}
                          disabled={idx === builderModal.steps.length - 1}
                          className="p-1 rounded text-slate-500 hover:text-brand-white disabled:opacity-20"
                          title="Sposta Giù"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStep(idx)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400"
                          title="Elimina"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* COLONNA DESTRA: DETTAGLIO ED EDITOR STEP SELEZIONATO (8 cols) */}
              <div className="md:col-span-8 flex flex-col gap-4 overflow-y-auto pl-1">
                {currentEditingStep ? (
                  <div className="bg-slate-950/90 border border-slate-800 rounded-3xl p-5 space-y-4">
                    <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-brand-blue/15 text-brand-blue font-black text-xs font-mono">
                          ID: {currentEditingStep.id}
                        </span>
                        <h4 className="text-base font-black text-brand-white">
                          Configura Passaggio {editingStepIndex + 1}
                        </h4>
                      </div>

                      {/* SELETTORE TIPO PASSAGGIO */}
                      <select
                        value={currentEditingStep.type}
                        onChange={(e) => updateCurrentStepField('type', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-white focus:outline-none focus:border-brand-blue"
                      >
                        {STEP_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* TITOLO E ISTRUZIONI */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                          Domanda / Titolo dello Step
                        </label>
                        <input
                          type="text"
                          value={currentEditingStep.title || ''}
                          onChange={(e) => updateCurrentStepField('title', e.target.value)}
                          placeholder="Es. È presente un sigillo?"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-brand-white"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                          Istruzioni per l&apos;Operatore (Sottotitolo)
                        </label>
                        <input
                          type="text"
                          value={currentEditingStep.subtitle || ''}
                          onChange={(e) => updateCurrentStepField('subtitle', e.target.value)}
                          placeholder="Es. Verifica visiva sul portellone del mezzo"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-brand-white"
                        />
                      </div>
                    </div>

                    {/* CONFIGURAZIONE SPECIFICA PER TIPO STEP */}

                    {/* CASO 1: CHOICE (BOTTONI CON BIFORCAZIONE) */}
                    {currentEditingStep.type === 'CHOICE' && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black uppercase text-slate-400">
                            Pulsanti Opzioni e Destinazione Flusso
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const opts = currentEditingStep.options || [];
                              updateCurrentStepField('options', [
                                ...opts,
                                { label: 'Nuova Opzione', value: 'OPT_' + (opts.length + 1), next_step_id: '', color: 'blue' }
                              ]);
                            }}
                            className="text-xs font-bold text-brand-blue hover:underline"
                          >
                            + Aggiungi Bottone
                          </button>
                        </div>

                        <div className="space-y-2.5">
                          {(currentEditingStep.options || []).map((opt, optIdx) => (
                            <div key={optIdx} className="bg-slate-900 p-3 rounded-2xl border border-slate-800 flex items-center gap-3">
                              <input
                                type="text"
                                value={opt.label}
                                onChange={(e) => {
                                  const newOpts = [...currentEditingStep.options];
                                  newOpts[optIdx].label = e.target.value;
                                  newOpts[optIdx].value = e.target.value.toUpperCase().replace(/\s+/g, '_');
                                  updateCurrentStepField('options', newOpts);
                                }}
                                placeholder="Testo Bottone"
                                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-white"
                              />

                              <select
                                value={opt.color || 'blue'}
                                onChange={(e) => {
                                  const newOpts = [...currentEditingStep.options];
                                  newOpts[optIdx].color = e.target.value;
                                  updateCurrentStepField('options', newOpts);
                                }}
                                className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-brand-white"
                              >
                                <option value="blue">Blu</option>
                                <option value="emerald">Verde</option>
                                <option value="amber">Giallo</option>
                                <option value="rose">Rosso</option>
                                <option value="cyan">Ciano</option>
                                <option value="slate">Grigio</option>
                              </select>

                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-500 font-semibold">Vai a:</span>
                                <select
                                  value={opt.next_step_id || ''}
                                  onChange={(e) => {
                                    const newOpts = [...currentEditingStep.options];
                                    newOpts[optIdx].next_step_id = e.target.value;
                                    updateCurrentStepField('options', newOpts);
                                  }}
                                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-brand-blue"
                                >
                                  <option value="">-- Passo Successivo Standard --</option>
                                  {builderModal.steps.map(s => (
                                    <option key={s.id} value={s.id}>{s.id} - {s.title}</option>
                                  ))}
                                </select>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const newOpts = [...currentEditingStep.options];
                                  newOpts.splice(optIdx, 1);
                                  updateCurrentStepField('options', newOpts);
                                }}
                                className="p-1.5 text-slate-500 hover:text-rose-400"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* CASO 2: TEXT */}
                    {currentEditingStep.type === 'TEXT' && (
                      <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                            Placeholder Casella di Testo
                          </label>
                          <input
                            type="text"
                            value={currentEditingStep.placeholder || ''}
                            onChange={(e) => updateCurrentStepField('placeholder', e.target.value)}
                            placeholder="Es. DDT-12345"
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-brand-white"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                            Passo Successivo dopo Invio
                          </label>
                          <select
                            value={currentEditingStep.next_step_id || ''}
                            onChange={(e) => updateCurrentStepField('next_step_id', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-brand-blue"
                          >
                            <option value="">-- Passo Successivo in Sequenza --</option>
                            {builderModal.steps.map(s => (
                              <option key={s.id} value={s.id}>{s.id} - {s.title}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* CASO 3: TEMPERATURE */}
                    {currentEditingStep.type === 'TEMPERATURE' && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                              Passo Successivo se Conforme
                            </label>
                            <select
                              value={currentEditingStep.next_step_id || ''}
                              onChange={(e) => updateCurrentStepField('next_step_id', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-400"
                            >
                              <option value="">-- Prosegui normalmente --</option>
                              {builderModal.steps.map(s => (
                                <option key={s.id} value={s.id}>{s.id} - {s.title}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                              Passo se NON Conforme (Discrepanza)
                            </label>
                            <select
                              value={currentEditingStep.next_if_discrepancy || ''}
                              onChange={(e) => updateCurrentStepField('next_if_discrepancy', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-rose-400"
                            >
                              <option value="">-- Vai a Schermata di Alt / Reject --</option>
                              {builderModal.steps.map(s => (
                                <option key={s.id} value={s.id}>{s.id} - {s.title}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CASO 4: STANDBY */}
                    {currentEditingStep.type === 'STANDBY' && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                        <div>
                          <label className="text-[11px] font-bold text-amber-400 uppercase block mb-1">
                            Motivo del Fermo Standby Mostrato all&apos;Operatore
                          </label>
                          <textarea
                            rows="2"
                            value={currentEditingStep.standby_reason || ''}
                            onChange={(e) => updateCurrentStepField('standby_reason', e.target.value)}
                            placeholder="Es. Sigillo assente o anomalia riscontrata. Richiesta autorizzazione formale QA/GDP."
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-brand-white"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                            Passo Successivo una volta Sbloccato da QA/Supervisore
                          </label>
                          <select
                            value={currentEditingStep.next_step_id_on_approved || ''}
                            onChange={(e) => updateCurrentStepField('next_step_id_on_approved', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-emerald-400"
                          >
                            <option value="">-- Seleziona passo successivo --</option>
                            {builderModal.steps.map(s => (
                              <option key={s.id} value={s.id}>{s.id} - {s.title}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* CASO 5: REJECT */}
                    {currentEditingStep.type === 'REJECT' && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
                        <div>
                          <label className="text-[11px] font-bold text-rose-400 uppercase block mb-1">
                            Messaggio di Alt Scarico
                          </label>
                          <textarea
                            rows="2"
                            value={currentEditingStep.rejection_message || ''}
                            onChange={(e) => updateCurrentStepField('rejection_message', e.target.value)}
                            placeholder="Es. Non scaricare ancora, invita l'autista a sostare fuori e fallo tornare quando il camion sarà a temperatura."
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-brand-white"
                          />
                        </div>
                      </div>
                    )}

                    {/* CASO 6: CHECKLIST MULTI-SPUNTA CONFIGURABILE */}
                    {currentEditingStep.type === 'CHECKLIST' && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-4">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="text-xs font-black uppercase text-brand-blue block">
                              Voci di Controllo e Condizioni di Blocco
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Configura ogni singola voce della checklist e definisci cosa succede se non è conforme.
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const items = currentEditingStep.items || [];
                              const newId = 'chk_' + Date.now().toString().slice(-4);
                              updateCurrentStepField('items', [
                                ...items,
                                {
                                  id: newId,
                                  label: 'Nuovo controllo ispezione',
                                  required_condition: 'CHECKED',
                                  action_on_violation: 'STANDBY',
                                  violation_message: 'Anomalia rilevata durante l\'ispezione. Richiesto sblocco da PC/QA.'
                                }
                              ]);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-brand-blue/15 text-brand-blue hover:bg-brand-blue hover:text-brand-black font-bold text-xs transition-all flex items-center gap-1"
                          >
                            <Plus size={14} /> Aggiungi Voce
                          </button>
                        </div>

                        <div className="space-y-3">
                          {(currentEditingStep.items || []).map((item, itemIdx) => (
                            <div key={item.id || itemIdx} className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 space-y-2.5">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={item.label}
                                  onChange={(e) => {
                                    const newItems = [...currentEditingStep.items];
                                    newItems[itemIdx].label = e.target.value;
                                    updateCurrentStepField('items', newItems);
                                  }}
                                  placeholder="Descrizione controllo (es. Pianale pulito e asciutto)"
                                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-brand-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newItems = [...currentEditingStep.items];
                                    newItems.splice(itemIdx, 1);
                                    updateCurrentStepField('items', newItems);
                                  }}
                                  className="p-1.5 text-slate-500 hover:text-rose-400"
                                  title="Elimina Voce"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-1">
                                    Condizione di Conformità:
                                  </label>
                                  <select
                                    value={item.required_condition || 'CHECKED'}
                                    onChange={(e) => {
                                      const newItems = [...currentEditingStep.items];
                                      newItems[itemIdx].required_condition = e.target.value;
                                      updateCurrentStepField('items', newItems);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-brand-white"
                                  >
                                    <option value="CHECKED">Deve essere SPUNTATA (OK se selezionata)</option>
                                    <option value="UNCHECKED">NON deve essere spuntata (OK se deselezionata)</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="text-[10px] font-bold text-amber-400 block mb-1">
                                    Cosa succede se NON è conforme?
                                  </label>
                                  <select
                                    value={item.action_on_violation || 'STANDBY'}
                                    onChange={(e) => {
                                      const newItems = [...currentEditingStep.items];
                                      newItems[itemIdx].action_on_violation = e.target.value;
                                      updateCurrentStepField('items', newItems);
                                    }}
                                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-brand-blue"
                                  >
                                    <option value="STANDBY">⚠️ Blocco Standby (Richiede Sblocco da PC / QA)</option>
                                    <option value="BLOCK">🛑 Alt Scarico (Blocca operatore e respinge)</option>
                                    <option value="WARN">⚡ Avviso (Chiede conferma prima di proseguire)</option>
                                    <option value="PASS">ℹ️ Solo Registrazione (Nessun blocco)</option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="text-[10px] font-bold text-slate-400 block mb-1">
                                  Messaggio Anomalia (mostrato allo Zebra e registrato per l&apos;ufficio):
                                </label>
                                <input
                                  type="text"
                                  value={item.violation_message || ''}
                                  onChange={(e) => {
                                    const newItems = [...currentEditingStep.items];
                                    newItems[itemIdx].violation_message = e.target.value;
                                    updateCurrentStepField('items', newItems);
                                  }}
                                  placeholder="Es. Pianale non conforme. Richiesta autorizzazione formale QA/GDP."
                                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-300"
                                />
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="pt-2 border-t border-slate-800">
                          <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">
                            Passo Successivo dopo Invio Checklist
                          </label>
                          <select
                            value={currentEditingStep.next_step_id || ''}
                            onChange={(e) => updateCurrentStepField('next_step_id', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-brand-blue"
                          >
                            <option value="">-- Passo Successivo in Sequenza --</option>
                            {builderModal.steps.map(s => (
                              <option key={s.id} value={s.id}>{s.id} - {s.title}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 font-semibold text-xs">
                    Seleziona un passaggio dalla lista a sinistra per configurarlo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomFormsManager;
