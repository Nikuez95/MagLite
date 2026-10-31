import Swal from 'sweetalert2';

const AppSwal = Swal.mixin({
  background: 'rgba(15, 23, 42, 0.96)',
  color: '#f8fafc',
  buttonsStyling: false,
  showCloseButton: true,
  reverseButtons: true,
  focusConfirm: true,
  backdrop: 'rgba(2, 6, 23, 0.75)',
  customClass: {
    container: 'maglite-swal-container',
    popup: 'maglite-swal-popup border border-slate-700/80 rounded-3xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] backdrop-blur-xl px-6 py-6',
    title: 'text-xl font-black tracking-tight text-slate-100 pt-1',
    htmlContainer: 'text-sm text-slate-300 font-medium leading-relaxed mt-2',
    actions: 'flex items-center justify-end gap-3 w-full mt-6 pt-4 border-t border-slate-800/80',
    confirmButton: 'px-5 py-2.5 bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] cursor-pointer select-none',
    cancelButton: 'px-5 py-2.5 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white font-bold text-sm rounded-xl border border-slate-700 transition-all cursor-pointer select-none',
    denyButton: 'px-5 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 text-rose-300 border border-rose-500/40 font-bold text-sm rounded-xl transition-all cursor-pointer select-none',
    closeButton: 'text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer',
    input: 'bg-slate-950/90 border border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 px-4 py-3 rounded-xl text-white text-sm font-medium w-full mt-4 outline-none transition-all',
  }
});

const ToastSwal = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  showCloseButton: true,
  timer: 3000,
  timerProgressBar: true,
  background: 'rgba(15, 23, 42, 0.96)',
  color: '#f8fafc',
  customClass: {
    popup: 'maglite-swal-toast border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl px-4 py-3 cursor-pointer select-none',
    title: 'text-sm font-bold text-slate-100',
    closeButton: 'text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer',
    timerProgressBar: 'bg-sky-400'
  },
  didOpen: (toast) => {
    toast.onmouseenter = Swal.stopTimer;
    toast.onmouseleave = Swal.resumeTimer;
    toast.onclick = () => {
      Swal.close();
    };
  }
});

export const appToast = (message, icon = 'success') => {
  return ToastSwal.fire({
    icon,
    title: message
  });
};

export const appAlert = (message, title = 'Avviso', icon = 'info') => {
  // Per notifiche rapide di successo usiamo un toast moderno e non bloccante
  if (icon === 'success' && (!message || String(message).length <= 110)) {
    return ToastSwal.fire({
      icon: 'success',
      title: title && title !== 'Successo' && title !== 'Avviso' && title !== 'Completato'
        ? `${title}: ${message}`
        : (message || title)
    });
  }

  const confirmBtnClass = icon === 'error'
    ? 'px-5 py-2.5 bg-rose-500 hover:bg-rose-400 active:scale-95 text-white font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(244,63,94,0.3)] cursor-pointer select-none'
    : icon === 'warning'
      ? 'px-5 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] cursor-pointer select-none'
      : 'px-5 py-2.5 bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] cursor-pointer select-none';

  return AppSwal.fire({
    title,
    text: message,
    icon,
    confirmButtonText: 'Ho capito',
    customClass: {
      container: 'maglite-swal-container',
      popup: 'maglite-swal-popup border border-slate-700/80 rounded-3xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] backdrop-blur-xl px-6 py-6',
      title: 'text-xl font-black tracking-tight text-slate-100 pt-1',
      htmlContainer: 'text-sm text-slate-300 font-medium leading-relaxed mt-2',
      actions: 'flex items-center justify-center w-full mt-6 pt-4 border-t border-slate-800/80',
      confirmButton: confirmBtnClass,
      closeButton: 'text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer',
    }
  });
};

export const appConfirm = async (message, title = 'Conferma Operazione') => {
  const isDanger = /elimin|cancell|rifiut|rimuov|azzera|svuot/i.test(`${title} ${message}`);
  const result = await AppSwal.fire({
    title,
    text: message,
    icon: isDanger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: isDanger ? 'Sì, conferma' : 'Sì, procedi',
    cancelButtonText: 'Annulla',
    customClass: {
      container: 'maglite-swal-container',
      popup: 'maglite-swal-popup border border-slate-700/80 rounded-3xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] backdrop-blur-xl px-6 py-6',
      title: 'text-xl font-black tracking-tight text-slate-100 pt-1',
      htmlContainer: 'text-sm text-slate-300 font-medium leading-relaxed mt-2',
      actions: 'flex items-center justify-end gap-3 w-full mt-6 pt-4 border-t border-slate-800/80',
      confirmButton: isDanger
        ? 'px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(225,29,72,0.35)] cursor-pointer select-none'
        : 'px-5 py-2.5 bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] cursor-pointer select-none',
      cancelButton: 'px-5 py-2.5 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white font-bold text-sm rounded-xl border border-slate-700 transition-all cursor-pointer select-none',
      closeButton: 'text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer',
    }
  });
  return result.isConfirmed;
};

export const appConfirmThreeWay = async (message, title = 'Conferma', confirmText = 'Conferma', denyText = 'Nega', cancelText = 'Annulla') => {
  const result = await AppSwal.fire({
    title,
    text: message,
    icon: 'question',
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: confirmText,
    denyButtonText: denyText,
    cancelButtonText: cancelText
  });
  if (result.isConfirmed) return 'CONFIRM';
  if (result.isDenied) return 'DENY';
  return 'CANCEL';
};

export const appPrompt = async (message, title = 'Inserimento Dati', placeholder = 'Scrivi qui...') => {
  const result = await AppSwal.fire({
    title,
    text: message,
    input: 'text',
    inputPlaceholder: placeholder,
    showCancelButton: true,
    confirmButtonText: 'Conferma',
    cancelButtonText: 'Annulla'
  });
  return result.value;
};
