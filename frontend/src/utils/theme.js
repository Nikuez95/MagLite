import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

export const THEME_DARK = 'dark';
export const THEME_LIGHT = 'light';

export function normalizeTheme(value) {
  return value === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
}

export function getUserTheme(userObj = null) {
  if (userObj && typeof userObj === 'object') {
    return normalizeTheme(userObj?.preferences?.theme);
  }
  try {
    const token = localStorage.getItem('maglite_token');
    if (!token) return THEME_DARK;
    const u = JSON.parse(localStorage.getItem('maglite_user') || '{}');
    return normalizeTheme(u?.preferences?.theme);
  } catch {
    return THEME_DARK;
  }
}

export function applyTheme(theme) {
  const next = normalizeTheme(theme);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (next === THEME_LIGHT) {
      root.classList.add('theme-light');
      root.dataset.theme = THEME_LIGHT;
    } else {
      root.classList.remove('theme-light');
      root.dataset.theme = THEME_DARK;
    }
  }
  return next;
}

export async function saveUserTheme(nextTheme) {
  const clean = applyTheme(nextTheme);

  try {
    const rawUser = localStorage.getItem('maglite_user');
    if (rawUser) {
      const currentUser = JSON.parse(rawUser);
      const updatedUser = {
        ...currentUser,
        preferences: {
          ...(currentUser.preferences && typeof currentUser.preferences === 'object' ? currentUser.preferences : {}),
          theme: clean
        }
      };
      localStorage.setItem('maglite_user', JSON.stringify(updatedUser));
    }
  } catch {
    // ignore storage errors
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('maglite_theme_updated', { detail: clean }));
  }

  try {
    const token = localStorage.getItem('maglite_token');
    if (token) {
      await axios.put(
        `http://${window.location.hostname}:3000/api/auth/preferences`,
        { preferences: { theme: clean } },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }
  } catch {
    // offline/network errors keep local state applied
  }

  return clean;
}

export function useTheme() {
  const [theme, setThemeState] = useState(() => getUserTheme());

  useEffect(() => {
    const syncFromEvent = (e) => {
      const next = e?.detail ? normalizeTheme(e.detail) : getUserTheme();
      applyTheme(next);
      setThemeState(next);
    };
    const syncFromUser = () => {
      const next = getUserTheme();
      applyTheme(next);
      setThemeState(next);
    };
    window.addEventListener('maglite_theme_updated', syncFromEvent);
    window.addEventListener('maglite_permissions_updated', syncFromUser);
    return () => {
      window.removeEventListener('maglite_theme_updated', syncFromEvent);
      window.removeEventListener('maglite_permissions_updated', syncFromUser);
    };
  }, []);

  const setTheme = useCallback((nextTheme) => {
    const clean = normalizeTheme(nextTheme);
    setThemeState(clean);
    return saveUserTheme(clean);
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
    setThemeState(next);
    return saveUserTheme(next);
  }, [theme]);

  return {
    theme,
    isLight: theme === THEME_LIGHT,
    isDark: theme === THEME_DARK,
    setTheme,
    toggleTheme
  };
}

export function getLogoSrc(theme) {
  return normalizeTheme(theme) === THEME_LIGHT ? '/logo_scuro.png' : '/logo.png';
}

export const themedSelectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: 'var(--rs-bg)',
    borderColor: state.isFocused ? 'var(--rs-accent)' : 'var(--rs-border)',
    borderRadius: '0.75rem',
    padding: '0.15rem',
    minHeight: '42px',
    boxShadow: 'none',
    '&:hover': { borderColor: 'var(--rs-accent)' }
  }),
  menu: base => ({
    ...base,
    backgroundColor: 'var(--rs-menu-bg)',
    zIndex: 50,
    border: '1px solid var(--rs-border)'
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused ? 'var(--rs-option-hover)' : 'transparent',
    color: 'var(--rs-text)',
    cursor: 'pointer',
    fontSize: '0.875rem'
  }),
  singleValue: base => ({ ...base, color: 'var(--rs-text)', fontSize: '0.875rem' }),
  input: base => ({ ...base, color: 'var(--rs-text)', fontSize: '0.875rem' }),
  placeholder: base => ({ ...base, color: 'var(--rs-muted)', fontSize: '0.875rem' }),
  multiValue: base => ({
    ...base,
    backgroundColor: 'var(--rs-multi-bg)',
    borderRadius: '0.375rem',
    border: '1px solid var(--rs-multi-border)'
  }),
  multiValueLabel: base => ({
    ...base,
    color: 'var(--rs-accent)',
    fontWeight: 'bold',
    fontSize: '0.7rem',
    textTransform: 'uppercase'
  }),
  multiValueRemove: base => ({
    ...base,
    color: 'var(--rs-muted)',
    ':hover': { backgroundColor: '#f43f5e', color: '#fff' }
  })
};
