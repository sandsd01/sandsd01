import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

const STATUSES = ['draft', 'ordered', 'partially_received', 'received', 'cancelled']

export function PurchaseOrdersPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [orders, setOrders] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      const result = await apiFetch(`/purchase-orders?${params.toString()}`, { token })
      setOrders(result.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return (
    <div>
      <div className="page-header">
        <h1>{t('po.title')}</h1>
        <Link to="/purchase-orders/new">
          <button>{t('po.new')}</button>
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      <label>
        {t('po.status')}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('po.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`po.status.${s}`)}
            </option>
          ))}
        </select>
      </label>

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : orders.length === 0 ? (
        <p>{t('po.noneFound')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('po.supplier')}</th>
              <th>{t('po.status')}</th>
              <th>{t('po.items')}</th>
              <th>{t('po.createdAt')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link to={`/purchase-orders/${o.id}`}>PO-{o.id}</Link>
                </td>
                <td>{o.supplier.name}</td>
                <td>{t(`po.status.${o.status}`)}</td>
                <td>{o.items.length}</td>
                <td>{new Date(o.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
