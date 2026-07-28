import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function ReportsPage() {
  const { token } = useAuth()
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/reports/summary', { token })
      .then(setSummary)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <p>Loading…</p>
  if (error) return <p className="error">{error}</p>
  if (!summary) return null

  return (
    <div>
      <h1>Reports</h1>

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
