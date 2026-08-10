import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function PurchaseOrderDetailPage() {
  const { id } = useParams()
  const { token } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const [order, setOrder] = useState(null)
  const [locations, setLocations] = useState([])
  const [receiveQuantities, setReceiveQuantities] = useState({})
  const [receiveLocationId, setReceiveLocationId] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [o, locs] = await Promise.all([
        apiFetch(`/purchase-orders/${id}`, { token }),
        apiFetch('/locations', { token }),
      ])
      setOrder(o)
      setLocations(locs)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleMarkOrdered() {
    setError(null)
    try {
      await apiFetch(`/purchase-orders/${id}/mark-ordered`, { method: 'POST', token })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleCancel() {
    if (!window.confirm(t('po.confirmCancel'))) return
    setError(null)
    try {
      await apiFetch(`/purchase-orders/${id}/cancel`, { method: 'POST', token })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('po.confirmDelete'))) return
    setError(null)
    try {
      await apiFetch(`/purchase-orders/${id}`, { method: 'DELETE', token })
      navigate('/purchase-orders')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleReceive(e) {
    e.preventDefault()
    setError(null)
    const receiptItems = Object.entries(receiveQuantities)
      .map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity: Number(quantity) }))
      .filter((entry) => entry.quantity > 0)

    if (receiptItems.length === 0) return

    try {
      await apiFetch(`/purchase-orders/${id}/receive`, {
        method: 'POST',
        body: { items: receiptItems, locationId: receiveLocationId || undefined },
        token,
      })
      setReceiveQuantities({})
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>
  if (!order) return <p className="error">{error || 'Purchase order not found'}</p>

  const canReceive = order.status === 'ordered' || order.status === 'partially_received'

  return (
    <div>
      <Link to="/purchase-orders">{t('po.back')}</Link>
      <h1>
        PO-{order.id} <small>({t(`po.status.${order.status}`)})</small>
      </h1>
      {error && <p className="error">{error}</p>}

      <p>
        {t('po.supplier')}: <strong>{order.supplier.name}</strong>
      </p>
      {order.notes && (
        <p>
          {t('po.notes')}: {order.notes}
        </p>
      )}
      {order.orderedAt && (
        <p>
          {t('po.orderedAt')}: {new Date(order.orderedAt).toLocaleString()}
        </p>
      )}
      {order.receivedAt && (
        <p>
          {t('po.receivedAt')}: {new Date(order.receivedAt).toLocaleString()}
        </p>
      )}
      {order.cancelledAt && (
        <p>
          {t('po.cancelledAt')}: {new Date(order.cancelledAt).toLocaleString()}
        </p>
      )}

      <div className="actions">
        {order.status === 'draft' && (
          <>
            <button onClick={handleMarkOrdered}>{t('po.markOrdered')}</button>
            <button onClick={handleDelete}>{t('po.deleteDraft')}</button>
          </>
        )}
        {order.status === 'ordered' && <button onClick={handleCancel}>{t('po.cancel')}</button>}
      </div>

      <h2>{t('po.items')}</h2>
      <form onSubmit={handleReceive}>
        {canReceive && (
          <label>
            {t('po.receiveLocation')}
            <select value={receiveLocationId} onChange={(e) => setReceiveLocationId(e.target.value)}>
              <option value="">{t('movements.noLocation')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('products.sku')}</th>
                <th>{t('common.name')}</th>
                <th>{t('po.quantityOrdered')}</th>
                <th>{t('po.quantityReceived')}</th>
                <th>{t('po.remaining')}</th>
                <th>{t('po.unitCost')}</th>
                {canReceive && <th>{t('po.receive')}</th>}
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => {
                const remaining = item.quantityOrdered - item.quantityReceived
                return (
                  <tr key={item.id}>
                    <td>{item.product.sku}</td>
                    <td>{item.product.name}</td>
                    <td>{item.quantityOrdered}</td>
                    <td>{item.quantityReceived}</td>
                    <td>{remaining}</td>
                    <td>{item.unitCost ?? '-'}</td>
                    {canReceive && (
                      <td>
                        {remaining > 0 && (
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            value={receiveQuantities[item.id] ?? ''}
                            onChange={(e) =>
                              setReceiveQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                          />
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {canReceive && <button type="submit">{t('po.receiveStock')}</button>}
      </form>
    </div>
  )
}
