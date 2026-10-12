/**
 * The small monospace caption used throughout the schematic surface —
 * section markers, field labels and status lines.
 */
export default function Meta({ children, as: Tag = 'span', className = '', ...rest }) {
  return (
    <Tag
      className={`font-mono text-[12px] uppercase leading-none tracking-[0.12em] ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
