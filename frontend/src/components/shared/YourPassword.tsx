// Your own password, typed again: to unlock Loskai's SSH key, or to replace it.
export function YourPassword({
  value,
  onChange,
  className,
  placeholder = "Your password",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      autoFocus={autoFocus}
      type="password"
      autoComplete="current-password"
      aria-label="Your password"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}
