import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function ProductsPage() {
  const { token, user } = useAuth()
  const [products, setProducts] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function loadProducts() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/products', { token })
      setProducts(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDelete(id) {
    if (!window.confirm('Delete this product?')) return
    try {
      await apiFetch(`/products/${id}`, { method: 'DELETE', token })
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>Loading…</p>

  return (
    <div>
      <div className="page-header">
        <h1>Products</h1>
        {user?.role === 'admin' && <Link to="/products/new" className="button">+ Add product</Link>}
      </div>
      {error && <p className="error">{error}</p>}
      {products.length === 0 ? (
        <p>No products yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Unit</th>
              <th>Quantity</th>
              <th>Reorder level</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={p.quantity <= p.reorderLevel ? 'low-stock' : ''}>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.unit}</td>
                <td>{p.quantity}</td>
                <td>{p.reorderLevel}</td>
                <td className="actions">
                  <Link to={`/products/${p.id}/movements`}>Record movement</Link>
                  {user?.role === 'admin' && (
                    <>
                      <Link to={`/products/${p.id}/edit`}>Edit</Link>
                      <button onClick={() => handleDelete(p.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
