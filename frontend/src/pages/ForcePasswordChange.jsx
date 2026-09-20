import React, { useState } from 'react';
import axios from 'axios';
import { ShieldAlert } from 'lucide-react';

const ForcePasswordChange = ({ setToken, onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      return setError('Le password non coincidono');
    }
    if (password.length < 6) {
      return setError('La password deve essere di almeno 6 caratteri');
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('maglite_token');
      const res = await axios.post(`http://${window.location.hostname}:3000/api/auth/change-password`, 
        { newPassword: password },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Aggiorna il token con quello nuovo (senza flag requires_password_change)
      setToken(res.data.token);
      
      // Aggiorna il localStorage utente
      const user = JSON.parse(localStorage.getItem('maglite_user'));
      user.requires_password_change = false;
      localStorage.setItem('maglite_user', JSON.stringify(user));
      
      onComplete();
    } catch (err) {
      setError(err.response?.data?.error || 'Errore di connessione');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-brand-black/95 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10 max-w-md w-full shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-blue/10 blur-3xl rounded-full"></div>
        
        <div className="flex justify-center mb-6">
          <ShieldAlert size={60} className="text-brand-blue" />
        </div>
        
        <h2 className="text-2xl font-bold text-center text-brand-white mb-2">Aggiornamento Sicurezza</h2>
        <p className="text-slate-400 text-center mb-8 text-sm leading-relaxed">
          Essendo il tuo primo accesso, oppure a seguito di un reset amministrativo, <b>sei obbligato a impostare una nuova password personale.</b>
        </p>

        {error && <div className="bg-rose-950/50 text-rose-300 p-3 rounded-lg mb-6 text-sm text-center border border-rose-900/50 font-medium">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Nuova Password</label>
            <input 
              type="password" 
              value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue focus:border-brand-blue"
            />
          </div>
          <div>
            <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Conferma Password</label>
            <input 
              type="password" 
              value={confirm} onChange={e => setConfirm(e.target.value)} required
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue focus:border-brand-blue"
            />
          </div>
          
          <button type="submit" disabled={loading} className="w-full bg-brand-blue text-brand-black font-bold p-4 rounded-xl hover:bg-sky-400 hover:shadow-[0_0_20px_rgba(14,165,233,0.3)] transition-all mt-4 active:scale-95 disabled:opacity-50">
            {loading ? 'Salvataggio in corso...' : 'Imposta e Entra nel Gestionale'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForcePasswordChange;
