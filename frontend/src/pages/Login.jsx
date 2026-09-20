import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import axios from 'axios';

const Login = ({ setToken }) => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(`http://${window.location.hostname}:3000/api/auth/login`, {
        username,
        password
      });

      if (response.data.token) {
        setToken(response.data.token);
        localStorage.setItem('maglite_user', JSON.stringify(response.data.user));
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-black flex flex-col items-center justify-center p-6 text-brand-white">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-10 shadow-2xl">
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 bg-brand-blue rounded-2xl flex items-center justify-center text-brand-black font-bold text-4xl shadow-[0_0_30px_rgba(14,165,233,0.4)]">
            M
          </div>
        </div>
        
        <h2 className="text-3xl font-bold text-center mb-2">Benvenuto</h2>
        <p className="text-slate-400 text-center mb-8 font-medium">Inserisci le credenziali per accedere al gestionale MagLite.</p>

        {error && (
          <div className="bg-rose-950/50 border border-rose-900/50 text-rose-300 p-4 rounded-xl mb-6 text-sm font-medium text-center flex items-center justify-center gap-2">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-slate-400 font-bold mb-2 text-sm uppercase tracking-wider">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all"
              placeholder="Inserisci il tuo username"
              required
            />
          </div>
          <div>
            <label className="block text-slate-400 font-bold mb-2 text-sm uppercase tracking-wider">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-4 focus:ring-brand-blue focus:border-brand-blue transition-all"
              placeholder="Inserisci la tua password"
              required
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-brand-blue text-brand-black font-bold text-lg p-4 rounded-xl hover:bg-sky-400 hover:shadow-[0_0_20px_rgba(14,165,233,0.3)] transition-all flex items-center justify-center gap-3 active:scale-[0.98] mt-4 disabled:opacity-70 disabled:hover:scale-100 disabled:shadow-none"
          >
            {loading ? 'Accesso in corso...' : (
              <>
                <LogIn size={22} />
                Accedi al Sistema
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
