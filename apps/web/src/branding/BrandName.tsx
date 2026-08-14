export function BrandName({
  className = '',
  cloud = false,
}: {
  className?: string;
  cloud?: boolean;
}) {
  const label = cloud ? 'VigiOn Cloud' : 'VigiOn';

  return (
    <span className={`font-bold tracking-tight text-slate-100 ${className}`} aria-label={label}>
      <span aria-hidden="true">
        Vigi
        <span
          className="text-emerald-400"
          style={{ WebkitTextStroke: '0.45px #064e3b', paintOrder: 'stroke fill' }}
        >
          On
        </span>
        {cloud && <span className="text-slate-100"> Cloud</span>}
      </span>
    </span>
  );
}
