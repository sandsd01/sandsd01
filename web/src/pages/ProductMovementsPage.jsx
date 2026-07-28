import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function ProductMovementsPage() {
  const { id } = useParams()
  const { token } = useAuth()

  const [product, setProduct] = useState(null)
  const [movements, setMovements] = useState([])
  const [type, setType] = useState('in')
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, m] = await Promise.all([
        apiFetch(`/products/${id}`, { token }),
        apiFetch(`/products/${id}/movements`, { token }),
      ])
      setProduct(p)
      setMovements(m)
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch(`/products/${id}/movements`, {
        method: 'POST',
        body: { type, quantity: Number(quantity), note: note || undefined },
        token,
      })
      setQuantity(1)
      setNote('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>Loading…</p>
  if (!product) return <p className="error">{error || 'Product not found'}</p>

  return (
    <div>
      <Link to="/">&larr; Back to products</Link>
      <h1>
        {product.name} <small>({product.sku})</small>
      </h1>
      <p>
        Current quantity: <strong>{product.quantity}</strong> {product.unit}
      </p>

      {error && <p className="error">{error}</p>}

      <form className="card inline-form" onSubmit={handleSubmit}>
        <h2>Record movement</h2>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="in">Stock in</option>
            <option value="out">Stock out</option>
          </select>
        </label>
        <label>
          Quantity
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <label>
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit">Submit</button>
      </form>

      <h2>History</h2>
      {movements.length === 0 ? (
        <p>No movements recorded yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td>{m.type}</td>
                <td>{m.quantity}</td>
                <td>{m.note || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
