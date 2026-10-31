import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  ChevronLeft,
  Truck,
  Box,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Thermometer,
  FileText,
  KeyRound,
  RotateCcw,
  Check,
  X,
  Lock,
  ArrowRight,
  Sparkles,
  ClipboardCheck,
  Clock,
  ScanBarcode
} from 'lucide-react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { appAlert, appConfirm } from '../utils/alerts';

const ZebraCheckinWizard = () => {
  const navigate = useNavigate();
  const { formCode: paramFormCode } = useParams();
  const location = useLocation();
  const targetFormCode = paramFormCode || location.state?.formCode || 'ARRIVO_MERCE';
  const token = localStorage.getItem('maglite_token');
  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');

  const [form, setForm] = useState(null);
  const [steps, setSteps] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentStepId, setCurrentStepId] = useState(null);
  const [sessionCode, setSessionCode] = useState(null);
  const [answers, setAnswers] = useState({});
  const [stepHistory, setStepHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Standby & Approval State
  const [isStandby, setIsStandby] = useState(false);
  const [standbyReason, setStandbyReason] = useState('');
  const [showSupervisorModal, setShowSupervisorModal] = useState(false);
  const [supervisorUsername, setSupervisorUsername] = useState('');
  const [supervisorPassword, setSupervisorPassword] = useState('');
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [supervisorError, setSupervisorError] = useState(null);

  // Field Inputs
  const [textInput, setTextInput] = useState('');
  const [tempInput, setTempInput] = useState('');
  const [checklistValues, setChecklistValues] = useState({});
  const [isCompleted, setIsCompleted] = useState(false);
  const [isRejected, setIsRejected] = useState(false);
  const [rejectionMessage, setRejectionMessage] = useState('');

  const socketRef = useRef(null);

  // 1. Initial Load: Fetch Form & Start Session
  useEffect(() => {
    const initSession = async () => {
      try {
        setLoading(true);
        // Recupera modulo specificato
        const resForm = await axios.get(`http://${window.location.hostname}:3000/api/custom-forms/${targetFormCode}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const formData = resForm.data;
        setForm(formData);
        const formSteps = formData.steps || [];
        setSteps(formSteps);

        if (formSteps.length === 0) {
          appAlert(`Nessun passaggio configurato nel modulo "${formData.title}".`, 'Errore', 'error');
          navigate('/zebra');
          return;
        }

        // Avvia sessione sul backend per il modulo specificato
        const resSession = await axios.post(
          `http://${window.location.hostname}:3000/api/custom-forms/sessions/start`,
          { form_code: targetFormCode },
          { headers: { Authorization: `Bearer ${token}` } }
        );

        setSessionCode(resSession.data.session_code);
        setCurrentStepId(formSteps[0].id);
        setCurrentStepIndex(0);
        setStepHistory([formSteps[0].id]);
      } catch (err) {
        console.error('Errore avvio sessione arrivo:', err);
        appAlert(err.response?.data?.error || 'Impossibile avviare il modulo di arrivo merce.', 'Errore', 'error');
        navigate('/zebra');
      } finally {
        setLoading(false);
      }
    };

    initSession();

    // Inizializza Socket per ascolto sblocchi in tempo reale
    const socket = io(`http://${window.location.hostname}:3000`);
    socketRef.current = socket;

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  // 2. Real-time WebSocket Listeners for Standby Unlocking
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !sessionCode) return;

    const handleApproval = (data) => {
      if (data.session_code === sessionCode && data.status === 'APPROVED') {
        setIsStandby(false);
        setShowSupervisorModal(false);
        appAlert(`Autorizzazione ricevuta da ${data.approved_by_name || 'Ufficio'}. Procedura sbloccata!`, 'Sblocco Autorizzato', 'success');
        
        // Passa allo step indicato o cerca nel form
        if (data.next_step_id) {
          goToStep(data.next_step_id);
        } else {
          goToNextDefault();
        }
      }
    };

    const handleAborted = (data) => {
      if (data.session_code === sessionCode) {
        appAlert('La sessione è stata annullata dall\'ufficio.', 'Arrivo Annullato', 'warning');
        navigate('/zebra');
      }
    };

    socket.on('custom_form_approval', handleApproval);
    socket.on('custom_form_aborted', handleAborted);

    return () => {
      socket.off('custom_form_approval', handleApproval);
      socket.off('custom_form_aborted', handleAborted);
    };
  }, [sessionCode, steps, currentStepId]);

  // Supporto lettura barcode tramite pistola laser (se lo step corrente è TEXT)
  useBarcodeScanner((barcode) => {
    const clean = (barcode || '').trim();
    if (!clean) return;
    const currentStep = steps.find(s => s.id === currentStepId);
    if (currentStep && currentStep.type === 'TEXT') {
      setTextInput(clean);
    }
  });

  const currentStep = steps.find(s => s.id === currentStepId) || steps[currentStepIndex];

  // Reset input quando cambia lo step
  useEffect(() => {
    if (!currentStep) return;
    if (currentStep.type === 'TEXT') {
      setTextInput(answers[currentStep.id] || '');
    } else if (currentStep.type === 'TEMPERATURE') {
      setTempInput(answers[currentStep.id] !== undefined ? String(answers[currentStep.id]) : '');
    } else if (currentStep.type === 'CHECKLIST') {
      const existing = answers[currentStep.id] || {};
      setChecklistValues(existing);
    } else if (currentStep.type === 'STANDBY') {
      setIsStandby(true);
      setStandbyReason(currentStep.standby_reason || 'In attesa di autorizzazione QA / Ufficio');
    }
  }, [currentStepId]);

  // Funzione per navigare a uno step specifico
  const goToStep = (targetStepId) => {
    const targetIdx = steps.findIndex(s => s.id === targetStepId);
    if (targetIdx !== -1) {
      setCurrentStepId(targetStepId);
      setCurrentStepIndex(targetIdx);
      setStepHistory(prev => [...prev, targetStepId]);
    } else {
      console.warn(`Target step ${targetStepId} non trovato nei passaggi.`);
    }
  };

  const goToNextDefault = () => {
    if (currentStepIndex + 1 < steps.length) {
      const next = steps[currentStepIndex + 1];
      goToStep(next.id);
    }
  };

  // 3. Gestione Scelta Bottoni (CHOICE)
  const handleChoiceSelect = async (option) => {
    if (isSubmitting) return;
    const answerVal = option.value;
    const updatedAnswers = { ...answers, [currentStep.id]: answerVal };
    setAnswers(updatedAnswers);

    const nextId = option.next_step_id;
    const targetStep = steps.find(s => s.id === nextId);

    const isTargetStandby = targetStep?.type === 'STANDBY';
    const isTargetReject = targetStep?.type === 'REJECT';

    try {
      setIsSubmitting(true);
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
        {
          step_id: currentStep.id,
          answer: answerVal,
          next_step_id: nextId,
          is_standby: isTargetStandby,
          standby_reason: isTargetStandby ? (targetStep.standby_reason || 'Richiesta verifica QA/GDP') : null,
          is_rejected: isTargetReject,
          rejection_reason: isTargetReject ? targetStep.rejection_message : null
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (isTargetStandby) {
        setIsStandby(true);
        setStandbyReason(targetStep.standby_reason || 'In attesa di sblocco QA / Ufficio');
      }

      if (isTargetReject) {
        setIsRejected(true);
        setRejectionMessage(targetStep.rejection_message || 'Merce non conforme');
      }

      goToStep(nextId);
    } catch (err) {
      console.error(err);
      appAlert('Errore nel salvataggio della risposta.', 'Errore', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. Gestione Campo Testo (TEXT) con Controllo Duplicati DDT / Container
  const handleTextSubmit = async (e) => {
    if (e) e.preventDefault();
    const val = textInput.trim();
    if (currentStep.required && !val) {
      return appAlert(`Compila il campo "${currentStep.title}" per proseguire.`, 'Dato Obbligatorio', 'warning');
    }

    const isDdtOrContainer = 
      currentStep.id === 'step_ddt' || 
      currentStep.id === 'step_container' || 
      (currentStep.field_key && (currentStep.field_key.includes('ddt') || currentStep.field_key.includes('container')));

    if (isDdtOrContainer && val) {
      try {
        setIsSubmitting(true);
        const dupRes = await axios.post(`http://${window.location.hostname}:3000/api/custom-forms/sessions/check-duplicate`, {
          query: val,
          current_session_code: sessionCode,
          type: currentStep.id === 'step_container' ? 'CONTAINER' : 'DDT'
        }, { headers: { Authorization: `Bearer ${token}` } });

        if (dupRes.data?.found) {
          const dup = dupRes.data.submission;

          // CASO 1: Sessione non completata (IN_PROGRESS)
          if (dup.status === 'IN_PROGRESS') {
            const resume = await appConfirm(
              `Trovata una sessione in corso per questo ${dup.container ? 'Container' : 'DDT'} (${val}), avviata oggi alle ${dup.event_time_formatted || ''} da ${dup.operator_name || 'Operatore'}.\n\nVuoi riprendere la compilazione da dove era rimasto?`,
              'Riprendi Arrivo Incompleto'
            );
            if (resume) {
              setSessionCode(dup.session_code);
              setAnswers(dup.answers || {});
              if (dup.current_step_id) {
                goToStep(dup.current_step_id);
              } else {
                goToStep(currentStep.next_step_id);
              }
              setIsSubmitting(false);
              return;
            }
          } else if (dup.status === 'STANDBY_APPROVAL') {
            // Se bloccato dal PC e bisogna aspettare lo sblocco
            appAlert(`Questo ${dup.container ? 'Container' : 'DDT'} (${val}) è attualmente in attesa di sblocco da parte dell'Ufficio QA/GDP.\n\nMotivo: ${dup.standby_reason || 'In attesa approvazione'}`, 'In Attesa di Sblocco PC', 'warning');
            setSessionCode(dup.session_code);
            setAnswers(dup.answers || {});
            setIsStandby(true);
            setStandbyReason(dup.standby_reason || 'In attesa di sblocco da Ufficio / QA');
            setIsSubmitting(false);
            return;
          } else if (dup.status === 'COMPLETED') {
            // CASO 2: Completato lo stesso giorno
            if (dup.is_same_day) {
              setIsSubmitting(false);
              return appAlert(
                `🛑 Il mezzo con ${dup.container ? 'Container' : 'DDT'} "${val}" è già stato scaricato e completato oggi alle ${dup.event_time_formatted} da ${dup.operator_name}.\n\nScarico già ultimato per la data odierna.`,
                'Arrivo Già Scaricato',
                'warning'
              );
            } else {
              // CASO 3: Completato in un giorno differente
              const proceedNew = await appConfirm(
                `⚠️ Attenzione: questo ${dup.container ? 'Container' : 'DDT'} "${val}" era già arrivato il ${dup.event_date_formatted} (da ${dup.operator_name}).\n\nSi tratta di un NUOVO arrivo con altra merce da scaricare?`,
                'Nuovo Arrivo Mezzo'
              );
              if (!proceedNew) {
                setIsSubmitting(false);
                return;
              }
            }
          }
        }
      } catch (chkErr) {
        console.warn('Errore check duplicate:', chkErr);
      } finally {
        setIsSubmitting(false);
      }
    }

    const updatedAnswers = { ...answers, [currentStep.id]: val };
    setAnswers(updatedAnswers);

    const nextId = currentStep.next_step_id;
    try {
      setIsSubmitting(true);
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
        {
          step_id: currentStep.id,
          answer: val,
          next_step_id: nextId
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      goToStep(nextId);
    } catch (err) {
      console.error(err);
      appAlert('Errore nel salvataggio del testo.', 'Errore', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 5. Gestione Misura Temperatura (TEMPERATURE)
  const handleTempSubmit = async () => {
    const rawVal = tempInput.replace(',', '.').trim();
    if (rawVal === '' || isNaN(Number(rawVal))) {
      return appAlert('Inserisci un valore numerico di temperatura valido (°C).', 'Dato Mancante', 'warning');
    }

    const numTemp = parseFloat(rawVal);
    const updatedAnswers = { ...answers, [currentStep.id]: numTemp };
    setAnswers(updatedAnswers);

    // Verifica tolleranza termica
    let isCompliant = true;
    let expectedLabel = '';

    if (currentStep.check_range_against && currentStep.range_definitions) {
      const selectedRangeKey = answers[currentStep.check_range_against] || answers['step_temp_range'];
      const rangeDef = currentStep.range_definitions[selectedRangeKey];
      if (rangeDef) {
        expectedLabel = rangeDef.label || '';
        if (rangeDef.min !== undefined && numTemp < rangeDef.min) isCompliant = false;
        if (rangeDef.max !== undefined && numTemp > rangeDef.max) isCompliant = false;
      }
    }

    const targetNextId = isCompliant ? currentStep.next_step_id : (currentStep.next_if_discrepancy || 'step_temp_reject');
    const isTargetReject = !isCompliant && targetNextId.includes('reject');

    try {
      setIsSubmitting(true);
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
        {
          step_id: currentStep.id,
          answer: numTemp,
          next_step_id: targetNextId,
          is_rejected: isTargetReject,
          rejection_reason: !isCompliant ? `Temperatura ${numTemp}°C fuori tolleranza (${expectedLabel})` : null
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (isTargetReject) {
        setIsRejected(true);
        setRejectionMessage(`Temperatura rilevata (${numTemp}°C) non conforme con la fascia richiesta (${expectedLabel}). Non scaricare ancora!`);
      }

      goToStep(targetNextId);
    } catch (err) {
      console.error(err);
      appAlert('Errore nel salvataggio della temperatura.', 'Errore', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Gestione Checklist (CHECKLIST)
  const toggleChecklistItem = (itemId) => {
    setChecklistValues(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  const handleSelectAllChecklist = () => {
    const all = {};
    (currentStep.items || []).forEach(item => {
      all[item.id] = true;
    });
    setChecklistValues(all);
  };

  const handleChecklistSubmit = async () => {
    const updatedAnswers = { ...answers, [currentStep.id]: checklistValues };
    setAnswers(updatedAnswers);

    const items = currentStep.items || [];
    const blockingViolations = [];
    const standbyViolations = [];
    const warningViolations = [];

    items.forEach(item => {
      const isChecked = Boolean(checklistValues[item.id]);
      const req = item.required_condition || 'CHECKED';
      const isCompliant = req === 'UNCHECKED' ? !isChecked : isChecked;

      if (!isCompliant) {
        const action = item.action_on_violation || 'STANDBY';
        const msg = item.violation_message || item.label || 'Condizione non conforme';
        if (action === 'BLOCK') {
          blockingViolations.push({ item, msg });
        } else if (action === 'STANDBY') {
          standbyViolations.push({ item, msg });
        } else if (action === 'WARN') {
          warningViolations.push({ item, msg });
        }
      }
    });

    // 1. Azione di ALT SCARICO (BLOCK)
    if (blockingViolations.length > 0) {
      const rejectReason = blockingViolations.map(v => v.msg).join('; ');
      try {
        setIsSubmitting(true);
        await axios.post(
          `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
          {
            step_id: currentStep.id,
            answer: checklistValues,
            is_rejected: true,
            rejection_reason: rejectReason
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setIsRejected(true);
        setRejectionMessage(`🛑 Alt Scarico: ${rejectReason}. Non procedere con lo scarico della merce!`);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 2. Azione di FERMO STANDBY (STANDBY)
    if (standbyViolations.length > 0) {
      const sReason = standbyViolations.map(v => v.msg).join('; ');
      try {
        setIsSubmitting(true);
        await axios.post(
          `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
          {
            step_id: currentStep.id,
            answer: checklistValues,
            is_standby: true,
            standby_reason: sReason
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setIsStandby(true);
        setStandbyReason(sReason);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 3. Azione di AVVISO (WARN)
    if (warningViolations.length > 0) {
      const proceed = await appConfirm(
        `Attenzione alle seguenti anomalie riscontrate:\n• ${warningViolations.map(v => v.msg).join('\n• ')}\n\nConfermi di voler procedere ugualmente?`,
        'Conferma con Riserva'
      );
      if (!proceed) return;
    }

    // 4. Tutte le verifiche superate: procedi al passo successivo
    const nextId = currentStep.next_step_id;
    try {
      setIsSubmitting(true);
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
        {
          step_id: currentStep.id,
          answer: checklistValues,
          next_step_id: nextId
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      goToStep(nextId);
    } catch (err) {
      console.error(err);
      appAlert('Errore nel salvataggio della checklist.', 'Errore', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 7. Sblocco Supervisore su Dispositivo (PIN / Password Modal)
  const handleSupervisorUnlock = async (e) => {
    if (e) e.preventDefault();
    if (!supervisorUsername.trim() || !supervisorPassword.trim()) {
      setSupervisorError('Inserisci sia il nome utente che la password del supervisore.');
      return;
    }

    try {
      setIsSubmitting(true);
      setSupervisorError(null);
      const res = await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/approve`,
        {
          supervisor_username: supervisorUsername.trim(),
          supervisor_password: supervisorPassword.trim(),
          approval_notes: supervisorNotes.trim() || 'Sblocco manuale con credenziali supervisore su Zebra'
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setIsStandby(false);
      setShowSupervisorModal(false);
      appAlert(res.data.message || 'Procedura sbloccata con successo!', 'Sblocco Riuscito', 'success');

      if (res.data.next_step_id) {
        goToStep(res.data.next_step_id);
      } else {
        goToNextDefault();
      }
    } catch (err) {
      console.error(err);
      setSupervisorError(err.response?.data?.error || 'Credenziali o permessi supervisore non validi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 8. Conferma Finale di Conclusione (SUMMARY)
  const handleFinalConfirm = async () => {
    try {
      setIsSubmitting(true);
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/step`,
        {
          step_id: 'step_summary',
          answer: 'CONFIRMED',
          is_completed: true
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setIsCompleted(true);
    } catch (err) {
      console.error(err);
      appAlert('Errore nella registrazione finale dell\'arrivo.', 'Errore', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 9. Annulla Arrivo
  const handleAbortSession = async () => {
    const hasCompletedAnyStep = Object.keys(answers).length > 0;

    // Se l'operatore è entrato per sbaglio e non ha ancora compilato alcun dato,
    // esce direttamente senza chiedere conferma e senza sporcare il database con registrazioni annullate.
    if (!hasCompletedAnyStep) {
      if (sessionCode) {
        axios.post(
          `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/abort`,
          { reason: 'Uscita prima compilazione (nessun dato inserito)' },
          { headers: { Authorization: `Bearer ${token}` } }
        ).catch(() => {});
      }
      navigate('/zebra');
      return;
    }

    if (!await appConfirm('Sei sicuro di voler annullare questo arrivo merce? Tutti i dati inseriti verranno archiviati come ANNULLATI.', 'Annullare Arrivo?')) {
      return;
    }

    try {
      setIsSubmitting(true);
      await axios.post(
        `http://${window.location.hostname}:3000/api/custom-forms/sessions/${sessionCode}/abort`,
        { reason: 'Annullato dall\'operatore su terminale Zebra' },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      navigate('/zebra');
    } catch (err) {
      console.error(err);
      navigate('/zebra');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Indietro di uno step
  const handleGoBack = () => {
    if (stepHistory.length > 1) {
      const newHistory = [...stepHistory];
      newHistory.pop(); // togli step corrente
      const prevStepId = newHistory[newHistory.length - 1];
      setStepHistory(newHistory);
      const prevIdx = steps.findIndex(s => s.id === prevStepId);
      if (prevIdx !== -1) {
        setCurrentStepId(prevStepId);
        setCurrentStepIndex(prevIdx);
        setIsStandby(false);
        setIsRejected(false);
      }
    } else {
      handleAbortSession();
    }
  };

  // Riprova temperatura in caso di reject
  const handleRetryTemperature = () => {
    setIsRejected(false);
    goToStep('step_temp_value');
  };

  // LOADING STATE
  if (loading) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-3xl bg-brand-blue/15 border border-brand-blue/30 flex items-center justify-center text-brand-blue animate-pulse mb-4">
          <Truck size={32} />
        </div>
        <h3 className="text-xl font-black text-brand-white">Inizializzazione Arrivo...</h3>
        <p className="text-xs text-slate-400 mt-1">Caricamento controlli e sequenza guidata</p>
      </div>
    );
  }

  // SCHERMATA FINALE DI COMPLETAMENTO
  if (isCompleted) {
    return (
      <div className="flex-1 p-5 flex flex-col justify-between max-w-md mx-auto w-full">
        <div className="text-center pt-8">
          <div className="w-24 h-24 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto mb-6 shadow-2xl shadow-emerald-500/20">
            <CheckCircle2 size={54} className="animate-bounce" />
          </div>
          <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-black uppercase tracking-wider mb-2">
            Controllo Superato
          </span>
          <h2 className="text-2xl font-black text-brand-white tracking-tight">
            Arrivo Merce Confermato!
          </h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed px-4">
            Il mezzo è stato verificato ed è autorizzato allo scarico in magazzino.
          </p>

          <div className="mt-6 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 text-left shadow-xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Codice Arrivo</span>
              <span className="text-xs font-mono font-black text-brand-blue bg-brand-blue/10 px-2 py-0.5 rounded-lg">
                {sessionCode}
              </span>
            </div>
            <div className="flex justify-between items-center py-2.5 border-b border-slate-800 text-xs">
              <span className="text-slate-400 font-semibold">Tipo Mezzo:</span>
              <span className="font-bold text-brand-white">{answers['step_mezzo'] || '-'}</span>
            </div>
            {answers['step_ddt'] && (
              <div className="flex justify-between items-center py-2.5 border-b border-slate-800 text-xs">
                <span className="text-slate-400 font-semibold">Num. DDT:</span>
                <span className="font-bold text-brand-white">{answers['step_ddt']}</span>
              </div>
            )}
            {answers['step_container'] && (
              <div className="flex justify-between items-center py-2.5 border-b border-slate-800 text-xs">
                <span className="text-slate-400 font-semibold">Num. Container:</span>
                <span className="font-bold text-brand-white">{answers['step_container']}</span>
              </div>
            )}
            {answers['step_temp_value'] !== undefined && (
              <div className="flex justify-between items-center pt-2.5 text-xs">
                <span className="text-slate-400 font-semibold">Temp. Mezzo:</span>
                <span className="font-bold text-emerald-400">{answers['step_temp_value']} °C</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          <button
            onClick={() => window.location.reload()}
            className="w-full py-4 rounded-2xl bg-brand-blue text-brand-black font-black text-base shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            <Sparkles size={20} />
            Nuovo Arrivo Merce
          </button>
          <button
            onClick={() => navigate('/zebra')}
            className="w-full py-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 font-bold text-sm active:bg-slate-800 transition-all"
          >
            Torna alla Home Zebra
          </button>
        </div>
      </div>
    );
  }

  // SCHERMATA DI STANDBY QA/GDP
  if (isStandby) {
    return (
      <div className="flex-1 p-5 flex flex-col justify-between max-w-md mx-auto w-full">
        <div>
          <div className="pt-6 text-center">
            <div className="w-20 h-20 rounded-3xl bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center text-amber-400 mx-auto mb-4 animate-pulse shadow-2xl shadow-amber-500/30">
              <ShieldAlert size={44} />
            </div>
            <span className="inline-block px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-[11px] font-black uppercase tracking-wider mb-2">
              ⚠️ Procedura in Standby
            </span>
            <h2 className="text-2xl font-black text-brand-white tracking-tight">
              Contatta l&apos;Ufficio o il QA/GDP
            </h2>
            <p className="text-xs text-amber-200/90 font-medium mt-2 leading-relaxed bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5 text-left">
              {standbyReason}
            </p>
          </div>

          <div className="mt-6 bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-xl text-center">
            <span className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Riferimento Sessione</span>
            <span className="text-lg font-mono font-black text-brand-blue tracking-wider block">
              {sessionCode}
            </span>
            <p className="text-[11px] text-slate-400 mt-2">
              Comunica questo codice al responsabile qualità o all&apos;ufficio per sbloccare la procedura da PC in tempo reale.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-amber-400 bg-amber-500/10 py-2 rounded-xl">
              <Clock size={14} className="animate-spin" /> In ascolto autorizzazione da ufficio...
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          <button
            onClick={() => setShowSupervisorModal(true)}
            className="w-full py-4 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-xl shadow-amber-500/20 active:scale-95 transition-all"
          >
            <KeyRound size={18} />
            Sblocco Supervisore su Zebra (PIN)
          </button>
          <button
            onClick={handleAbortSession}
            className="w-full py-3.5 rounded-2xl bg-slate-900 border border-rose-500/30 text-rose-400 font-bold text-sm flex items-center justify-center gap-2 active:bg-rose-500/10 transition-all"
          >
            <X size={18} />
            Annulla Arrivo e Torna alla Home
          </button>
        </div>

        {/* MODAL SBLOCCO SUPERVISORE SUL DISPOSITIVO */}
        {showSupervisorModal && (
          <div className="fixed inset-0 z-50 bg-brand-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-slate-900 border-2 border-amber-500/40 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2.5 text-amber-400 font-black text-base">
                  <Lock size={20} />
                  <span>Autorizzazione QA / Supervisore</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSupervisorModal(false)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 active:bg-slate-700"
                >
                  <X size={18} />
                </button>
              </div>

              {supervisorError && (
                <div className="mb-4 p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-xs font-semibold">
                  {supervisorError}
                </div>
              )}

              <form onSubmit={handleSupervisorUnlock} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Username Supervisore</label>
                  <input
                    type="text"
                    value={supervisorUsername}
                    onChange={(e) => setSupervisorUsername(e.target.value)}
                    placeholder="Es. Mario / Nicola"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-brand-white focus:border-amber-400 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Password o PIN</label>
                  <input
                    type="password"
                    value={supervisorPassword}
                    onChange={(e) => setSupervisorPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-brand-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Note Sblocco (Opzionale)</label>
                  <input
                    type="text"
                    value={supervisorNotes}
                    onChange={(e) => setSupervisorNotes(e.target.value)}
                    placeholder="Motivo autorizzazione straordinaria"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-brand-white focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="flex gap-2.5 mt-3">
                  <button
                    type="button"
                    onClick={() => setShowSupervisorModal(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-3 rounded-xl bg-amber-500 text-slate-950 font-black text-xs shadow-lg active:scale-95 transition-all"
                  >
                    {isSubmitting ? 'Verifica...' : 'Conferma Sblocco'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // SCHERMATA DI RIFIUTO SCARICO (TEMPERATURA FUORI TOLLERANZA)
  if (isRejected || currentStep?.type === 'REJECT') {
    return (
      <div className="flex-1 p-5 flex flex-col justify-between max-w-md mx-auto w-full">
        <div className="pt-6 text-center">
          <div className="w-24 h-24 rounded-3xl bg-rose-500/20 border-2 border-rose-500/50 flex items-center justify-center text-rose-400 mx-auto mb-4 animate-pulse shadow-2xl shadow-rose-500/30">
            <AlertTriangle size={50} />
          </div>
          <span className="inline-block px-3 py-1 rounded-full bg-rose-500/20 text-rose-400 text-[11px] font-black uppercase tracking-wider mb-2">
            🛑 Non Scaricare Ancora!
          </span>
          <h2 className="text-2xl font-black text-brand-white tracking-tight">
            Discrepanza Temperatura Rilevata
          </h2>
          <div className="mt-4 p-4 rounded-3xl bg-rose-500/10 border border-rose-500/30 text-left">
            <p className="text-sm text-rose-300 font-bold leading-relaxed">
              {rejectionMessage || currentStep?.rejection_message || "Non scaricare ancora, invita l'autista a sostare fuori e fallo tornare quando il camion sarà a temperatura."}
            </p>
          </div>

          <div className="mt-6 bg-slate-900 border border-slate-800 rounded-3xl p-4 text-xs text-slate-400 text-left">
            <span className="font-bold text-slate-300 block mb-1">Cosa fare adesso:</span>
            <ol className="list-decimal list-inside space-y-1">
              <li>Invita l&apos;autista ad accendere il frigo e sostare nel piazzale.</li>
              <li>Attendi il raggiungimento del target di temperatura.</li>
              <li>Riprova la misurazione prima di autorizzare lo scarico.</li>
            </ol>
          </div>
        </div>

        <div className="flex flex-col gap-3 mt-6">
          <button
            onClick={handleRetryTemperature}
            className="w-full py-4 rounded-2xl bg-brand-blue text-brand-black font-black text-sm flex items-center justify-center gap-2 shadow-xl active:scale-95 transition-all"
          >
            <RotateCcw size={18} />
            Riprova Misurazione Temperatura
          </button>
          <button
            onClick={handleAbortSession}
            className="w-full py-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 font-bold text-sm active:bg-slate-800 transition-all"
          >
            Registra Respinto e Torna alla Home
          </button>
        </div>
      </div>
    );
  }

  // RENDER PASSO CORRENTE
  return (
    <div className="flex-1 p-4 flex flex-col justify-between max-w-md mx-auto w-full overflow-y-auto">
      {/* HEADER WIZARD */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
          <button
            onClick={handleGoBack}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 font-bold text-xs active:bg-slate-800"
          >
            <ChevronLeft size={16} />
            Indietro
          </button>
          <div className="text-right min-w-0">
            <span className="text-xs font-black text-brand-blue truncate block max-w-[200px]">
              {form?.title || 'Arrivo Merce'}
            </span>
            <span className="text-[10px] font-mono text-slate-400 tracking-wider block">
              {sessionCode} • Passo {currentStepIndex + 1}/{steps.length}
            </span>
          </div>
        </div>

        {/* TITOLO E DESCRIZIONE PASSO */}
        <div className="mb-6">
          <h2 className="text-2xl font-black text-brand-white tracking-tight leading-tight">
            {currentStep?.title}
          </h2>
          {currentStep?.subtitle && (
            <p className="text-xs text-slate-400 font-semibold mt-1 leading-snug">
              {currentStep.subtitle}
            </p>
          )}
        </div>

        {/* 1. COMPONENTE SCELTA OPZIONI (CHOICE) */}
        {currentStep?.type === 'CHOICE' && (
          <div className="flex flex-col gap-3">
            {(currentStep.options || []).map((opt, idx) => {
              const colorClasses = {
                blue: 'border-slate-800 hover:border-brand-blue text-brand-blue bg-slate-900/90 active:bg-brand-blue/15',
                amber: 'border-slate-800 hover:border-amber-400 text-amber-400 bg-slate-900/90 active:bg-amber-400/15',
                emerald: 'border-slate-800 hover:border-emerald-400 text-emerald-400 bg-slate-900/90 active:bg-emerald-400/15',
                rose: 'border-slate-800 hover:border-rose-400 text-rose-400 bg-slate-900/90 active:bg-rose-400/15',
                cyan: 'border-slate-800 hover:border-cyan-400 text-cyan-400 bg-slate-900/90 active:bg-cyan-400/15',
                slate: 'border-slate-800 hover:border-slate-400 text-slate-300 bg-slate-900/90 active:bg-slate-800'
              }[opt.color || 'blue'];

              return (
                <button
                  key={idx}
                  disabled={isSubmitting}
                  onClick={() => handleChoiceSelect(opt)}
                  className={`w-full p-5 rounded-3xl border-2 font-black text-lg text-left flex items-center justify-between shadow-xl transition-all active:scale-[0.98] ${colorClasses}`}
                >
                  <span className="tracking-wide text-brand-white">{opt.label}</span>
                  <div className="w-10 h-10 rounded-2xl bg-slate-800/80 flex items-center justify-center shrink-0 ml-2">
                    <ArrowRight size={20} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* 2. COMPONENTE CAMPO TESTO (TEXT) */}
        {currentStep?.type === 'TEXT' && (
          <form onSubmit={handleTextSubmit} className="flex flex-col gap-4">
            <div className="relative">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={currentStep.placeholder || 'Inserisci valore...'}
                className="w-full bg-slate-900 border-2 border-slate-700 focus:border-brand-blue rounded-3xl px-5 py-4 text-xl font-bold text-brand-white placeholder-slate-600 focus:outline-none shadow-inner"
                autoFocus
              />
              {textInput && (
                <button
                  type="button"
                  onClick={() => setTextInput('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-slate-800 text-slate-400 active:bg-slate-700"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 p-3 rounded-2xl bg-slate-900/60 border border-slate-800 text-slate-400 text-xs">
              <ScanBarcode size={18} className="text-brand-blue shrink-0" />
              <span>Puoi digitare oppure sparare il codice a barre con la pistola laser.</span>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-3 py-4 rounded-2xl bg-brand-blue text-brand-black font-black text-base shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {isSubmitting ? 'Salvataggio...' : 'Conferma e Avanti'}
              <ArrowRight size={18} />
            </button>
          </form>
        )}

        {/* 3. COMPONENTE MISURA TEMPERATURA (TEMPERATURE) */}
        {currentStep?.type === 'TEMPERATURE' && (
          <div className="flex flex-col gap-4">
            {/* Fascia di riferimento selezionata precedentemente */}
            {answers['step_temp_range'] && (
              <div className="p-3.5 rounded-2xl bg-brand-blue/10 border border-brand-blue/30 flex items-center justify-between text-xs font-bold text-brand-blue">
                <span>Fascia Prescritta:</span>
                <span className="px-2.5 py-0.5 rounded-lg bg-brand-blue text-brand-black font-black">
                  {currentStep.range_definitions?.[answers['step_temp_range']]?.label || answers['step_temp_range']}
                </span>
              </div>
            )}

            <div className="relative">
              <div className="flex items-center bg-slate-900 border-2 border-slate-700 rounded-3xl p-4 shadow-inner">
                <Thermometer size={34} className="text-brand-blue mr-3 shrink-0" />
                <input
                  type="text"
                  inputMode="decimal"
                  value={tempInput}
                  onChange={(e) => setTempInput(e.target.value)}
                  placeholder="Es. 4.5"
                  className="w-full bg-transparent text-3xl font-black text-brand-white focus:outline-none placeholder-slate-600"
                  autoFocus
                />
                <span className="text-xl font-black text-slate-400 ml-2 shrink-0">°C</span>
              </div>
            </div>

            {/* Quick Increment/Decrement Controls */}
            <div className="grid grid-cols-4 gap-2">
              {['+4.0', '+5.0', '+18.0', '+20.0'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTempInput(preset)}
                  className="py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-black text-slate-300 active:bg-slate-800"
                >
                  {preset} °C
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleTempSubmit}
              className="w-full mt-3 py-4 rounded-2xl bg-brand-blue text-brand-black font-black text-base shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {isSubmitting ? 'Verifica Convalida...' : 'Convalida Temperatura'}
              <Check size={18} />
            </button>
          </div>
        )}

        {/* 4. COMPONENTE CHECKLIST MULTI-SELEZIONE (CHECKLIST) */}
        {currentStep?.type === 'CHECKLIST' && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Punti di Ispezione</span>
              <button
                type="button"
                onClick={handleSelectAllChecklist}
                className="text-xs font-black text-emerald-400 hover:underline flex items-center gap-1"
              >
                <Check size={14} /> Seleziona Tutti (Conforme)
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              {(currentStep.items || []).map((item) => {
                const isChecked = Boolean(checklistValues[item.id]);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleChecklistItem(item.id)}
                    className={`w-full p-4 rounded-2xl border-2 text-left flex items-center justify-between transition-all ${
                      isChecked
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-brand-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400'
                    }`}
                  >
                    <span className="text-sm font-bold leading-snug">{item.label}</span>
                    <div
                      className={`w-7 h-7 rounded-xl border flex items-center justify-center shrink-0 ml-3 ${
                        isChecked
                          ? 'bg-emerald-500 border-emerald-500 text-brand-black'
                          : 'border-slate-700 bg-slate-950 text-transparent'
                      }`}
                    >
                      <Check size={16} />
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleChecklistSubmit}
              className="w-full mt-4 py-4 rounded-2xl bg-brand-blue text-brand-black font-black text-base shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              {isSubmitting ? 'Salvataggio...' : 'Conferma Ispezione'}
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* 5. COMPONENTE RIEPILOGO FINALE (SUMMARY) */}
        {currentStep?.type === 'SUMMARY' && (
          <div className="flex flex-col gap-4">
            <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
              <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
                <span className="text-xs text-slate-400 font-semibold">Tipo di Mezzo:</span>
                <span className="text-sm font-black text-brand-blue">{answers['step_mezzo'] || '-'}</span>
              </div>
              {answers['step_ddt'] && (
                <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Documento (DDT):</span>
                  <span className="text-sm font-black text-brand-white">{answers['step_ddt']}</span>
                </div>
              )}
              {answers['step_container'] && (
                <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Container:</span>
                  <span className="text-sm font-black text-brand-white">{answers['step_container']}</span>
                </div>
              )}
              {answers['step_sigillo'] && (
                <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Sigillo:</span>
                  <span className="text-sm font-bold text-brand-white">
                    {answers['step_sigillo'] === 'SI' ? `Sì (${answers['step_sigillo_num'] || 'Verificato'})` : 'Autorizzato da QA'}
                  </span>
                </div>
              )}
              {answers['step_temp_value'] !== undefined && (
                <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
                  <span className="text-xs text-slate-400 font-semibold">Temperatura Misurata:</span>
                  <span className="text-sm font-black text-emerald-400">{answers['step_temp_value']} °C</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-1">
                <span className="text-xs text-slate-400 font-semibold">Operatore Check-in:</span>
                <span className="text-xs font-bold text-slate-300">{user.username || 'Operatore'}</span>
              </div>
            </div>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleFinalConfirm}
              className="w-full mt-2 py-4 rounded-2xl bg-emerald-500 text-slate-950 font-black text-base shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <CheckCircle2 size={20} />
              {isSubmitting ? 'Registrazione...' : 'REGISTRA ARRIVO MERCE'}
            </button>
          </div>
        )}
      </div>

      {/* FOOTER ANNULLA */}
      <div className="pt-4 border-t border-slate-900 mt-4 text-center">
        <button
          type="button"
          onClick={handleAbortSession}
          className="text-xs font-bold text-slate-500 hover:text-rose-400 transition-colors"
        >
          Annulla Procedura e Esci
        </button>
      </div>
    </div>
  );
};

export default ZebraCheckinWizard;
