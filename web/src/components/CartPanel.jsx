import { QuantityStepper } from './QuantityStepper'

// Running cart for the POS screen: one row per line item with its selected
// modifiers, a quantity stepper, a line total, and a remove button.
export function CartPanel({ items, onUpdateQuantity, onRemove, t }) {
  const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)

  return (
    <div className="pos-cart card">
      <h2>{t('pos.cart')}</h2>
      {items.length === 0 ? (
        <p className="cart-empty">{t('pos.cartEmpty')}</p>
      ) : (
        <>
          <div className="cart-lines">
            {items.map((item) => (
              <div className="cart-line" key={item.key}>
                <div className="cart-line-info">
                  <strong>{item.product.name}</strong>
                  {item.modifierOptions.length > 0 && (
                    <span className="cart-line-modifiers">
                      {item.modifierOptions.map((o) => o.name).join(', ')}
                    </span>
                  )}
                  <span>{item.unitPrice.toFixed(2)} × {item.quantity} = {(item.unitPrice * item.quantity).toFixed(2)}</span>
                  <QuantityStepper
                    value={item.quantity}
                    onChange={(qty) => onUpdateQuantity(item.key, qty)}
                    min={1}
                  />
                </div>
                <button type="button" onClick={() => onRemove(item.key)}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
          <div className="cart-totals">
            <span>{t('pos.total')}</span>
            <span>{total.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  )
}
