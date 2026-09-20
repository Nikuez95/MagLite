import { useEffect, useCallback, useRef } from 'react';

/**
 * Hook globale per intercettare l'input proveniente dal laser scanner Zebra.
 * 
 * Il laser agisce come emulazione tastiera, digitando rapidamente i caratteri
 * e inviando un carattere terminatore (solitamente 'Enter') alla fine.
 * 
 * @param {Function} onScan - Callback function eseguita quando uno scan è completato.
 * @param {Object} options - Opzioni di configurazione.
 * @param {number} [options.timeout=50] - Tempo massimo in ms tra la digitazione di due tasti per essere considerato uno scanner (e non digitazione umana).
 */
const useBarcodeScanner = (onScan, options = {}) => {
  const timeout = options.timeout || 50;
  
  // Utilizziamo useRef per il buffer e il timer per evitare re-render non necessari
  const buffer = useRef('');
  const timeoutRef = useRef(null);

  const handleKeyDown = useCallback(
    (e) => {
      // Regola Fondamentale: ignora i tasti se l'utente è focalizzato su un campo di input manuale
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (['input', 'textarea', 'select'].includes(activeTag)) {
        return;
      }

      // Se riceve il carattere terminatore (Enter), invia il buffer alla callback
      if (e.key === 'Enter') {
        if (buffer.current.length > 0) {
          onScan(buffer.current);
          buffer.current = '';
        }
        return;
      }

      // Ignora tasti speciali che non fanno parte del barcode (es. Shift, Control, ecc.)
      // Un carattere stampabile ha generalmente length === 1
      if (e.key.length !== 1) {
        return;
      }

      // Aggiunge il carattere al buffer
      buffer.current += e.key;

      // Resetta il timer: se passa troppo tempo dal carattere precedente, assumiamo 
      // che sia digitazione umana accidentale (o che lo scan sia fallito/incompleto) e puliamo il buffer
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      timeoutRef.current = setTimeout(() => {
        buffer.current = '';
      }, timeout);
    },
    [onScan, timeout]
  );

  useEffect(() => {
    // Aggiungiamo il listener a livello globale sul document
    document.addEventListener('keydown', handleKeyDown);
    
    // Cleanup alla distruzione del componente (es. navigazione di pagina)
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [handleKeyDown]);
};

export default useBarcodeScanner;
