import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Search, SlidersHorizontal, Filter, Download, Printer, GripVertical } from 'lucide-react';
import Select from 'react-select';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const defaultColumns = [
  { key: 'code', label: 'Cod. Paletta', visible: true },
  { key: 'customer', label: 'Cliente', visible: true },
  { key: 'product', label: 'Prodotto', visible: true },
  { key: 'quantity', label: 'Q.tà', visible: true },
  { key: 'location', label: 'Posizione', visible: true },
  { key: 'arrival', label: 'Arrivo', visible: true },
  { key: 'batch', label: 'Lotto', visible: true },
  { key: 'status', label: 'Stato', visible: false },
  { key: 'notes', label: 'Note', visible: false },
  { key: 'clientPallet', label: 'Rif. Paletta Cl.', visible: false }
];

const Inventory = () => {
  const [pallets, setPallets] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters and sorting state
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [sortBy, setSortBy] = useState('alphabetical'); // 'alphabetical', 'zone', 'arrival'

  const user = JSON.parse(localStorage.getItem('maglite_user') || '{}');
  const [columns, setColumns] = useState(() => {
    if (user.preferences && user.preferences.inventoryColumns) {
      return user.preferences.inventoryColumns;
    }
    return defaultColumns;
  });

  const [draggedColumnIndex, setDraggedColumnIndex] = useState(null);

  const getToken = () => localStorage.getItem('maglite_token');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [invRes, custRes] = await Promise.all([
        axios.get(`http://${window.location.hostname}:3000/api/pallets/inventory`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        axios.get(`http://${window.location.hostname}:3000/api/customers`, { headers: { Authorization: `Bearer ${getToken()}` } })
      ]);
      setPallets(invRes.data);
      setCustomers(custRes.data.map(c => ({ value: c.id, label: c.business_name })));
    } catch (err) {
      console.error("Errore fetch inventario:", err);
    } finally {
      setLoading(false);
    }
  };

  const savePreferences = async (newColumns) => {
    try {
      const updatedUser = { ...user, preferences: { ...(user.preferences || {}), inventoryColumns: newColumns } };
      localStorage.setItem('maglite_user', JSON.stringify(updatedUser));
      await axios.put(`http://${window.location.hostname}:3000/api/auth/preferences`, { preferences: updatedUser.preferences }, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
    } catch(err) {
      console.error("Errore salvataggio preferenze:", err);
    }
  };

  const selectStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: '#101c25',
      borderColor: state.isFocused ? '#a9daff' : '#233746',
      borderRadius: '0.75rem',
      padding: '0.25rem',
      boxShadow: 'none',
      '&:hover': { borderColor: '#a9daff' }
    }),
    menu: base => ({ ...base, backgroundColor: '#101c25', zIndex: 50, border: '1px solid #233746' }),
    option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? '#192935' : 'transparent', color: '#F8FAFC', cursor: 'pointer' }),
    multiValue: base => ({ ...base, backgroundColor: '#192935', borderRadius: '0.5rem' }),
    multiValueLabel: base => ({ ...base, color: '#a9daff', fontWeight: 'bold' }),
    multiValueRemove: base => ({ ...base, color: '#a9daff', ':hover': { backgroundColor: '#a9daff', color: '#101c25' } }),
    input: base => ({ ...base, color: '#F8FAFC' }),
  };

  const toggleColumn = (key) => {
    const newCols = columns.map(c => c.key === key ? { ...c, visible: !c.visible } : c);
    setColumns(newCols);
    savePreferences(newCols);
  };

  const handleDragStart = (index) => {
    setDraggedColumnIndex(index);
  };

  const handleDrop = (index) => {
    if (draggedColumnIndex === null || draggedColumnIndex === index) return;
    const newCols = [...columns];
    const draggedItem = newCols[draggedColumnIndex];
    newCols.splice(draggedColumnIndex, 1);
    newCols.splice(index, 0, draggedItem);
    setColumns(newCols);
    savePreferences(newCols);
    setDraggedColumnIndex(null);
  };

  const [groupByBatch, setGroupByBatch] = useState(false);

  const processedData = useMemo(() => {
    let data = pallets;
    if (selectedCustomers.length > 0) {
      const customerIds = selectedCustomers.map(c => c.value);
      data = data.filter(p => customerIds.includes(p.customer_id));
    }

    if (groupByBatch) {
      const groups = {};
      data.forEach(p => {
        const key = `${p.product_id}_${p.batch || 'NOBATCH'}`;
        if (!groups[key]) {
          groups[key] = {
            ...p,
            id: key,
            quantity: parseFloat(p.quantity) || 0,
            palletCount: 1,
            location: '', 
            zone: '',
            col: '',
            pos: '',
            pallet_code: 'MULTIPLI'
          };
        } else {
          groups[key].quantity += (parseFloat(p.quantity) || 0);
          groups[key].palletCount += 1;
        }
      });
      data = Object.values(groups).map(g => {
        g.pallet_code = `${g.palletCount} Palette`;
        return g;
      });
    }

    data = [...data].sort((a, b) => {
      if (sortBy === 'alphabetical') {
        return a.product_name.localeCompare(b.product_name);
      }
      if (sortBy === 'zone') {
        const zoneA = a.zone || 'ZZZ';
        const zoneB = b.zone || 'ZZZ';
        if (zoneA !== zoneB) return zoneA.localeCompare(zoneB);
        const colA = a.col || '00';
        const colB = b.col || '00';
        if (colA !== colB) return colA.localeCompare(colB);
        const posA = a.pos || '00';
        const posB = b.pos || '00';
        return posA.localeCompare(posB);
      }
      if (sortBy === 'arrival') {
        return new Date(a.created_at) - new Date(b.created_at);
      }
      return 0;
    });
    return data;
  }, [pallets, selectedCustomers, sortBy, groupByBatch]);

  const getCellValue = (row, key) => {
    switch (key) {
      case 'code': return row.pallet_code;
      case 'customer': return row.customer_name;
      case 'product': return row.product_name;
      case 'quantity': return `${row.quantity} ${row.uom}`;
      case 'location': return groupByBatch ? '-' : (row.location ? `${row.zone} ${row.col} ${row.pos}` : 'IN ATTESA');
      case 'arrival': return new Date(row.created_at).toLocaleDateString('it-IT');
      case 'batch': return row.batch || '-';
      case 'status': return row.status;
      case 'notes': return groupByBatch ? '-' : (row.notes || '-');
      case 'clientPallet': return groupByBatch ? '-' : (row.client_pallet_number || '-');
      default: return '';
    }
  };

  const renderCellHtml = (row, key) => {
    switch (key) {
      case 'code': return (
        <div className="flex flex-col gap-1 items-start">
          <span className="font-mono text-sm text-brand-blue font-bold whitespace-nowrap">{row.pallet_code}</span>
          {row.is_mixed === 1 && !groupByBatch && (
            <span className="bg-amber-500/20 text-amber-500 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Paletta Frammentata">Mista</span>
          )}
        </div>
      );
      case 'customer': return <span className="text-sm font-semibold text-slate-300">{row.customer_name}</span>;
      case 'product': return <span className="font-bold text-brand-white">{row.product_name}</span>;
      case 'quantity': {
        const qty = parseFloat(row.quantity) || 0;
        const upb = parseInt(row.units_per_box) || 1;
        const uom = row.uom;
        
        if (upb > 1 && uom !== 'Scatole' && uom !== 'Bancali' && uom !== 'Bancale' && uom !== 'KG' && uom !== 'Metro Cubo') {
          const scatole = Math.floor(qty / upb);
          const sfusi = qty % upb;
          return (
            <div className="flex flex-col items-end">
              <div className="text-right">
                <span className="font-black text-brand-blue text-lg">{qty}</span>
                <span className="text-[10px] text-slate-500 ml-1 uppercase">({uom || 'Pezzi'})</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">
                {scatole} Scat. {sfusi > 0 ? ` + ${sfusi} Sfusi` : ''}
              </span>
            </div>
          );
        }

        return (
          <div className="text-right">
            <span className="font-black text-brand-blue text-lg">{qty}</span>
            <span className="text-xs text-slate-500 ml-1 uppercase">{uom}</span>
          </div>
        );
      }
      case 'location': return (
        <div className="text-center">
          {groupByBatch ? (
            <span className="text-slate-500 font-bold">-</span>
          ) : row.location ? (
            <span className="inline-flex items-center gap-1 bg-slate-950 border border-slate-700 px-3 py-1 rounded-lg text-sm font-bold text-brand-white">
              {row.zone} {row.col} {row.pos}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-500 px-3 py-1 rounded-lg text-xs font-bold border border-amber-500/20">IN ATTESA</span>
          )}
        </div>
      );
      case 'arrival': return <span className="text-sm text-slate-400">{new Date(row.created_at).toLocaleDateString('it-IT')}</span>;
      case 'batch': return <span className="text-sm text-slate-300">{row.batch || '-'}</span>;
      case 'status': return (
        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-md ${row.status === 'STOCKED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
          {row.status}
        </span>
      );
      case 'notes': return groupByBatch ? <span className="text-slate-500">-</span> : <div className="text-xs text-slate-400 max-w-xs truncate" title={row.notes}>{row.notes || '-'}</div>;
      case 'clientPallet': return groupByBatch ? <span className="text-slate-500">-</span> : <span className="text-xs text-slate-400">{row.client_pallet_number || '-'}</span>;
      default: return null;
    }
  };

  const exportCSV = () => {
    const visibleCols = columns.filter(c => c.visible);
    const headers = visibleCols.map(c => c.label);
    const csvRows = [headers.join(',')];
    
    for (const row of processedData) {
      const values = visibleCols.map(col => {
        let val = getCellValue(row, col.key);
        return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
      });
      csvRows.push(values.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Inventario_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const exportPDF = async () => {
    const doc = new jsPDF('landscape');
    const visibleCols = columns.filter(c => c.visible);
    const headers = visibleCols.map(c => c.label);
    const data = processedData.map(row => visibleCols.map(col => getCellValue(row, col.key)));

    let title = 'Inventario Globale | Logistic Porcelli';
    if (selectedCustomers.length === 1) {
      title = `Inventario per ${selectedCustomers[0].label.toUpperCase()} | Logistic Porcelli`;
    } else if (selectedCustomers.length > 1) {
      title = 'Inventario per Multi-Cliente | Logistic Porcelli';
    }

    let filterText = 'Ord: ';
    if (sortBy === 'alphabetical') filterText += 'Alfabetico';
    if (sortBy === 'zone') filterText += 'Zone';
    if (sortBy === 'arrival') filterText += 'Data Arrivo';
    if (selectedCustomers.length > 0) {
      filterText += ` | Clienti: ${selectedCustomers.map(c => c.label).join(', ')}`;
    }

    const renderRest = (textX) => {
      doc.setFontSize(16);
      doc.text(title, textX, 18);
      
      doc.setFontSize(10);
      doc.text(`Data: ${new Date().toLocaleDateString('it-IT')} | Elementi totali: ${processedData.length}`, textX, 26);
      doc.text(filterText, textX, 32);

      autoTable(doc, {
        startY: 38,
        head: [headers],
        body: data,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [25, 41, 53], textColor: 255 },
        alternateRowStyles: { fillColor: [240, 248, 255] }
      });

      doc.save(`Inventario_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    try {
      const response = await fetch('/logo.png');
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result;
        // The logo width is roughly 2x height
        doc.addImage(base64data, 'PNG', 14, 10, 40, 24);
        renderRest(60);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error("Errore caricamento logo per PDF:", e);
      renderRest(14);
    }
  };

  if (loading) {
    return <div className="p-8 text-brand-blue font-bold animate-pulse">Caricamento inventario...</div>;
  }

  const visibleCols = columns.filter(c => c.visible);

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-3xl font-extrabold text-brand-white tracking-tight">Inventario Globale</h2>
          <p className="text-slate-400 mt-1">Esplora, filtra e personalizza la vista delle tue scorte ({processedData.length} palette trovate).</p>
        </div>
        <div className="flex gap-3">
          <button onClick={exportCSV} className="flex items-center gap-2 px-5 py-3 bg-slate-900 border border-slate-700 text-brand-white rounded-xl hover:bg-slate-800 transition-colors shadow-lg font-bold">
            <Download size={20} className="text-brand-blue" /> CSV
          </button>
          <button onClick={exportPDF} className="flex items-center gap-2 px-5 py-3 bg-brand-blue text-brand-black rounded-xl hover:bg-brand-blue-dark transition-colors shadow-lg font-bold">
            <Printer size={20} /> Stampa PDF
          </button>
        </div>
      </div>

      {/* Pannello Controlli */}
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 mb-8 shadow-xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-6 border-b border-slate-800 pb-6">
          <div>
            <label className="flex items-center gap-2 text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              <Filter size={16} /> Filtra per Clienti
            </label>
            <Select 
              isMulti
              styles={selectStyles}
              options={customers}
              value={selectedCustomers}
              onChange={setSelectedCustomers}
              placeholder="Tutti i clienti (seleziona per filtrare)..."
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              <SlidersHorizontal size={16} /> Ordina Per
            </label>
            <select 
              value={sortBy} 
              onChange={e => setSortBy(e.target.value)} 
              className="w-full bg-[#101c25] border border-[#233746] text-brand-white rounded-xl p-3 focus:ring-brand-blue"
            >
              <option value="alphabetical">Ordine Alfabetico (Prodotto)</option>
              <option value="zone">Ordine per Zone (Magazzino)</option>
              <option value="arrival">Ordine di Arrivo (Data)</option>
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-slate-400 font-bold mb-3 text-xs uppercase tracking-wider">
              Vista Inventario
            </label>
            <div className="flex items-center gap-3 h-[42px]">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={groupByBatch} onChange={() => setGroupByBatch(!groupByBatch)} />
                <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-brand-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-blue"></div>
                <span className="ml-3 text-sm font-bold text-brand-white">
                  {groupByBatch ? 'Totali per Lotto' : 'Spaccato per Posizioni'}
                </span>
              </label>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-slate-400 font-bold mb-4 text-xs uppercase tracking-wider">Trascina per Riordinare le Colonne</label>
          <div className="flex flex-wrap gap-3">
            {columns.map((col, idx) => (
              <div 
                key={col.key}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(idx)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-colors border cursor-grab active:cursor-grabbing ${col.visible ? 'bg-brand-blue/20 text-brand-blue border-brand-blue' : 'bg-[#101c25] text-slate-500 border-[#233746] hover:bg-slate-800'}`}
              >
                <GripVertical size={14} className={col.visible ? 'text-brand-blue/50' : 'text-slate-600'} />
                <button onClick={() => toggleColumn(col.key)} className="focus:outline-none">
                  {col.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabella Dati */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800">
                {visibleCols.map(col => (
                  <th key={col.key} className={`p-4 text-xs font-bold text-slate-400 uppercase tracking-wider ${col.key === 'quantity' ? 'text-right' : col.key === 'location' ? 'text-center' : ''}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {processedData.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length} className="p-8 text-center text-slate-500 font-medium">Nessuna paletta trovata.</td>
                </tr>
              ) : (
                processedData.map((row, i) => (
                  <tr key={row.id} className={`border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors ${i % 2 === 0 ? 'bg-transparent' : 'bg-[#101c25]/30'}`}>
                    {visibleCols.map(col => (
                      <td key={col.key} className="p-4">
                        {renderCellHtml(row, col.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Inventory;
