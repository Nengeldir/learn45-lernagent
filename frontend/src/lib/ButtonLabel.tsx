/** Reserve the largest label before interaction, without duplicating its accessible name. */
export function ButtonLabel({ children, variants }: { children: string; variants: readonly string[] }) {
  return <span className="button-label">
    {[...new Set(variants)].map(label => <span key={label} className="button-label-reserve" aria-hidden="true">{label}</span>)}
    <span>{children}</span>
  </span>;
}
