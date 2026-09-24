import { appAlert, appConfirm, appPrompt } from "../../utils/alerts.js";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Map, RefreshCw, Layers, Search, Trash2, Eye, Info, ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { io } from 'socket.io-client';
import { jwtDecode } from 'jwt-decode';

const Locations = () => {
  const [locations, setLocations] = useState([]);
  const [freeLocations, setFreeLocations] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('mapped'); // 'mapped' or 'free'
  const [bulkMode, setBulkMode] = useState('STANDARD'); // STANDARD, TERRA, CUSTOM
  const [bulkForm, setBulkForm] = useState({
    zone: 'CELLA2',
    rack: 'A',
    cols: 4,       // Lunghezza (quante colonne)
    levels: 3,     // Piani (quanti livelli in altezza)
    custom: '01, 11, 21' // Usato in CUSTOM
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [viewPallet, setViewPallet] = useState(null); // per il modal con i dettagli
  
  const getToken = () => localStorage.getItem('maglite_token');
  const getUserRole = () => {
    try {
      return jwtDecode(getToken()).role;
    } catch {
      return null;
    }
  };
  const role = getUserRole();

  const fetchLocations = async () => {
    try {
      const [resLoc, resFree] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/locations`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/locations/free`, { headers: { Authorization: `Bearer ${getToken()}` } })
      ]);
      setLocations(resLoc.data);
      setFreeLocations(resFree.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLocations();

    const socket = io(`http://${window.location.hostname}:3000`);
    socket.on('stow_updated', () => {
      fetchLocations();
    });

    return () => socket.disconnect();
  }, []);

  const handleBulkGenerate = async (e) => {
    e.preventDefault();
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      let levelsArray = [];
      
      if (bulkMode === 'STANDARD') {
        // Genera 01, 02, 03... 11, 12, 13...
        for (let piano = 0; piano < bulkForm.levels; piano++) {
          for (let colonna = 1; colonna <= bulkForm.cols; colonna++) {
            levelsArray.push(`${piano}${colonna}`);
          }
        }
      } else if (bulkMode === 'TERRA') {
        // Logicamente identico, le cataste sono come scaffali invisibili
        for (let colonna = 1; colonna <= bulkForm.cols; colonna++) {
          for (let piano = 0; piano < bulkForm.levels; piano++) {
            levelsArray.push(`${piano}${colonna}`);
          }
        }
      } else {
        // Custom
        levelsArray = bulkForm.custom.split(',').map(s => s.trim()).filter(s => s);
      }
      
      const res = await axios.post(`http://${window.location.hostname}:3000/api/locations/bulk`, {
        zone: bulkForm.zone,
        rack: bulkForm.rack,
        levels: levelsArray
      }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });

      appAlert(res.data.message);
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore durante la generazione');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id) => {
    if (!await appConfirm("Sicuro di voler eliminare questa postazione?")) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione');
    }
  };

  const handleDeleteZone = async (zoneName) => {
    if (!await appConfirm(`Sicuro di voler eliminare interamente la zona "${zoneName}"? L'operazione non è reversibile.`)) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/zone/${zoneName}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore eliminazione zona');
    }
  };

  const handleAddFreeLocation = async () => {
    const name = await appPrompt("Nome della posizione libera (es. CELLA 2, SCAFFALE ESTERNO):");
    if (!name) return;
    try {
      await axios.post(`http://${window.location.hostname}:3000/api/locations/free`, { name }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert(err.response?.data?.error || 'Errore creazione posizione libera');
    }
  };

  const handleDeleteFreeLocation = async (id) => {
    if (!await appConfirm("Eliminare questa posizione libera?")) return;
    try {
      await axios.delete(`http://${window.location.hostname}:3000/api/locations/free/${id}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      fetchLocations();
    } catch (err) {
      appAlert('Errore eliminazione');
    }
  };

  const [expandedZones, setExpandedZones] = useState({});

  const filteredLocations = locations.filter(l => 
    l.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    l.zone.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groupedLocations = filteredLocations.reduce((acc, loc) => {
    if (!acc[loc.zone]) acc[loc.zone] = [];
    acc[loc.zone].push(loc);
    return acc;
  }, {});

  const toggleZone = (zone) => {
    setExpandedZones(prev => ({
      ...prev,
      [zone]: !prev[zone]
    }));
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-brand-black min-h-screen">
      <div className="max-w-6xl mx-auto animate-fade-in-up">
        
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-brand-white mb-2 flex items-center gap-3">
              <Map className="text-brand-blue" size={32} />
              Mappa Magazzino (Anagrafica Scaffali)
            </h1>
            <p className="text-slate-400">Genera e gestisci le postazioni con i loro Codici PIN di Sicurezza.</p>
          </div>
          <div className="flex gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl">
            <button
              onClick={() => setActiveTab('mapped')}
              className={`px-4 py-2 rounded-lg font-bold transition-colors ${activeTab === 'mapped' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
            >
              Postazioni Mappate
            </button>
            <button
              onClick={() => setActiveTab('free')}
              className={`px-4 py-2 rounded-lg font-bold transition-colors ${activeTab === 'free' ? 'bg-brand-blue text-brand-black' : 'text-slate-400 hover:text-white'}`}
            >
              Posizioni Libere
            </button>
          </div>
        </div>

        {activeTab === 'mapped' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Colonna Sinistra: Generatore Massivo */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl sticky top-8">
              <h2 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
                <Layers className="text-brand-blue" size={24} />
                Generatore Corsie
              </h2>
              <form onSubmit={handleBulkGenerate} className="space-y-5">
                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Modello Stivaggio</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setBulkMode('STANDARD')} className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${bulkMode === 'STANDARD' ? 'bg-brand-blue border-brand-blue text-brand-black' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>Scaffale Std</button>
                    <button type="button" onClick={() => setBulkMode('TERRA')} className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${bulkMode === 'TERRA' ? 'bg-brand-blue border-brand-blue text-brand-black' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>A Terra</button>
                    <button type="button" onClick={() => setBulkMode('CUSTOM')} className={`flex-1 p-2 rounded-xl border text-xs font-bold transition-all ${bulkMode === 'CUSTOM' ? 'bg-brand-blue border-brand-blue text-brand-black' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>Manuale</button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Nome Zona / Stanza</label>
                  <input required value={bulkForm.zone} onChange={e => setBulkForm({...bulkForm, zone: e.target.value.toUpperCase()})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue font-bold uppercase text-center text-xl" placeholder="CELLA2" maxLength={10} />
                </div>

                <div>
                  <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Nome Scaffale / Corsia</label>
                  <input required value={bulkForm.rack} onChange={e => setBulkForm({...bulkForm, rack: e.target.value.toUpperCase()})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue font-bold uppercase text-center text-xl" placeholder="A" maxLength={10} />
                </div>
                
                {bulkMode !== 'CUSTOM' && (
                  <>
                    <div>
                      <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">{bulkMode === 'TERRA' ? 'Numero di Cataste' : 'Lunghezza (Quante colonne?)'}</label>
                      <input required type="number" min="1" max="100" value={bulkForm.cols} onChange={e => setBulkForm({...bulkForm, cols: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center text-xl" />
                    </div>
                    <div>
                      <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">{bulkMode === 'TERRA' ? 'Altezza Massima' : 'Livelli (Quanti ripiani in altezza?)'}</label>
                      <input required type="number" min="1" max="10" value={bulkForm.levels} onChange={e => setBulkForm({...bulkForm, levels: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center text-xl" />
                      <p className="text-xs text-slate-500 mt-2">Creerà posizioni es. 01,02,03 (Piano 0) e 11,12,13 (Piano 1).</p>
                    </div>
                  </>
                )}

                {bulkMode === 'CUSTOM' && (
                  <div>
                    <label className="block text-slate-400 font-bold mb-2 text-xs uppercase tracking-wider">Posizioni libere (separate da virgola)</label>
                    <input required value={bulkForm.custom} onChange={e => setBulkForm({...bulkForm, custom: e.target.value})} className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl p-3 focus:ring-brand-blue text-center font-mono" placeholder="01, 11, 21, 31" />
                  </div>
                )}
                <button type="submit" disabled={isProcessing} className="w-full py-4 mt-4 bg-brand-blue hover:bg-sky-400 text-brand-black rounded-2xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <RefreshCw size={20} className={isProcessing ? "animate-spin" : ""} />
                  Genera Scaffalatura
                </button>
              </form>
            </div>
          </div>

          {/* Colonna Destra: Elenco Scaffali */}
          <div className="lg:col-span-2">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row justify-between items-center bg-slate-950/50 gap-4">
                <span className="font-bold text-slate-300">Scaffali Totali Registrati: {filteredLocations.length}</span>
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input 
                    type="text" 
                    placeholder="Cerca scaffale..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-brand-white rounded-xl pl-10 pr-3 py-2 text-sm focus:ring-brand-blue"
                  />
                </div>
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/80 sticky top-0 backdrop-blur-sm z-10">
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Barcode Scaffale</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs text-center">Zona/Col/Liv</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs text-center">PIN</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs text-right">Azioni</th>
                    </tr>
                  </thead>
                  <tbody className="text-brand-white">
                    {filteredLocations.length === 0 ? (
                      <tr><td colSpan="4" className="p-12 text-center text-slate-500 italic font-medium">Nessuno scaffale trovato.</td></tr>
                    ) : (
                      Object.entries(groupedLocations).sort(([zoneA], [zoneB]) => zoneA.localeCompare(zoneB)).map(([zoneName, zoneLocations]) => {
                        const isExpanded = expandedZones[zoneName] || searchTerm.trim().length > 0;
                        const totalOccupied = zoneLocations.filter(l => l.pallet_code).length;
                        return (
                          <React.Fragment key={zoneName}>
                            {/* Header Riga Zona */}
                            <tr 
                              className="bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors"
                              onClick={() => toggleZone(zoneName)}
                            >
                              <td colSpan="4" className="p-4 border-b border-slate-900">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    {isExpanded ? <ChevronDown size={20} className="text-brand-blue" /> : <ChevronRight size={20} className="text-slate-400" />}
                                    <span className="font-bold text-lg text-brand-white">Zona: {zoneName}</span>
                                    <span className="bg-slate-950 text-slate-400 px-2 py-0.5 rounded text-xs border border-slate-700">
                                      {zoneLocations.length} posizioni
                                    </span>
                                  </div>
                                  <div className="text-sm font-medium text-slate-400 flex items-center gap-4">
                                    <span>{totalOccupied} occupate</span>
                                    <span>{zoneLocations.length - totalOccupied} libere</span>
                                    <button 
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        window.open(`http://${window.location.hostname}:3000/api/locations/zone/${encodeURIComponent(zoneName)}/print?token=${getToken()}`, '_blank');
                                      }} 
                                      className="p-1.5 ml-2 bg-sky-500/10 text-sky-400 hover:bg-sky-500 hover:text-brand-black rounded-lg transition-colors" 
                                      title="Stampa PIN Zona in A4"
                                    >
                                      <Printer size={16} />
                                    </button>
                                    {role === 'developer' && totalOccupied === 0 && (
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); handleDeleteZone(zoneName); }} 
                                        className="p-1.5 ml-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors" 
                                        title="Elimina intera zona"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>

                            {/* Righe delle singole locazioni */}
                            {isExpanded && zoneLocations.map(loc => {
                              const isOccupied = loc.pallet_code ? true : false;
                              return (
                                <tr key={loc.id} className={`border-b border-slate-800/30 transition-colors ${isOccupied ? 'bg-sky-500/5 hover:bg-sky-500/10' : 'bg-green-500/5 hover:bg-green-500/10'}`}>
                                  <td className="px-3 py-3 pl-12 font-mono font-bold text-lg">
                                    {loc.barcode}
                                    {isOccupied && <span className="ml-2 text-[10px] uppercase tracking-wider bg-sky-500 text-brand-black px-2 py-0.5 rounded-full font-black">Occupato</span>}
                                  </td>
                                  <td className="p-4 text-center">
                                    <span className="text-slate-400 text-sm">{loc.col} - {loc.pos}</span>
                                  </td>
                                  <td className="p-4 text-center">
                                    <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 px-3 py-1 rounded-xl text-lg font-black tracking-widest">
                                      {loc.pin}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-right flex items-center justify-end gap-2">
                                    {isOccupied && (
                                      <button onClick={() => setViewPallet(loc)} className="p-2 bg-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-brand-black rounded-lg transition-colors" title="Vedi merce stivata">
                                        <Eye size={18} />
                                      </button>
                                    )}
                                    {role === 'developer' && (
                                      <button onClick={() => handleDelete(loc.id)} className="p-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors" title="Elimina Posizione">
                                        <Trash2 size={18} />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-xl font-bold text-brand-white flex items-center gap-2">
                <Layers className="text-brand-blue" size={24} />
                Elenco Posizioni Libere
              </h2>
              <button 
                onClick={handleAddFreeLocation}
                className="px-4 py-2 bg-brand-blue text-brand-black font-bold rounded-lg hover:bg-sky-400 transition-colors"
              >
                + Aggiungi
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {freeLocations.map(fl => (
                <div key={fl.id} className="bg-slate-800 border border-slate-700 p-4 rounded-xl flex justify-between items-center">
                  <span className="text-brand-white font-bold">{fl.name}</span>
                  <button onClick={() => handleDeleteFreeLocation(fl.id)} className="p-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {freeLocations.length === 0 && (
                <div className="col-span-full p-8 text-center text-slate-500 font-bold border-2 border-dashed border-slate-800 rounded-2xl">
                  Nessuna posizione libera definita.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal Dettaglio Merce */}
      {viewPallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-black/95 backdrop-blur-md animate-fade-in-up">
          <div className="bg-slate-900 border border-sky-500/30 rounded-3xl p-8 max-w-md w-full shadow-[0_0_40px_rgba(14,165,233,0.15)] relative">
            <h3 className="text-xl font-bold text-brand-white mb-6 flex items-center gap-2">
              <Info className="text-sky-400" />
              Contenuto Scaffale
            </h3>
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Codice Paletta</p>
                <p className="font-mono text-xl font-bold text-brand-white">{viewPallet.pallet_code}</p>
              </div>
              
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Prodotto</p>
                <p className="font-bold text-brand-blue text-lg">{viewPallet.product_name}</p>
                {viewPallet.product_notes && (
                  <p className="text-sm text-slate-400 mt-2 italic bg-slate-900/50 p-2 rounded-lg">
                    "{viewPallet.product_notes}"
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Quantità</p>
                  <p className="font-bold text-brand-white text-xl">{viewPallet.quantity}</p>
                </div>
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Lotto</p>
                  <p className="font-bold text-brand-white text-lg">{viewPallet.batch || '-'}</p>
                </div>
              </div>

              {(viewPallet.expiration_date || viewPallet.client_pallet_number || viewPallet.client_article_number) && (
                <div className="grid grid-cols-2 gap-4">
                  {viewPallet.expiration_date && (
                    <div className="bg-rose-500/10 p-4 rounded-2xl border border-rose-500/20 col-span-2">
                      <p className="text-xs text-rose-400/70 uppercase tracking-wider mb-1 font-bold">Scadenza</p>
                      <p className="font-bold text-rose-400 text-lg">{new Date(viewPallet.expiration_date).toLocaleDateString('it-IT')}</p>
                    </div>
                  )}
                  {viewPallet.client_pallet_number && (
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Paletta Cliente</p>
                      <p className="font-bold text-slate-300 text-sm">{viewPallet.client_pallet_number}</p>
                    </div>
                  )}
                  {viewPallet.client_article_number && (
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Articolo Cliente</p>
                      <p className="font-bold text-slate-300 text-sm">{viewPallet.client_article_number}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Cliente</p>
                <p className="font-bold text-slate-300">{viewPallet.customer_name}</p>
              </div>

              {viewPallet.notes && (
                <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                  <p className="text-xs text-amber-500/70 uppercase tracking-wider mb-1 font-bold">Note Paletta</p>
                  <p className="text-amber-400/90 text-sm">{viewPallet.notes}</p>
                </div>
              )}
            </div>
            
            <button onClick={() => setViewPallet(null)} className="w-full mt-6 py-4 bg-slate-800 hover:bg-slate-700 text-brand-white rounded-xl font-bold transition-colors">
              Chiudi
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Locations;






