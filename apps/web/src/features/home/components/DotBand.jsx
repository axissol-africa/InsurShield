/**
 * A row of dots that pulse out of phase — the section marker used across the
 * schematic surface. Purely decorative, so it is hidden from assistive tech.
 */
export default function DotBand({ count = 14, className = '' }) {
  return (
    <span aria-hidden="true" className={`flex items-center gap-1.5 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="dot-pulse block h-[3px] w-[3px] shrink-0 rounded-full bg-primary"
          // Staggering the delay makes the band read as a signal travelling
          // left to right rather than a row blinking in unison.
          style={{ animationDelay: `${index * 0.09}s` }}
        />
      ))}
    </span>
  );
}
