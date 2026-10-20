export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0f1b3a" stroke="#2a3c66" />
      <path d="M9 22.5 16 8l7 14.5-7-3.6-7 3.6Z" fill="#3d8bff" />
      <circle cx="16" cy="15.5" r="1.6" fill="#e7edf8" />
    </svg>
  );
}
