/**
 * High-contrast operational theme tokens for Spill workspaces.
 * Prefer these over hardcoded low-contrast slate greys in operator UIs.
 */
export const theme = {
  bg: '#0a0e17',
  surface: '#121826',
  surfaceRaised: '#1a2233',
  surfaceHover: '#222b3d',
  border: '#3d4a63',
  borderSoft: '#2a3548',
  text: '#f8fafc',
  textSecondary: '#e2e8f0',
  muted: '#a8b4c8', // WCAG-friendly on dark surfaces (~4.5:1+)
  faint: '#7c8ba1',
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.16)',
  danger: '#f87171',
  warn: '#fbbf24',
  success: '#4ade80',
  fontBase: 16,
  fontSm: 13,
  fontXs: 12,
}
