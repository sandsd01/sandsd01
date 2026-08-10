// Small +/- stepper with a numeric input in the middle. Reused by CartPanel
// (adjusting an existing cart line) and ModifierPickerModal (choosing the
// quantity to add).
export function QuantityStepper({ value, onChange, min = 1, max, disabled = false }) {
  function clamp(next) {
    let n = Number.isFinite(next) ? next : min
    if (n < min) n = min
    if (max !== undefined && n > max) n = max
    return n
  }

  function handleInputChange(e) {
    const raw = e.target.value
    if (raw === '') {
      onChange(min)
      return
    }
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) return
    onChange(clamp(parsed))
  }

  return (
    <div className="qty-stepper">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  )
}
