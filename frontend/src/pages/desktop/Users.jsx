import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { UserPlus, Shield, User, Trash2, Key } from 'lucide-react';

const UsersManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [message, setMessage] = useState({ text: '', type: '' });

  // Modal states
  const [confirmDelete, setConfirmDelete] = useState({ show: false, user: null });
  const [resetModal, setResetModal] = useState({ show: false, user: null, newPwd: '' });
  const [isProcessing, setIsProcessing] = useState(false);

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/users`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setUsers(res.data.users);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async () => {
    if (!confirmDelete.user || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/users/${confirmDelete.user.id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchUsers();
    } catch (err) {
      if (err.response?.status !== 404) {
        appAlert(err.response?.data?.error || 'Errore durante l\'eliminazione');
      }
    } finally {
      setIsProcessing(false);
      setConfirmDelete({ show: false, user: null });
    }
  };

  const handleResetPassword = async () => {
    if (!resetModal.user || !resetModal.newPwd || isProcessing) return;
    setIsProcessing(true);
    try {
      await axios.put(`http://${window.location.hostname}:3000/api/users/${resetModal.user.id}/reset-password`, 
        { newPassword: resetModal.newPwd },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      appAlert(`Password resettata! Al prossimo accesso dovrà obbligatoriamente cambiarla.`);
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante il reset');
    } finally {
      setIsProcessing(false);
      setResetModal({ show: false, user: null, newPwd: '' });
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setMessage({ text: '', type: '' });
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/users`, 
        { username, password, role },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      setMessage({ text: 'Utente creato con successo!', type: 'success' });
      setUsername('');
      setPassword('');
      setRole('operator');
      fetchUsers(); // ricarica la lista per mostrare il nuovo utente
    } catch (err) {
      setMessage({ text: err.response?.data?.error || 'Errore', type: 'error' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold text-brand-white">Gestione Utenti</h1>
          <p className="text-slate-400 mt-2">Aggiungi nuovi operatori (Zebra) o amministratori (Desktop).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Form Creazione */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl h-fit">
          <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
            <UserPlus className="text-brand-blue" /> Nuovo Utente
          </h2>
          
          {message.text && (
            <div className={`p-4 rounded-xl mb-6 text-sm font-bold flex items-center gap-2 ${message.type === 'error' ? 'bg-rose-950/50 text-rose-300 border border-rose-900/50' : 'bg-emerald-950/50 text-emerald-300 border border-emerald-900/50'}`}>
              {message.type === 'error' ? '⚠️' : '✓'} {message.text}
            </div>
          )}

          <form onSubmit={handleCreateUser} className="space-y-6">
            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Username</label>
              <input 
                type="text" 
                value={username} onChange={e => setUsername(e.target.value)} required
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Password (Iniziale)</label>
              <input 
                type="password" 
                value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue focus:border-brand-blue"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Ruolo</label>
              <select 
                value={role} onChange={e => setRole(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue focus:border-brand-blue"
              >
                <option value="operator">Operatore (Solo App Zebra)</option>
                <option value="backoffice">Backoffice (Gestionale Desktop)</option>
              </select>
            </div>
            
            <button type="submit" className="w-full bg-brand-blue text-brand-black font-bold p-4 rounded-xl hover:bg-sky-400 transition-all shadow-[0_0_15px_rgba(14,165,233,0.3)] hover:shadow-[0_0_25px_rgba(14,165,233,0.5)] active:scale-[0.98] mt-4">
              Crea Account
            </button>
          </form>
        </div>

        {/* Lista Utenti */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl">
          <h2 className="text-xl font-bold text-brand-white mb-6">Utenti Attivi a Sistema</h2>
          
          {loading ? (
            <div className="text-slate-500 animate-pulse font-medium">Caricamento lista...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-sm">
                    <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Username</th>
                    <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Ruolo Autorizzato</th>
                    <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Data Registrazione</th>
                    <th className="pb-4 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="text-brand-white">
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 font-bold text-lg">{u.username}</td>
                      <td className="py-4">
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                          u.role === 'developer' ? 'bg-purple-950/60 text-purple-400 border border-purple-900/50' : 
                          u.role === 'backoffice' ? 'bg-amber-950/60 text-amber-500 border border-amber-900/50' : 
                          'bg-slate-800 text-slate-300'}`}>
                          {u.role === 'developer' ? <Shield size={14}/> : u.role === 'backoffice' ? <Shield size={14}/> : <User size={14}/>}
                          {u.role}
                        </span>
                      </td>
                      <td className="py-4 text-slate-400 text-sm">{new Date(u.created_at).toLocaleDateString('it-IT')}</td>
                      <td className="py-4 text-right flex justify-end gap-4">
                        {u.role !== 'developer' && (
                          <>
                            <button onClick={() => setResetModal({ show: true, user: u, newPwd: '' })} className="text-brand-blue hover:text-sky-300 transition-colors" title="Forza Reset Password">
                              <Key size={20} />
                            </button>
                            <button onClick={() => setConfirmDelete({ show: true, user: u })} className="text-rose-500 hover:text-rose-400 transition-colors" title="Elimina Utente">
                              <Trash2 size={20} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete Modal */}
      {confirmDelete.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl relative">
            <h2 className="text-xl font-bold text-brand-white mb-2">Conferma Eliminazione</h2>
            <p className="text-slate-400 text-sm mb-6">
              Sei sicuro di voler eliminare l'utente <b className="text-rose-400">{confirmDelete.user?.username}</b>? Questa azione è irreversibile.
            </p>
            <div className="flex gap-4">
              <button onClick={() => setConfirmDelete({ show: false, user: null })} className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
              <button onClick={handleDeleteUser} disabled={isProcessing} className="flex-1 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-brand-white rounded-xl font-bold transition-colors disabled:opacity-50">
                {isProcessing ? 'Eliminazione...' : 'Elimina'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl relative">
            <h2 className="text-xl font-bold text-brand-white mb-2">Reset Password</h2>
            <p className="text-slate-400 text-sm mb-6">
              Inserisci la nuova password provvisoria per <b className="text-brand-blue">{resetModal.user?.username}</b>. Al prossimo accesso dovrà cambiarla obbligatoriamente.
            </p>
            <input 
              type="password" 
              value={resetModal.newPwd} onChange={e => setResetModal({ ...resetModal, newPwd: e.target.value })}
              placeholder="Nuova password"
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue mb-6"
            />
            <div className="flex gap-4">
              <button onClick={() => setResetModal({ show: false, user: null, newPwd: '' })} className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">Annulla</button>
              <button onClick={handleResetPassword} disabled={!resetModal.newPwd || isProcessing} className="flex-1 px-4 py-3 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-xl font-bold transition-colors disabled:opacity-50">
                {isProcessing ? 'Attendere...' : 'Applica'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersManagement;






