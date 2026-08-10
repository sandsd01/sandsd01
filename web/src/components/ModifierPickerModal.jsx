import { useMemo, useState } from 'react'
import { QuantityStepper } from './QuantityStepper'

function formatPriceDelta(delta) {
  if (!delta) return null
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(2)}`
}

// Lets the cashier choose modifier options for a product before it's added to
// the cart. `groups` is the array returned by GET /products/:id/modifier-groups.
export function ModifierPickerModal({ product, groups, onConfirm, onCancel, t }) {
  const [selections, setSelections] = useState({}) // groupId -> Set<optionId>
  const [quantity, setQuantity] = useState(1)

  function toggleSingle(group, optionId) {
    setSelections((prev) => ({ ...prev, [group.id]: new Set([optionId]) }))
  }

  function toggleMultiple(group, optionId) {
    setSelections((prev) => {
      const current = new Set(prev[group.id] || [])
      if (current.has(optionId)) current.delete(optionId)
      else current.add(optionId)
      return { ...prev, [group.id]: current }
    })
  }

  const selectedOptions = useMemo(() => {
    const options = []
    for (const group of groups) {
      const chosen = selections[group.id]
      if (!chosen) continue
      for (const option of group.options) {
        if (chosen.has(option.id)) options.push(option)
      }
    }
    return options
  }, [groups, selections])

  const unmetRequiredGroups = groups.filter(
    (g) => g.required && (!selections[g.id] || selections[g.id].size === 0)
  )
  const canConfirm = unmetRequiredGroups.length === 0

  const unitPrice = (product.sellingPrice ?? 0) + selectedOptions.reduce((sum, o) => sum + o.priceDelta, 0)

  function handleConfirm() {
    if (!canConfirm) return
    onConfirm({
      quantity,
      modifierOptionIds: selectedOptions.map((o) => o.id),
      modifierOptions: selectedOptions,
      unitPrice,
    })
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{product.name}</h2>

        {groups.map((group) => (
          <div className="modifier-group" key={group.id}>
            <h3>
              {group.name}
              {group.required && <span className="required-badge">{t('modifiers.required')}</span>}
            </h3>
            {group.options.map((option) => (
              <div className="modifier-option-row" key={option.id}>
                <label>
                  <input
                    type={group.selectionType === 'single' ? 'radio' : 'checkbox'}
                    name={`group-${group.id}`}
                    checked={Boolean(selections[group.id]?.has(option.id))}
                    onChange={() =>
                      group.selectionType === 'single'
                        ? toggleSingle(group, option.id)
                        : toggleMultiple(group, option.id)
                    }
                  />
                  {option.name}
                </label>
                {formatPriceDelta(option.priceDelta) && <span>{formatPriceDelta(option.priceDelta)}</span>}
              </div>
            ))}
          </div>
        ))}

        {!canConfirm && <p className="error">{t('modifiers.requiredWarning')}</p>}

        <label>
          {t('pos.quantity')}
          <QuantityStepper value={quantity} onChange={setQuantity} min={1} />
        </label>

        <p className="modifier-unit-price">
          {t('pos.unitPrice')}: {unitPrice.toFixed(2)}
        </p>

        <div className="actions">
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            {t('pos.addToCart')}
          </button>
        </div>
      </div>
    </div>
  )
}
