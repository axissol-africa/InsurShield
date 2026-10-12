/**
 * An erratic dotted waveform — the visual noise behind the "old way" panel.
 *
 * Column heights come from a fixed seeded function rather than Math.random so
 * the shape is identical on every render and between server and client. Purely
 * decorative; the panel's meaning is carried by its heading and copy.
 */
const COLUMNS = 52;
const MAX_DOTS = 15;

/** Deterministic, jagged, and never repeating within the visible width. */
function columnHeight(index) {
  const wave =
    Math.sin(index * 0.7) * 0.5 +
    Math.sin(index * 1.9 + 1.3) * 0.3 +
    Math.sin(index * 4.1 + 0.7) * 0.2;
  const spike = index % 11 === 0 ? 0.35 : index % 7 === 0 ? 0.2 : 0;
  return Math.max(2, Math.round(((wave + 1) / 2 + spike) * MAX_DOTS));
}

export default function DitherChart({ className = '' }) {
  return (
    <svg
      viewBox={`0 0 ${COLUMNS * 6} ${MAX_DOTS * 6}`}
      className={className}
      aria-hidden="true"
      role="presentation"
      preserveAspectRatio="none"
    >
      {Array.from({ length: COLUMNS }, (_, col) => {
        const dots = columnHeight(col);
        return Array.from({ length: dots }, (_, row) => {
          const y = MAX_DOTS * 6 - row * 6 - 3;
          // Dots fade and cool as they climb, so the peaks read as spikes.
          const heat = 1 - row / MAX_DOTS;
          return (
            <circle
              key={`${col}-${row}`}
              cx={col * 6 + 3}
              cy={y}
              r="1.2"
              fill={heat > 0.55 ? 'var(--color-primary)' : '#f97316'}
              opacity={0.25 + heat * 0.6}
            />
          );
        });
      })}
    </svg>
  );
}
