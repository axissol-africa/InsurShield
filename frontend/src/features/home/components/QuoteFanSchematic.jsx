/**
 * The product in one picture: a single request fans out to every active
 * insurer at once, and each replies with its own final quote.
 *
 * Drawn as an SVG so it scales cleanly and the connectors can carry an
 * animated signal. Insurer names come from the live catalogue, so this stays
 * truthful as the network changes.
 */
export default function QuoteFanSchematic({ insurers = [] }) {
  const nodes = insurers.slice(0, 5);
  if (!nodes.length) return null;

  const height = 300;
  const rowGap = height / nodes.length;
  const originX = 96;
  const originY = height / 2;
  const targetX = 262;

  return (
    <figure className="relative">
      <figcaption className="sr-only">
        One quote request is delivered to {nodes.length} insurers at the same time; each returns its own final quote.
      </figcaption>

      <svg
        viewBox={`0 0 430 ${height}`}
        className="h-auto w-full"
        role="presentation"
        aria-hidden="true"
      >
        {/* Connectors: request out to each insurer. */}
        {nodes.map((insurer, index) => {
          const y = rowGap * index + rowGap / 2;
          const midX = (originX + targetX) / 2;
          return (
            <path
              key={insurer.id}
              d={`M ${originX} ${originY} C ${midX} ${originY}, ${midX} ${y}, ${targetX} ${y}`}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="1"
              className="signal-line"
              style={{ animationDelay: `${index * 0.18}s`, opacity: 0.55 }}
            />
          );
        })}

        {/* Origin node: the customer's single request. */}
        <rect
          x={originX - 76} y={originY - 19} width="76" height="38"
          fill="var(--color-primary)"
        />
        <text
          x={originX - 38} y={originY + 4}
          textAnchor="middle"
          className="fill-white font-mono"
          style={{ fontSize: 11, letterSpacing: '0.06em' }}
        >
          REQUEST
        </text>

        {/* Insurer nodes. */}
        {nodes.map((insurer, index) => {
          const y = rowGap * index + rowGap / 2;
          return (
            <g key={insurer.id}>
              <circle cx={targetX} cy={y} r="3" fill="var(--color-primary)" />
              <line
                x1={targetX + 10} y1={y} x2={targetX + 22} y2={y}
                stroke="var(--color-line-strong)" strokeWidth="1"
              />
              <text
                x={targetX + 30} y={y + 3.5}
                className="fill-ink font-mono"
                style={{ fontSize: 11.5, letterSpacing: '0.01em' }}
              >
                {insurer.name.length > 19 ? `${insurer.name.slice(0, 18)}…` : insurer.name}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
