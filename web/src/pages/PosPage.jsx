import { useEffect, useMemo, useState } from 'react'
import { apiFetch, downloadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { ProductGrid } from '../components/ProductGrid'
import { CartPanel } from '../components/CartPanel'
import { ModifierPickerModal } from '../components/ModifierPickerModal'

const LOCATION_STORAGE_KEY = 'pos.locationId'

function cartKey(productId, modifierOptionIds) {
  return `${productId}:${[...modifierOptionIds].sort((a, b) => a - b).join(',')}`
}

export function PosPage() {
  const { token, user } = useAuth()
  const { t } = useLanguage()

  // Staff assigned to a home branch always ring up sales there — the backend
  // scopes their sales to it anyway, so don't let them pick a different one.
  const lockedLocationId =
    user?.role === 'staff' && user?.homeLocationId ? String(user.homeLocationId) : null

  const [locations, setLocations] = useState([])
  const [locationId, setLocationId] = useState(
    () => lockedLocationId || localStorage.getItem(LOCATION_STORAGE_KEY) || ''
  )
  const [locationsError, setLocationsError] = useState(null)

  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [gridError, setGridError] = useState(null)

  const [stockMap, setStockMap] = useState(new Map())

  const [scanCode, setScanCode] = useState('')
  const [scanError, setScanError] = useState(null)

  const [pendingProduct, setPendingProduct] = useState(null) // { product, groups }
  const [cart, setCart] = useState([])

  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountTendered, setAmountTendered] = useState('')
  const [note, setNote] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState(null)
  const [completedSale, setCompletedSale] = useState(null)

  useEffect(() => {
    apiFetch('/locations', { token })
      .then((locs) => {
        const active = locs.filter((l) => l.isActive)
        setLocations(active)
        if (lockedLocationId) return
        const saved = localStorage.getItem(LOCATION_STORAGE_KEY)
        if (saved && !active.some((l) => String(l.id) === saved)) {
          localStorage.removeItem(LOCATION_STORAGE_KEY)
          setLocationId('')
        }
      })
      .catch((err) => setLocationsError(err.message))
    apiFetch('/products/categories', { token })
      .then(setCategories)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadProducts() {
    setProductsLoading(true)
    setGridError(null)
    try {
      const params = new URLSearchParams({ pageSize: '100' })
      if (search) params.set('search', search)
      if (category) params.set('category', category)
      const result = await apiFetch(`/products?${params.toString()}`, { token })
      setProducts(result.data)
    } catch (err) {
      setGridError(err.message)
    } finally {
      setProductsLoading(false)
    }
  }

  useEffect(() => {
    loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category])

  useEffect(() => {
    if (!locationId) {
      setStockMap(new Map())
      return
    }
    apiFetch(`/locations/${locationId}/stock`, { token })
      .then((stock) => setStockMap(new Map(stock.map((s) => [s.productId, s.quantity]))))
      .catch((err) => setGridError(err.message))
  }, [locationId, token])

  // /auth/me may resolve after the first render, so re-apply the lock when it lands.
  useEffect(() => {
    if (lockedLocationId) setLocationId(lockedLocationId)
  }, [lockedLocationId])

  function handleLocationChange(value) {
    setLocationId(value)
    if (value) localStorage.setItem(LOCATION_STORAGE_KEY, value)
    else localStorage.removeItem(LOCATION_STORAGE_KEY)
  }

  const selectedLocation = useMemo(
    () => locations.find((l) => String(l.id) === String(locationId)) || null,
    [locations, locationId]
  )

  const sellableProducts = useMemo(
    () =>
      products
        .filter((p) => p.sellingPrice !== null && p.sellingPrice !== undefined)
        .map((p) => ({ ...p, stockQty: locationId ? stockMap.get(p.id) ?? 0 : undefined })),
    [products, stockMap, locationId]
  )

  function addToCart({ product, quantity, modifierOptionIds, modifierOptions, unitPrice }) {
    setCheckoutError(null)
    const key = cartKey(product.id, modifierOptionIds)
    setCart((prev) => {
      const existing = prev.find((line) => line.key === key)
      if (existing) {
        return prev.map((line) =>
          line.key === key ? { ...line, quantity: line.quantity + quantity } : line
        )
      }
      return [...prev, { key, product, quantity, modifierOptionIds, modifierOptions, unitPrice }]
    })
  }

  async function handleSelectProduct(product) {
    setGridError(null)
    try {
      const groups = await apiFetch(`/products/${product.id}/modifier-groups`, { token })
      if (groups.length > 0) {
        setPendingProduct({ product, groups })
      } else {
        addToCart({
          product,
          quantity: 1,
          modifierOptionIds: [],
          modifierOptions: [],
          unitPrice: product.sellingPrice,
        })
      }
    } catch (err) {
      setGridError(err.message)
    }
  }

  function handleModifierConfirm(selection) {
    addToCart({ product: pendingProduct.product, ...selection })
    setPendingProduct(null)
  }

  async function handleScan(e) {
    e.preventDefault()
    if (!scanCode.trim()) return
    setScanError(null)
    try {
      const product = await apiFetch(`/products/lookup?code=${encodeURIComponent(scanCode.trim())}`, {
        token,
      })
      if (product.sellingPrice === null || product.sellingPrice === undefined) {
        setScanError(t('pos.notSellable'))
        return
      }
      setScanCode('')
      await handleSelectProduct(product)
    } catch {
      setScanError(t('products.scanNotFound'))
    }
  }

  function updateQuantity(key, quantity) {
    setCart((prev) => prev.map((line) => (line.key === key ? { ...line, quantity } : line)))
  }

  function removeLine(key) {
    setCart((prev) => prev.filter((line) => line.key !== key))
  }

  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const tenderedNumber = amountTendered === '' ? null : Number(amountTendered)
  const changeDue =
    paymentMethod === 'cash' && tenderedNumber !== null && !Number.isNaN(tenderedNumber)
      ? tenderedNumber - total
      : null

  async function handleCheckout() {
    setCheckoutError(null)
    if (!locationId) {
      setCheckoutError(t('pos.selectBranchFirst'))
      return
    }
    if (cart.length === 0) return

    setCheckingOut(true)
    try {
      const body = {
        locationId: Number(locationId),
        items: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
          modifierOptionIds: line.modifierOptionIds,
        })),
        paymentMethod,
      }
      if (paymentMethod === 'cash' && amountTendered !== '') {
        body.amountTendered = Number(amountTendered)
      }
      if (note) body.note = note

      const sale = await apiFetch('/sales', { method: 'POST', body, token })
      setCompletedSale(sale)
      setCart([])
      setAmountTendered('')
      setNote('')
    } catch (err) {
      setCheckoutError(err.message)
    } finally {
      setCheckingOut(false)
    }
  }

  function handleNewSale() {
    setCompletedSale(null)
    setCheckoutError(null)
  }

  async function handleDownloadReceipt() {
    try {
      await downloadFile(`/sales/${completedSale.id}/receipt`, {
        token,
        filename: `receipt-${completedSale.id}.pdf`,
      })
    } catch (err) {
      setCheckoutError(err.message)
    }
  }

  if (completedSale) {
    return (
      <div className="centered">
        <div className="card">
          <h1>{t('pos.saleComplete')}</h1>
          <p>
            {t('pos.saleId')}: <strong>{completedSale.receiptNumber || `#${completedSale.id}`}</strong>
          </p>
          <p>
            {t('sales.branch')}: {completedSale.location.name}
          </p>
          <p>
            {t('sales.cashier')}: {completedSale.cashier.email}
          </p>
          <p>
            {t('sales.paymentMethod')}: {t(`pos.paymentMethod.${completedSale.paymentMethod}`)}
          </p>
          {completedSale.amountTendered !== null && (
            <p>
              {t('sales.amountTendered')}: {completedSale.amountTendered.toFixed(2)}
            </p>
          )}
          {completedSale.changeDue !== null && (
            <p>
              {t('sales.changeDue')}: {completedSale.changeDue.toFixed(2)}
            </p>
          )}
          {completedSale.taxAmount > 0 && (
            <p>
              {completedSale.taxInclusive
                ? t('pos.vatIncluded', { rate: (completedSale.taxRate * 100).toFixed(0) })
                : t('pos.vatAdded', { rate: (completedSale.taxRate * 100).toFixed(0) })}
              : {completedSale.taxAmount.toFixed(2)}
            </p>
          )}
          <p>
            {t('pos.total')}: <strong>{completedSale.total.toFixed(2)}</strong>
          </p>

          <table className="table">
            <thead>
              <tr>
                <th>{t('sales.product')}</th>
                <th>{t('sales.quantity')}</th>
                <th>{t('sales.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {completedSale.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.productName}
                    {item.modifiers.length > 0 && (
                      <div className="cart-line-modifiers">
                        {item.modifiers.map((m) => m.name).join(', ')}
                      </div>
                    )}
                  </td>
                  <td>{item.quantity}</td>
                  <td>{item.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {checkoutError && <p className="error">{checkoutError}</p>}

          <div className="actions">
            <button type="button" onClick={handleDownloadReceipt}>
              {t('pos.downloadReceipt')}
            </button>
            <button type="button" onClick={handleNewSale}>
              {t('pos.newSale')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1>{t('pos.title')}</h1>

      {locationsError && <p className="error">{locationsError}</p>}

      <label>
        {t('pos.branch')}
        <select
          value={locationId}
          onChange={(e) => handleLocationChange(e.target.value)}
          disabled={Boolean(lockedLocationId)}
        >
          <option value="">{t('pos.selectBranch')}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {lockedLocationId && <p className="hint">{t('pos.branchLockedToHome')}</p>}
      {locations.length === 0 && !locationsError && <p className="hint">{t('pos.noActiveBranches')}</p>}

      <form className="inline-form" onSubmit={handleScan}>
        <input
          type="text"
          placeholder={t('products.scanPlaceholder')}
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
        />
      </form>
      {scanError && <p className="error">{scanError}</p>}
      {gridError && <p className="error">{gridError}</p>}
      {checkoutError && <p className="error">{checkoutError}</p>}

      <div className="pos-layout">
        <ProductGrid
          products={sellableProducts}
          categories={categories}
          category={category}
          onCategoryChange={setCategory}
          search={search}
          onSearchChange={setSearch}
          onSelectProduct={handleSelectProduct}
          loading={productsLoading}
          t={t}
        />

        <div className="pos-cart-column">
          <CartPanel items={cart} onUpdateQuantity={updateQuantity} onRemove={removeLine} t={t} />

          <div className="card">
            <h2>{t('pos.paymentMethod')}</h2>
            <div className="payment-methods">
              {['cash', 'promptpay', 'card'].map((method) => (
                <button
                  type="button"
                  key={method}
                  className={paymentMethod === method ? 'selected' : ''}
                  onClick={() => setPaymentMethod(method)}
                >
                  {t(`pos.paymentMethod.${method}`)}
                </button>
              ))}
            </div>

            {paymentMethod === 'promptpay' && (
              <div className="promptpay-qr-panel">
                {selectedLocation?.promptPayQrUrl ? (
                  <>
                    <p>{t('pos.promptPayQrTitle')}</p>
                    <img
                      src={selectedLocation.promptPayQrUrl}
                      alt={t('pos.promptPayQrTitle')}
                      className="promptpay-qr-image"
                    />
                  </>
                ) : (
                  <>
                    <p className="error">{t('pos.promptPayQrMissing')}</p>
                    <p className="hint">{t('pos.promptPayQrMissingHint')}</p>
                  </>
                )}
              </div>
            )}

            {paymentMethod === 'cash' && (
              <label>
                {t('pos.amountTendered')}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountTendered}
                  onChange={(e) => setAmountTendered(e.target.value)}
                />
              </label>
            )}
            {changeDue !== null && (
              <p className={changeDue < 0 ? 'error' : 'notice'}>
                {t('pos.changeDue')}: {changeDue.toFixed(2)}
              </p>
            )}

            <label>
              {t('pos.note')}
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            <p className="cart-totals">
              <span>{t('pos.total')}</span>
              <span>{total.toFixed(2)}</span>
            </p>

            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkingOut || cart.length === 0 || !locationId}
            >
              {checkingOut ? t('pos.checkingOut') : t('pos.checkout')}
            </button>
          </div>
        </div>
      </div>

      {pendingProduct && (
        <ModifierPickerModal
          product={pendingProduct.product}
          groups={pendingProduct.groups}
          onConfirm={handleModifierConfirm}
          onCancel={() => setPendingProduct(null)}
          t={t}
        />
      )}
    </div>
  )
}
