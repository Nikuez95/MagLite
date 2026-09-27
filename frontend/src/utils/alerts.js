import Swal from 'sweetalert2';

const AppSwal = Swal.mixin({
  background: '#0f172a',
  color: '#f8fafc',
  confirmButtonColor: '#0ea5e9',
  cancelButtonColor: '#334155',
  customClass: {
    popup: 'border border-slate-800 rounded-3xl shadow-2xl',
    title: 'text-xl font-bold',
    confirmButton: 'px-6 py-3 font-bold rounded-xl transition-colors m-2',
    cancelButton: 'px-6 py-3 font-bold rounded-xl transition-colors m-2',
    denyButton: 'px-6 py-3 font-bold rounded-xl transition-colors m-2 bg-slate-700 text-white hover:bg-slate-600',
    input: 'bg-slate-950 border border-slate-700 p-3 rounded-xl text-white focus:border-sky-500 w-full mt-4',
  }
});

export const appAlert = (message, title = 'Avviso', icon = 'info') => {
  return AppSwal.fire({
    title,
    text: message,
    icon,
    confirmButtonText: 'OK'
  });
};

export const appConfirm = async (message, title = 'Conferma') => {
  const result = await AppSwal.fire({
    title,
    text: message,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Si, procedi',
    cancelButtonText: 'Annulla'
  });
  return result.isConfirmed;
};

export const appConfirmThreeWay = async (message, title = 'Conferma', confirmText = 'Conferma', denyText = 'Nega', cancelText = 'Annulla') => {
  const result = await AppSwal.fire({
    title,
    text: message,
    icon: 'warning',
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

export const appPrompt = async (message, title = 'Inserimento') => {
  const result = await AppSwal.fire({
    title,
    text: message,
    input: 'text',
    showCancelButton: true,
    confirmButtonText: 'Invia',
    cancelButtonText: 'Annulla'
  });
  return result.value;
};
