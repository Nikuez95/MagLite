import Swal from 'sweetalert2';

function isLightTheme() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('theme-light');
}

function getSwalTheme() {
  const light = isLightTheme();
  return {
    light,
    background: light ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)',
    color: light ? '#0b1926' : '#f8fafc',
    backdrop: light ? 'rgba(11, 25, 38, 0.32)' : 'rgba(2, 6, 23, 0.75)',
    popupClass: light
      ? 'maglite-swal-popup border border-sky-200 rounded-3xl shadow-[0_25px_70px_-15px_rgba(14,116,214,0.22)] backdrop-blur-xl px-6 py-6'
      : 'maglite-swal-popup border border-slate-700/80 rounded-3xl shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)] backdrop-blur-xl px-6 py-6',
    toastPopupClass: light
      ? 'maglite-swal-toast border border-sky-200 rounded-2xl shadow-xl backdrop-blur-xl px-4 py-3 cursor-pointer select-none'
      : 'maglite-swal-toast border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl px-4 py-3 cursor-pointer select-none',
    titleClass: light ? 'text-xl font-black tracking-tight text-[#0b1926] pt-1' : 'text-xl font-black tracking-tight text-slate-100 pt-1',
    toastTitleClass: light ? 'text-sm font-bold text-[#0b1926]' : 'text-sm font-bold text-slate-100',
    htmlClass: light ? 'text-sm text-[#335675] font-medium leading-relaxed mt-2' : 'text-sm text-slate-300 font-medium leading-relaxed mt-2',
    actionsBorder: light ? 'border-sky-100' : 'border-slate-800/80',
    cancelBtn: light
      ? 'px-5 py-2.5 bg-sky-50 hover:bg-sky-100 active:scale-95 text-[#1c3954] hover:text-[#0b1926] font-bold text-sm rounded-xl border border-sky-200 transition-all cursor-pointer select-none'
      : 'px-5 py-2.5 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white font-bold text-sm rounded-xl border border-slate-700 transition-all cursor-pointer select-none',
    denyBtn: light
      ? 'px-5 py-2.5 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 border border-rose-300 font-bold text-sm rounded-xl transition-all cursor-pointer select-none'
      : 'px-5 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 text-rose-300 border border-rose-500/40 font-bold text-sm rounded-xl transition-all cursor-pointer select-none',
    closeBtn: light
      ? 'text-[#4c7294] hover:text-[#0b1926] transition-colors focus:outline-none cursor-pointer'
      : 'text-slate-400 hover:text-white transition-colors focus:outline-none cursor-pointer',
    inputClass: light
      ? 'bg-[#f0f8ff] border border-sky-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-400/25 px-4 py-3 rounded-xl text-[#0b1926] text-sm font-medium w-full mt-4 outline-none transition-all'
      : 'bg-slate-950/90 border border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 px-4 py-3 rounded-xl text-white text-sm font-medium w-full mt-4 outline-none transition-all',
    confirmSky: light
      ? 'px-5 py-2.5 bg-[#9ad4ff] hover:bg-[#82c8ff] active:scale-95 text-[#0b1926] border border-[#6cb8f5] font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(14,165,233,0.2)] cursor-pointer select-none'
      : 'px-5 py-2.5 bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(14,165,233,0.3)] cursor-pointer select-none',
    confirmAmber: light
      ? 'px-5 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(245,158,11,0.25)] cursor-pointer select-none'
      : 'px-5 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-slate-950 font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] cursor-pointer select-none',
    confirmRose: 'px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-black text-sm rounded-xl transition-all shadow-[0_0_20px_rgba(225,29,72,0.35)] cursor-pointer select-none',
    progressBar: light ? 'bg-sky-600' : 'bg-sky-400'
  };
}

function fireAppSwal(options = {}) {
  const t = getSwalTheme();
  const { customClass = {}, ...rest } = options;
  return Swal.fire({
    background: t.background,
    color: t.color,
    buttonsStyling: false,
    showCloseButton: true,
    reverseButtons: true,
    focusConfirm: true,
    backdrop: t.backdrop,
    ...rest,
    customClass: {
      container: 'maglite-swal-container',
      popup: t.popupClass,
      title: t.titleClass,
      htmlContainer: t.htmlClass,
      actions: `flex items-center justify-end gap-3 w-full mt-6 pt-4 border-t ${t.actionsBorder}`,
      confirmButton: t.confirmSky,
      cancelButton: t.cancelBtn,
      denyButton: t.denyBtn,
      closeButton: t.closeBtn,
      input: t.inputClass,
      ...customClass
    }
  });
}

function fireToastSwal(options = {}) {
  const t = getSwalTheme();
  return Swal.fire({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    showCloseButton: true,
    timer: 3000,
    timerProgressBar: true,
    background: t.background,
    color: t.color,
    customClass: {
      popup: t.toastPopupClass,
      title: t.toastTitleClass,
      closeButton: t.closeBtn,
      timerProgressBar: t.progressBar
    },
    didOpen: (toast) => {
      toast.onmouseenter = Swal.stopTimer;
      toast.onmouseleave = Swal.resumeTimer;
      toast.onclick = () => {
        Swal.close();
      };
    },
    ...options
  });
}

export const appToast = (message, icon = 'success') => {
  return fireToastSwal({
    icon,
    title: message
  });
};

export const appAlert = (message, title = 'Avviso', icon = 'info') => {
  if (icon === 'success' && (!message || String(message).length <= 110)) {
    return fireToastSwal({
      icon: 'success',
      title: title && title !== 'Successo' && title !== 'Avviso' && title !== 'Completato'
        ? `${title}: ${message}`
        : (message || title)
    });
  }

  const t = getSwalTheme();
  const confirmBtnClass = icon === 'error'
    ? t.confirmRose
    : icon === 'warning'
      ? t.confirmAmber
      : t.confirmSky;

  return fireAppSwal({
    title,
    text: message,
    icon,
    confirmButtonText: 'Ho capito',
    customClass: {
      actions: `flex items-center justify-center w-full mt-6 pt-4 border-t ${t.actionsBorder}`,
      confirmButton: confirmBtnClass
    }
  });
};

export const appConfirm = async (message, title = 'Conferma Operazione') => {
  const t = getSwalTheme();
  const isDanger = /elimin|cancell|rifiut|rimuov|azzera|svuot/i.test(`${title} ${message}`);
  const result = await fireAppSwal({
    title,
    text: message,
    icon: isDanger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: isDanger ? 'Sì, conferma' : 'Sì, procedi',
    cancelButtonText: 'Annulla',
    customClass: {
      confirmButton: isDanger ? t.confirmRose : t.confirmSky
    }
  });
  return result.isConfirmed;
};

export const appConfirmThreeWay = async (message, title = 'Conferma', confirmText = 'Conferma', denyText = 'Nega', cancelText = 'Annulla') => {
  const result = await fireAppSwal({
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
  const result = await fireAppSwal({
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
