import { useState, useEffect } from 'react';

const STORAGE_KEY = 'maglite_zebra_workspace';
const EVENT_NAME = 'maglite_zebra_workspace_changed';

export function getZebraWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.warehouseId) return null;
    return {
      warehouseId: Number(parsed.warehouseId),
      warehouseName: String(parsed.warehouseName || 'Settala'),
      divisionId: parsed.divisionId ? Number(parsed.divisionId) : null,
      divisionName: parsed.divisionName ? String(parsed.divisionName) : null
    };
  } catch {
    return null;
  }
}

export function saveZebraWorkspace(ws) {
  if (!ws || !ws.warehouseId) return;
  const normalized = {
    warehouseId: Number(ws.warehouseId),
    warehouseName: String(ws.warehouseName || 'Settala'),
    divisionId: ws.divisionId ? Number(ws.divisionId) : null,
    divisionName: ws.divisionName ? String(ws.divisionName) : null
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function clearZebraWorkspace() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function useZebraWorkspace() {
  const [workspace, setWorkspace] = useState(() => getZebraWorkspace());

  useEffect(() => {
    const sync = () => setWorkspace(getZebraWorkspace());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return workspace;
}
