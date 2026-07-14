export default function Logo({ size = 26, markOnly = false }: { size?: number; markOnly?: boolean }) {
  return (
    <span className="brand" aria-label="Factor20">
      <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="8" className="brand-tile" />
        <polyline
          className="brand-line"
          points="6,22 12,16 17,19 26,8"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="brand-dot" cx="26" cy="8" r="2.4" />
      </svg>
      {!markOnly && (
        <span className="brand-word">
          Factor<span>20</span>
        </span>
      )}
    </span>
  );
}
