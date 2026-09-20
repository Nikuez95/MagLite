import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Activity, Package, Database, Smartphone, Monitor, CheckCircle, XCircle, Loader2, User } from 'lucide-react';

const Dashboard = () => {
  const [stats, setStats] = useState({
    total_locations: 0,
    occupied_locations: 0,
    saturation_percentage: 0,
    recent_logs: []
  });
  const [socketStatus, setSocketStatus] = useState('CONNECTING'); // CONNECTING, CONNECTED, DISCONNECTED
  
  const [historyModal, setHistoryModal] = useState(null); // pallet_code
  const [historyData, setHistoryData] = useState(null); // { pallet, history }

  const getToken = () => localStorage.getItem('maglite_token');

  const fetchStats = async () => {
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setStats(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchStats();
    
    // Connessione WebSocket
    const socket = io(`http://${window.location.hostname}:3000`);
    
    socket.on('connect', () => setSocketStatus('CONNECTED'));
    socket.on('disconnect', () => setSocketStatus('DISCONNECTED'));
    socket.on('connect_error', () => setSocketStatus('DISCONNECTED'));

    socket.on('dashboard_update', () => {
      fetchStats();
    });

    return () => socket.disconnect();
  }, []);

  const openHistory = async (code) => {
    setHistoryModal(code);
    setHistoryData(null);
    try {
      const res = await axios.get(`http://${window.location.hostname}:3000/api/pallets/${code}/history`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      setHistoryData(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-7xl mx-auto animate-fade-in-up">
        
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
            <Activity className="text-brand-blue" size={32} />
            Control Center
          </h1>
          <p className="text-slate-400">Monitoraggio del magazzino e Live Log delle operazioni.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Card Saturazione */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col justify-between">
            <div>
              <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
                <Database className="text-brand-blue" /> Saturazione Magazzino
              </h2>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-6xl font-black text-brand-white">{stats.saturation_percentage}%</span>
                <span className="text-slate-500 mb-2 font-bold">Occupato</span>
              </div>
              <p className="text-slate-400 text-sm">
                Hai {stats.occupied_locations} postazioni occupate su {stats.total_locations} totali registrate a sistema.
              </p>
            </div>
            
            <div className="mt-8 h-4 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div 
                className="h-full bg-gradient-to-r from-brand-blue to-sky-300 rounded-full transition-all duration-1000 ease-out" 
                style={{ width: `${stats.saturation_percentage}%` }}
              ></div>
            </div>
          </div>

          {/* Placeholder Cards per bilanciare il layout */}
          <div className="bg-brand-blue/10 border border-brand-blue/30 rounded-3xl p-8 shadow-xl flex flex-col justify-center items-center text-center">
            <Package size={48} className="text-brand-blue mb-4" />
            <h3 className="text-2xl font-bold text-brand-white mb-2">Operatività</h3>
            <p className="text-brand-blue/80">Sistema di stivaggio Zebra e validazione PIN attivi e in funzione.</p>
          </div>
          
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl flex flex-col justify-center items-center text-center">
             
             {socketStatus === 'CONNECTING' && (
               <>
                 <Loader2 size={64} className="text-amber-500 animate-spin mb-4" />
                 <h3 className="text-xl font-bold text-brand-white mb-1">Connessione in corso...</h3>
                 <p className="text-amber-500 text-sm font-bold">Inizializzazione WebSockets</p>
               </>
             )}

             {socketStatus === 'CONNECTED' && (
               <>
                 <CheckCircle size={64} className="text-green-500 mb-4 drop-shadow-[0_0_15px_rgba(34,197,94,0.4)]" />
                 <h3 className="text-xl font-bold text-brand-white mb-1">Connessione Real-Time</h3>
                 <p className="text-green-400 text-sm font-bold">WebSockets Collegati</p>
               </>
             )}

             {socketStatus === 'DISCONNECTED' && (
               <>
                 <XCircle size={64} className="text-rose-500 mb-4 drop-shadow-[0_0_15px_rgba(244,63,94,0.4)]" />
                 <h3 className="text-xl font-bold text-brand-white mb-1">Disconnesso</h3>
                 <p className="text-rose-400 text-sm font-bold">Aggiornamenti in tempo reale sospesi</p>
               </>
             )}
             
          </div>

        </div>

        {/* Live Log */}
        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl">
          <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
            <Activity className="text-rose-500" /> Live Audit Log
          </h2>
          <div className="max-h-[400px] overflow-y-auto pr-4 space-y-3">
            {stats.recent_logs.length === 0 ? (
              <div className="text-center p-8 text-slate-500 italic">Nessuna operazione registrata.</div>
            ) : stats.recent_logs.map(log => (
              <div key={log.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between animate-fade-in-up">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-800 text-slate-300">
                      {log.action}
                    </span>
                    <span className="text-slate-500 text-xs">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-brand-white font-medium">
                    {log.product_name && log.pallet_code ? (
                      log.details.split(new RegExp(`(paletta ${log.pallet_code})`, 'i')).map((part, idx) => {
                        if (part.toLowerCase() === `paletta ${log.pallet_code.toLowerCase()}`) {
                          return (
                            <button key={idx} onClick={() => openHistory(log.pallet_code)} className="text-brand-blue font-bold hover:text-sky-300 transition-colors underline underline-offset-4 decoration-brand-blue/30" title={`Apri storico ${log.pallet_code}`}>
                              {log.product_name}
                            </button>
                          );
                        }
                        return <span key={idx}>{part}</span>;
                      })
                    ) : (
                      log.details
                    )}
                  </p>
                  <div className="flex items-center gap-1 mt-2 text-slate-400 text-xs font-bold uppercase tracking-wider">
                    <User size={14} className="text-brand-blue" /> Utente: <span className="text-brand-white">{log.username}</span>
                  </div>
                </div>
                <div>
                  {log.source === 'Zebra' ? (
                    <div className="flex items-center gap-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 px-3 py-1 rounded-lg">
                      <Smartphone size={16} />
                      <span className="text-xs font-bold uppercase tracking-widest">Zebra</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-brand-blue/10 text-brand-blue border border-brand-blue/30 px-3 py-1 rounded-lg">
                      <Monitor size={16} />
                      <span className="text-xs font-bold uppercase tracking-widest">PC / Gestionale</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
      
      {/* Modal Storico Paletta */}
      {historyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/90 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-lg w-full shadow-2xl relative animate-fade-in-up">
            <button 
              onClick={() => setHistoryModal(null)}
              className="absolute top-6 right-6 text-slate-500 hover:text-brand-white transition-colors"
            >
              <XCircle size={24} />
            </button>
            <h2 className="text-2xl font-bold text-brand-white mb-2">Storia Paletta</h2>
            {historyData ? (
              <>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6 mt-4 shadow-inner">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-mono text-brand-blue font-bold text-lg">{historyData.pallet.pallet_code}</p>
                      <p className="text-brand-white font-bold">{historyData.pallet.product_name}</p>
                    </div>
                    <span className="bg-slate-800 text-brand-white px-3 py-1 rounded-lg text-sm font-bold border border-slate-700">
                      Q.tà: {historyData.pallet.quantity}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm">Lotto: <span className="text-slate-300 font-bold">{historyData.pallet.batch || '-'}</span> | Cliente: <span className="text-slate-300 font-bold">{historyData.pallet.customer_name}</span></p>
                </div>
                
                <h3 className="text-slate-400 font-bold uppercase tracking-wider text-xs mb-4">Cronologia Eventi</h3>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-700 before:to-transparent">
                  {historyData.history.map((h, i) => (
                    <div key={h.id} className="relative flex items-center justify-between group">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-slate-900 bg-brand-blue text-brand-black shadow shrink-0 z-10 relative">
                        {i === 0 ? <CheckCircle size={16} /> : <Activity size={16} />}
                      </div>
                      <div className="w-[calc(100%-4rem)] p-4 rounded-xl border border-slate-800 bg-slate-950 shadow z-10 relative">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-bold text-xs uppercase tracking-wider text-slate-400">{h.action}</span>
                          <time className="font-mono text-brand-blue text-xs">{new Date(h.created_at).toLocaleString()}</time>
                        </div>
                        <div className="text-brand-white text-sm font-medium mb-3">{h.details}</div>
                        <div className="flex gap-2">
                          <div className="text-slate-500 text-xs flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800"><User size={12}/> {h.username}</div>
                          <div className="text-slate-500 text-xs flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800"><Monitor size={12}/> {h.source}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex justify-center p-12">
                <Loader2 size={48} className="text-brand-blue animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
