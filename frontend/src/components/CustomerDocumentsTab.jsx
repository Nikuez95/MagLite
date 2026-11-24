import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import {
  Cloud, Upload, Folder, FolderPlus, FileText, Image as ImageIcon,
  FileArchive, FileSpreadsheet, File, Eye, Download, Trash2, Edit2,
  Check, X, Loader2, Search, AlertTriangle, HardDrive,
  RefreshCw, Sparkles, ExternalLink, FolderInput
} from 'lucide-react';
import { appAlert, appConfirm } from '../utils/alerts.js';

const FOLDER_COLORS = [
  { id: 'sky', label: 'Azzurro', dot: 'bg-sky-400', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { id: 'amber', label: 'Ambra', dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { id: 'emerald', label: 'Verde', dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { id: 'violet', label: 'Viola', dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  { id: 'rose', label: 'Rosa', dot: 'bg-rose-400', badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  { id: 'slate', label: 'Grigio', dot: 'bg-slate-400', badge: 'bg-slate-700/40 text-slate-300 border-slate-600/40' }
];

function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num < 1024) return `${num} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = num / 1024;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[idx]}`;
}

function getFileIcon(mime, name) {
  const m = String(mime || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon size={18} className="text-amber-300" />;
  if (m === 'application/pdf' || n.endsWith('.pdf')) return <FileText size={18} className="text-rose-400" />;
  if (m.includes('zip') || m.includes('rar') || m.includes('7z') || n.endsWith('.zip') || n.endsWith('.rar') || n.endsWith('.7z') || n.endsWith('.tar') || n.endsWith('.gz')) {
    return <FileArchive size={18} className="text-violet-300" />;
  }
  if (m.includes('sheet') || m.includes('excel') || n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv')) {
    return <FileSpreadsheet size={18} className="text-emerald-400" />;
  }
  return <File size={18} className="text-sky-300" />;
}

export default function CustomerDocumentsTab({ customer, canManage = false }) {
  const apiBase = `http://${window.location.hostname}:3000/api/customer-files`;
  const getToken = () => localStorage.getItem('maglite_token');
  const getHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

  const [storageStatus, setStorageStatus] = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(true);

  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [customerStats, setCustomerStats] = useState({ total_files: 0, total_original_bytes: 0, total_compressed_bytes: 0 });
  const [loadingFiles, setLoadingFiles] = useState(true);

  const [selectedFolderKey, setSelectedFolderKey] = useState('ALL'); // 'ALL' | 'ROOT' | folder.id
  const [searchQuery, setSearchQuery] = useState('');

  // Creazione / modifica cartella
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('sky');
  const [savingFolder, setSavingFolder] = useState(false);

  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [editingFolderColor, setEditingFolderColor] = useState('sky');

  // Upload
  const [uploadNotes, setUploadNotes] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  // Anteprima inline (senza scaricare)
  const [previewState, setPreviewState] = useState({
    show: false,
    loading: false,
    file: null,
    blobUrl: null,
    textContent: null,
    error: null
  });
  const [downloadingId, setDownloadingId] = useState(null);

  const fetchStorageStatus = async () => {
    setLoadingStorage(true);
    try {
      const res = await axios.get(`${apiBase}/storage/status`, { headers: getHeaders() });
      setStorageStatus(res.data);
    } catch (err) {
      console.error('Errore stato Cloudflare R2:', err);
    } finally {
      setLoadingStorage(false);
    }
  };

  const fetchCustomerFiles = async () => {
    if (!customer?.id) return;
    setLoadingFiles(true);
    try {
      const res = await axios.get(`${apiBase}/customers/${customer.id}`, { headers: getHeaders() });
      setFolders(res.data?.folders || []);
      setFiles(res.data?.files || []);
      setCustomerStats(res.data?.stats || { total_files: 0, total_original_bytes: 0, total_compressed_bytes: 0 });
    } catch (err) {
      console.error('Errore lettura archivio cliente:', err);
      appAlert(err.response?.data?.error || 'Errore nel caricamento archivio documenti.', 'error');
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchStorageStatus();
  }, []);

  useEffect(() => {
    setSelectedFolderKey('ALL');
    setSearchQuery('');
    setNewFolderMode(false);
    setEditingFolderId(null);
    fetchCustomerFiles();
  }, [customer?.id]);

  // Pulizia Blob URL quando si chiude o cambia anteprima
  useEffect(() => {
    return () => {
      if (previewState.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    };
  }, [previewState.blobUrl]);

  const closePreview = () => {
    if (previewState.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewState({ show: false, loading: false, file: null, blobUrl: null, textContent: null, error: null });
  };

  const rootFilesCount = useMemo(() => files.filter(f => !f.folder_id).length, [files]);

  const visibleFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter(file => {
      if (selectedFolderKey === 'ROOT' && file.folder_id) return false;
      if (selectedFolderKey !== 'ALL' && selectedFolderKey !== 'ROOT' && String(file.folder_id) !== String(selectedFolderKey)) {
        return false;
      }
      if (!q) return true;
      return (
        String(file.original_name || '').toLowerCase().includes(q) ||
        String(file.notes || '').toLowerCase().includes(q) ||
        String(file.folder_name || '').toLowerCase().includes(q) ||
        String(file.uploaded_by || '').toLowerCase().includes(q)
      );
    });
  }, [files, selectedFolderKey, searchQuery]);

  const handleCreatePresetFolders = async () => {
    try {
      await axios.post(
        `${apiBase}/customers/${customer.id}/folders`,
        { preset_defaults: true },
        { headers: getHeaders() }
      );
      await fetchCustomerFiles();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione cartelle predefinite.', 'error');
    }
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setSavingFolder(true);
    try {
      const res = await axios.post(
        `${apiBase}/customers/${customer.id}/folders`,
        { name: newFolderName.trim(), color: newFolderColor },
        { headers: getHeaders() }
      );
      setNewFolderName('');
      setNewFolderMode(false);
      await fetchCustomerFiles();
      const createdId = res.data?.id || res.data?.folder?.id;
      if (createdId) setSelectedFolderKey(createdId);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione cartella.', 'error');
    } finally {
      setSavingFolder(false);
    }
  };

  const handleUpdateFolder = async (folderId) => {
    if (!editingFolderName.trim()) return;
    try {
      await axios.put(
        `${apiBase}/folders/${folderId}`,
        { name: editingFolderName.trim(), color: editingFolderColor },
        { headers: getHeaders() }
      );
      setEditingFolderId(null);
      await fetchCustomerFiles();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore rinomina cartella.', 'error');
    }
  };

  const handleDeleteFolder = async (folder) => {
    const hasFiles = Number(folder.files_count) > 0;
    const confirmed = await appConfirm(
      hasFiles
        ? `La cartella "${folder.name}" contiene ${folder.files_count} file. Eliminando la cartella, i file resteranno in "Senza Cartella" (non verranno persi). Confermi?`
        : `Eliminare definitivamente la cartella vuota "${folder.name}"?`,
      { title: 'Elimina Cartella', confirmText: 'Elimina', isDanger: true }
    );
    if (!confirmed) return;

    try {
      await axios.delete(`${apiBase}/folders/${folder.id}`, { headers: getHeaders() });
      if (String(selectedFolderKey) === String(folder.id)) setSelectedFolderKey('ALL');
      await fetchCustomerFiles();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione cartella.', 'error');
    }
  };

  const handleUploadFiles = async (fileList) => {
    const selected = Array.from(fileList || []);
    if (selected.length === 0) return;

    const formData = new FormData();
    if (selectedFolderKey !== 'ALL' && selectedFolderKey !== 'ROOT') {
      formData.append('folder_id', String(selectedFolderKey));
    }
    if (uploadNotes.trim()) {
      formData.append('notes', uploadNotes.trim());
    }
    selected.forEach(file => {
      formData.append('files', file);
    });

    setIsUploading(true);
    setUploadProgress(0);
    try {
      await axios.post(`${apiBase}/customers/${customer.id}/upload`, formData, {
        headers: {
          ...getHeaders(),
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (evt) => {
          if (evt.total) setUploadProgress(Math.round((evt.loaded * 100) / evt.total));
        }
      });
      setUploadNotes('');
      await Promise.all([fetchCustomerFiles(), fetchStorageStatus()]);
      appAlert(`${selected.length} file compressi e caricati su Cloudflare R2!`, 'success');
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il caricamento su Cloudflare R2.', 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fetchFileBlob = async (file, mode = 'inline') => {
    const res = await axios.get(`${apiBase}/files/${file.id}/content?mode=${mode}`, {
      headers: getHeaders(),
      responseType: 'blob'
    });
    return res.data;
  };

  const handleDownloadFile = async (file) => {
    setDownloadingId(file.id);
    try {
      const blob = await fetchFileBlob(file, 'download');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.original_name || 'documento';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      appAlert('Errore durante decompressione e download del file.', 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpenFile = async (file) => {
    if (!file.is_previewable) {
      await handleDownloadFile(file);
      return;
    }

    if (previewState.blobUrl) URL.revokeObjectURL(previewState.blobUrl);
    setPreviewState({ show: true, loading: true, file, blobUrl: null, textContent: null, error: null });

    try {
      const blob = await fetchFileBlob(file, 'inline');
      const mime = String(file.mime_type || blob.type || '').toLowerCase();
      const lowerName = String(file.original_name || '').toLowerCase();
      const isText =
        mime.startsWith('text/') ||
        mime === 'application/json' ||
        lowerName.endsWith('.txt') ||
        lowerName.endsWith('.csv') ||
        lowerName.endsWith('.log') ||
        lowerName.endsWith('.json');

      const typedBlob = new Blob([blob], { type: file.mime_type || blob.type || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(typedBlob);
      let textContent = null;
      if (isText) {
        textContent = await typedBlob.text();
      }
      setPreviewState({ show: true, loading: false, file, blobUrl, textContent, error: null });
    } catch (err) {
      setPreviewState({
        show: true,
        loading: false,
        file,
        blobUrl: null,
        textContent: null,
        error: 'Impossibile aprire il file in anteprima (potrebbe non essere raggiungibile su R2).'
      });
    }
  };

  const handleMoveFile = async (fileId, targetFolderId) => {
    try {
      await axios.put(
        `${apiBase}/files/${fileId}/move`,
        { folder_id: targetFolderId ? Number(targetFolderId) : null },
        { headers: getHeaders() }
      );
      await fetchCustomerFiles();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore spostamento file.', 'error');
    }
  };

  const handleDeleteFile = async (file) => {
    const confirmed = await appConfirm(
      `Eliminare definitivamente "${file.original_name}" da Cloudflare R2? L'operazione non è reversibile.`,
      { title: 'Elimina File', confirmText: 'Elimina', isDanger: true }
    );
    if (!confirmed) return;

    try {
      await axios.delete(`${apiBase}/files/${file.id}`, { headers: getHeaders() });
      await Promise.all([fetchCustomerFiles(), fetchStorageStatus()]);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione file.', 'error');
    }
  };

  const usedPercent = storageStatus?.quotaBytes > 0
    ? Math.min(100, Math.round(((storageStatus.usedBytesEffective || 0) / storageStatus.quotaBytes) * 1000) / 10)
    : 0;

  const compressionSavedPct = customerStats.total_original_bytes > 0
    ? Math.max(
        0,
        Math.round(
          ((customerStats.total_original_bytes - customerStats.total_compressed_bytes) /
            customerStats.total_original_bytes) *
            100
        )
      )
    : 0;

  return (
    <div className="space-y-6">
      {/* Banner Spazio Cloudflare R2 & Stato Connessione */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
              storageStatus?.r2Enabled
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
            }`}>
              <Cloud size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-black text-white">Archivio Cloud Cloudflare R2 (Compressione GZIP Automatica)</h4>
                {loadingStorage ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">Verifica...</span>
                ) : storageStatus?.r2Enabled ? (
                  <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Connesso • Bucket: {storageStatus.bucket}
                  </span>
                ) : (
                  <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    R2 da attivare su Dashboard ({storageStatus?.r2ErrorCode || 'Non pronto'})
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Spazio occupato su R2: <b className="text-white">{formatBytes(storageStatus?.usedBytesEffective || 0)}</b>
                {' • '}Spazio disponibile: <b className="text-emerald-400">{formatBytes(storageStatus?.remainingBytes ?? 10737418240)}</b>
                {' '}su <b className="text-slate-200">{formatBytes(storageStatus?.quotaBytes ?? 10737418240)}</b> (Free Tier 10 GB/mese)
              </p>
              {storageStatus?.r2ErrorCode === 10042 && (
                <div className="mt-2.5 flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
                  <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Il token Cloudflare in <code className="font-mono text-amber-300">.env</code> è valido, ma Cloudflare richiede di cliccare <b>Enable R2</b> nella{' '}
                    <a
                      href="https://dash.cloudflare.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-bold text-amber-300 hover:text-white"
                    >
                      Dashboard Cloudflare → R2 Object Storage
                    </a>{' '}
                    prima di poter salvare oggetti.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => Promise.all([fetchStorageStatus(), fetchCustomerFiles()])}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
              title="Aggiorna spazio Cloudflare R2"
            >
              <RefreshCw size={13} className={loadingStorage ? 'animate-spin' : ''} /> Aggiorna
            </button>
          </div>
        </div>

        {/* Barra progresso spazio globale R2 */}
        <div className="mt-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
            <span className="flex items-center gap-1.5">
              <HardDrive size={12} className="text-sky-400" />
              Utilizzo Account R2 ({usedPercent}%)
            </span>
            <span>
              Questo cliente: <b className="text-white">{customerStats.total_files}</b> file ({formatBytes(customerStats.total_compressed_bytes)} compressi
              {customerStats.total_original_bytes > 0 ? ` • ${compressionSavedPct}% risparmiato da ${formatBytes(customerStats.total_original_bytes)}` : ''})
            </span>
          </div>
          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-all duration-500"
              style={{ width: `${Math.max(usedPercent, storageStatus?.usedBytesEffective > 0 ? 1 : 0)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Griglia Principale: Cartelle a sinistra + Upload & File a destra */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Colonna Cartelle del Cliente */}
        <div className="lg:col-span-4 bg-slate-950/50 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Folder size={14} className="text-brand-blue" /> Cartelle di {customer?.business_name}
            </h5>
            {canManage && (
              <button
                type="button"
                onClick={() => setNewFolderMode(v => !v)}
                className="px-2.5 py-1.5 bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/30 rounded-lg text-[11px] font-black flex items-center gap-1 transition-all"
              >
                <FolderPlus size={13} /> Nuova
              </button>
            )}
          </div>

          {newFolderMode && canManage && (
            <form onSubmit={handleCreateFolder} className="bg-slate-900 border border-brand-blue/40 rounded-xl p-3 space-y-2.5 animate-fade-in">
              <input
                type="text"
                autoFocus
                required
                placeholder="Nome cartella (es. Archivio DDT)"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-brand-blue outline-none"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {FOLDER_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setNewFolderColor(c.id)}
                      title={c.label}
                      className={`w-4 h-4 rounded-full ${c.dot} ${newFolderColor === c.id ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : 'opacity-60 hover:opacity-100'}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setNewFolderMode(false)}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                  >
                    <X size={14} />
                  </button>
                  <button
                    type="submit"
                    disabled={savingFolder}
                    className="px-2.5 py-1 bg-brand-blue text-brand-black font-black text-[11px] rounded-lg"
                  >
                    {savingFolder ? '...' : 'Crea'}
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setSelectedFolderKey('ALL')}
              className={`w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold flex items-center justify-between transition-all border ${
                selectedFolderKey === 'ALL'
                  ? 'bg-brand-blue text-brand-black border-brand-blue shadow'
                  : 'bg-slate-900/60 hover:bg-slate-900 text-slate-300 border-slate-800'
              }`}
            >
              <span>Tutti i file del cliente</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                selectedFolderKey === 'ALL' ? 'bg-brand-black/20 text-brand-black' : 'bg-slate-800 text-slate-300'
              }`}>
                {files.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedFolderKey('ROOT')}
              className={`w-full px-3 py-2 rounded-xl text-left text-xs font-bold flex items-center justify-between transition-all border ${
                selectedFolderKey === 'ROOT'
                  ? 'bg-slate-700 text-white border-slate-500'
                  : 'bg-slate-900/40 hover:bg-slate-900 text-slate-400 border-slate-800/80'
              }`}
            >
              <span>Senza Cartella</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-800 text-slate-300">
                {rootFilesCount}
              </span>
            </button>

            {folders.map(folder => {
              const colorMeta = FOLDER_COLORS.find(c => c.id === folder.color) || FOLDER_COLORS[0];
              const isSelected = String(selectedFolderKey) === String(folder.id);
              const isEditing = editingFolderId === folder.id;

              if (isEditing) {
                return (
                  <div key={folder.id} className="bg-slate-900 border border-brand-blue/50 rounded-xl p-2.5 space-y-2">
                    <input
                      type="text"
                      value={editingFolderName}
                      onChange={e => setEditingFolderName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none"
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        {FOLDER_COLORS.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setEditingFolderColor(c.id)}
                            className={`w-3.5 h-3.5 rounded-full ${c.dot} ${editingFolderColor === c.id ? 'ring-2 ring-white' : 'opacity-50'}`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setEditingFolderId(null)} className="p-1 text-slate-400 hover:text-white"><X size={13} /></button>
                        <button type="button" onClick={() => handleUpdateFolder(folder.id)} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={13} /></button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={folder.id}
                  className={`group rounded-xl border transition-all flex items-center justify-between pr-2 ${
                    isSelected
                      ? 'bg-slate-800 border-brand-blue/60 text-white'
                      : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFolderKey(folder.id)}
                    className="flex-1 min-w-0 px-3 py-2.5 text-left flex items-center gap-2"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorMeta.dot}`} />
                    <span className="text-xs font-bold truncate">{folder.name}</span>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {canManage && (
                      <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFolderId(folder.id);
                            setEditingFolderName(folder.name);
                            setEditingFolderColor(folder.color || 'sky');
                          }}
                          className="p-1 text-slate-400 hover:text-brand-blue rounded"
                          title="Rinomina cartella"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(folder)}
                          className="p-1 text-slate-400 hover:text-rose-400 rounded"
                          title="Elimina cartella"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-950 text-slate-300 border border-slate-800">
                      {folder.files_count || 0}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {folders.length === 0 && canManage && (
            <button
              type="button"
              onClick={handleCreatePresetFolders}
              className="w-full mt-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 rounded-xl text-[11px] font-bold text-slate-300 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Sparkles size={13} className="text-amber-400" /> Crea cartelle base (Archivio DDT, Foto Palette...)
            </button>
          )}
        </div>

        {/* Colonna Destra: Upload + Ricerca + Tabella File */}
        <div className="lg:col-span-8 space-y-4">
          {canManage && (
            <div
              onDragOver={e => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDragging(false);
                handleUploadFiles(e.dataTransfer.files);
              }}
              className={`rounded-2xl border-2 border-dashed p-5 transition-all ${
                isDragging
                  ? 'border-brand-blue bg-brand-blue/10'
                  : 'border-slate-700 bg-slate-950/40 hover:border-slate-600'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-blue/15 text-brand-blue flex items-center justify-center shrink-0">
                    {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">
                      Trascina qui documenti, PDF, foto o archivi
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Destinazione:{' '}
                      <b className="text-sky-300">
                        {selectedFolderKey === 'ALL' || selectedFolderKey === 'ROOT'
                          ? 'Senza Cartella (Root Cliente)'
                          : folders.find(f => String(f.id) === String(selectedFolderKey))?.name || 'Cartella'}
                      </b>
                      {' • '}I file vengono compressi automaticamente in GZIP prima dell&apos;invio su R2.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={e => handleUploadFiles(e.target.files)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 bg-brand-blue hover:bg-sky-400 text-brand-black font-black text-xs rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Upload size={14} /> {isUploading ? `Caricamento ${uploadProgress}%` : 'Seleziona File'}
                  </button>
                </div>
              </div>

              <div className="mt-3">
                <input
                  type="text"
                  value={uploadNotes}
                  onChange={e => setUploadNotes(e.target.value)}
                  placeholder="Nota opzionale per i file caricati (es. Bolla #123, Foto bancale danneggiato...)"
                  className="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-brand-blue outline-none"
                />
              </div>
            </div>
          )}

          {/* Barra Ricerca File */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cerca file per nome, nota o operatore..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-brand-blue outline-none"
              />
            </div>
            <span className="text-xs text-slate-400 shrink-0">
              <b className="text-white">{visibleFiles.length}</b> file visualizzati
            </span>
          </div>

          {/* Lista File */}
          {loadingFiles ? (
            <div className="py-12 flex items-center justify-center text-slate-400 gap-2 text-xs">
              <Loader2 size={16} className="animate-spin text-brand-blue" /> Caricamento file cliente...
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="bg-slate-950/40 border border-slate-800 rounded-2xl p-10 text-center">
              <Cloud size={34} className="mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-bold text-slate-300">Nessun file presente in questa vista</p>
              <p className="text-xs text-slate-500 mt-1">
                Carica PDF, foto, documenti o archivi usando il box qui sopra.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleFiles.map(file => {
                const orig = Number(file.original_size) || 0;
                const comp = Number(file.compressed_size) || 0;
                const saved = orig > 0 ? Math.max(0, Math.round(((orig - comp) / orig) * 100)) : 0;
                const fColor = FOLDER_COLORS.find(c => c.id === file.folder_color)?.badge || FOLDER_COLORS[0].badge;

                return (
                  <div
                    key={file.id}
                    className="bg-slate-950/60 hover:bg-slate-950 border border-slate-800 rounded-2xl p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                        {getFileIcon(file.mime_type, file.original_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenFile(file)}
                            className="text-sm font-bold text-white hover:text-brand-blue truncate max-w-xs sm:max-w-md text-left transition-colors"
                            title={file.is_previewable ? 'Apri file senza scaricare' : 'Scarica file'}
                          >
                            {file.original_name}
                          </button>
                          {file.folder_name && (
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${fColor}`}>
                              {file.folder_name}
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-900 text-slate-400 border border-slate-800">
                            {formatBytes(orig)} → {formatBytes(comp)} ({saved > 0 ? `-${saved}% GZIP` : 'GZIP'})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span>Caricato da <b className="text-slate-300">{file.uploaded_by || 'Operatore'}</b></span>
                          <span>{file.created_at ? new Date(file.created_at).toLocaleString('it-IT') : ''}</span>
                          {file.notes && <span className="text-sky-300 italic">“{file.notes}”</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {canManage && folders.length > 0 && (
                        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2 py-1" title="Sposta in cartella">
                          <FolderInput size={12} className="text-slate-500 mr-1" />
                          <select
                            value={file.folder_id || ''}
                            onChange={e => handleMoveFile(file.id, e.target.value)}
                            className="bg-transparent text-[11px] font-bold text-slate-300 outline-none max-w-[115px]"
                          >
                            <option value="" className="bg-slate-900">Senza Cartella</option>
                            {folders.map(f => (
                              <option key={f.id} value={f.id} className="bg-slate-900">{f.name}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {file.is_previewable && (
                        <button
                          type="button"
                          onClick={() => handleOpenFile(file)}
                          className="px-3 py-1.5 bg-brand-blue/15 hover:bg-brand-blue text-brand-blue hover:text-brand-black border border-brand-blue/30 rounded-xl text-xs font-bold flex items-center gap-1 transition-all"
                          title="Apri anteprima senza scaricare"
                        >
                          <Eye size={13} /> Apri
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={downloadingId === file.id}
                        onClick={() => handleDownloadFile(file)}
                        className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-brand-black border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1 transition-all disabled:opacity-50"
                        title="Decomprimi e scarica rapidamente"
                      >
                        {downloadingId === file.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        Scarica
                      </button>

                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleDeleteFile(file)}
                          className="p-2 bg-slate-900 hover:bg-rose-500 text-slate-400 hover:text-white border border-slate-800 rounded-xl transition-colors"
                          title="Elimina file da R2"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Anteprima File Decompresso (Senza Scaricare) */}
      {previewState.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-brand-black/95 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-5xl h-[86vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3 bg-slate-950/60">
              <div className="flex items-center gap-2.5 min-w-0">
                {getFileIcon(previewState.file?.mime_type, previewState.file?.original_name)}
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-white truncate">{previewState.file?.original_name}</h4>
                  <p className="text-[11px] text-slate-400">
                    Decompresso da Cloudflare R2 • {formatBytes(previewState.file?.original_size || 0)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewState.blobUrl && (
                  <a
                    href={previewState.blobUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1"
                  >
                    <ExternalLink size={13} /> Nuova Scheda
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleDownloadFile(previewState.file)}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-brand-black rounded-xl text-xs font-black flex items-center gap-1"
                >
                  <Download size={13} /> Scarica
                </button>
                <button
                  type="button"
                  onClick={closePreview}
                  className="p-2 bg-slate-800 hover:bg-rose-500 text-slate-300 hover:text-white rounded-xl transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-950 overflow-auto flex items-center justify-center p-4">
              {previewState.loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 size={18} className="animate-spin text-brand-blue" /> Download e decompressione in corso...
                </div>
              ) : previewState.error ? (
                <div className="text-center max-w-md space-y-3">
                  <AlertTriangle size={34} className="mx-auto text-amber-400" />
                  <p className="text-sm font-bold text-white">{previewState.error}</p>
                </div>
              ) : previewState.textContent !== null ? (
                <pre className="w-full h-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs font-mono text-slate-200 overflow-auto whitespace-pre-wrap">
                  {previewState.textContent}
                </pre>
              ) : String(previewState.file?.mime_type || '').startsWith('image/') ? (
                <img
                  src={previewState.blobUrl}
                  alt={previewState.file?.original_name}
                  className="max-w-full max-h-full object-contain rounded-xl shadow-lg"
                />
              ) : String(previewState.file?.mime_type || '').startsWith('video/') ? (
                <video src={previewState.blobUrl} controls className="max-w-full max-h-full rounded-xl" />
              ) : String(previewState.file?.mime_type || '').startsWith('audio/') ? (
                <audio src={previewState.blobUrl} controls />
              ) : (
                <iframe
                  src={previewState.blobUrl}
                  title={previewState.file?.original_name}
                  className="w-full h-full rounded-xl bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
