export const statusLabel = (value) => typeof value === 'string'
  ? value.toLowerCase().replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase())
  : '—';
