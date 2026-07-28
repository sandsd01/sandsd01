import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { MovementsChart } from '../components/MovementsChart'

export function ReportsPage() {
  const { token, user } = useAuth()
  const [summary, setSummary] = useState(null)
  const [timeseries, setTimeseries] = useState(null)
  const [error, setError] = useState(null)
  const [alertMessage, setAlertMessage] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/reports/summary', { token }),
      apiFetch('/reports/movements-timeseries?days=30', { token }),
    ])
      .then(([summaryData, timeseriesData]) => {
        setSummary(summaryData)
        setTimeseries(timeseriesData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSendAlert() {
    setAlertMessage(null)
    setError(null)
    try {
      const result = await apiFetch('/reports/send-low-stock-alert', { method: 'POST', token })
      if (result.sent) {
        setAlertMessage(`Alert email sent for ${result.count} low-stock product(s).`)
      } else if (result.reason === 'nothing_low') {
        setAlertMessage('Nothing is low on stock right now — no email sent.')
      } else {
        setAlertMessage(
          'Email not sent: alert email is not configured (set RESEND_API_KEY and ALERT_EMAIL_TO).'
        )
      }
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>Loading…</p>
  if (error) return <p className="error">{error}</p>
  if (!summary) return null

  return (
    <div>
      <div className="page-header">
        <h1>Reports</h1>
        {user?.role === 'admin' && <button onClick={handleSendAlert}>Send low-stock alert now</button>}
      </div>
      {alertMessage && <p className="notice">{alertMessage}</p>}

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{summary.totalProducts}</span>
          <span className="stat-label">Products</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.totalQuantity}</span>
          <span className="stat-label">Total units in stock</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.lowStockCount}</span>
          <span className="stat-label">Low on stock</span>
        </div>
      </div>

      <h2>Stock movements (last 30 days)</h2>
      {timeseries && <MovementsChart data={timeseries} />}

      <h2>Low stock products</h2>
      {summary.lowStockProducts.length === 0 ? (
        <p>Nothing is low on stock right now.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Quantity</th>
              <th>Reorder level</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {summary.lowStockProducts.map((p) => (
              <tr key={p.id} className="low-stock">
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.quantity}</td>
                <td>{p.reorderLevel}</td>
                <td>
                  <Link to={`/products/${p.id}/movements`}>Record movement</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent movements</h2>
      {summary.recentMovements.length === 0 ? (
        <p>No stock movements recorded yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {summary.recentMovements.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td>
                  {m.product.name} ({m.product.sku})
                </td>
                <td>{m.type}</td>
                <td>{m.quantity}</td>
                <td>{m.createdByEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
