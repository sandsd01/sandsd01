import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function PurchaseOrderFormPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ productId: '', quantityOrdered: 1, unitCost: '' }])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/suppliers', { token }),
      apiFetch('/products?pageSize=100', { token }),
    ])
      .then(([supplierList, productPage]) => {
        setSuppliers(supplierList)
        setProducts(productPage.data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  function updateItem(index, field, value) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  function addItem() {
    setItems((prev) => [...prev, { productId: '', quantityOrdered: 1, unitCost: '' }])
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    try {
      const order = await apiFetch('/purchase-orders', {
        method: 'POST',
        body: {
          supplierId: Number(supplierId),
          notes: notes || undefined,
          items: items.map((item) => ({
            productId: Number(item.productId),
            quantityOrdered: Number(item.quantityOrdered),
            unitCost: item.unitCost === '' ? undefined : Number(item.unitCost),
          })),
        },
        token,
      })
      navigate(`/purchase-orders/${order.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>

  return (
    <div className="centered">
      <form className="card" onSubmit={handleSubmit}>
        <h1>{t('po.new')}</h1>
        {error && <p className="error">{error}</p>}

        <label>
          {t('po.supplier')}
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="" disabled>
              {t('po.supplier')}
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t('po.notes')}
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <h2>{t('po.items')}</h2>
        {items.map((item, index) => (
          <div key={index} className="page-header">
            <label>
              {t('po.product')}
              <select
                value={item.productId}
                onChange={(e) => updateItem(index, 'productId', e.target.value)}
                required
              >
                <option value="" disabled>
                  {t('po.product')}
                </option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} - {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('po.quantityOrdered')}
              <input
                type="number"
                min="1"
                value={item.quantityOrdered}
                onChange={(e) => updateItem(index, 'quantityOrdered', e.target.value)}
                required
              />
            </label>
            <label>
              {t('po.unitCost')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={item.unitCost}
                onChange={(e) => updateItem(index, 'unitCost', e.target.value)}
              />
            </label>
            {items.length > 1 && (
              <button type="button" onClick={() => removeItem(index)}>
                {t('po.remove')}
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addItem}>
          {t('po.addItem')}
        </button>

        <button type="submit">{t('po.create')}</button>
      </form>
    </div>
  )
}
