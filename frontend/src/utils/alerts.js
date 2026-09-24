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
    confirmButtonText: 'Sì, procedi',
    cancelButtonText: 'Annulla'
  });
  return result.isConfirmed;
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
