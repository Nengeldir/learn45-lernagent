import { useI18n } from './i18n.tsx';
/** Reserve the largest label before interaction, without duplicating its accessible name. */
export function ButtonLabel({ children, variants }: { children: string; variants: readonly string[] }) {
  const { t } = useI18n();
  return <span className="button-label">
    {[...new Set(variants.map(label => t(label)))].map(label => <span key={label} className="button-label-reserve" aria-hidden="true">{label}</span>)}
    <span>{t(children)}</span>
  </span>;
}
