import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function ProductFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { token } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ sku: '', name: '', unit: '', category: '', reorderLevel: 0 })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    apiFetch(`/products/${id}`, { token })
      .then((p) =>
        setForm({
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          category: p.category || '',
          reorderLevel: p.reorderLevel,
        })
      )
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit, token])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    try {
      const payload = { ...form, reorderLevel: Number(form.reorderLevel) }
      if (isEdit) {
        await apiFetch(`/products/${id}`, { method: 'PATCH', body: payload, token })
      } else {
        await apiFetch('/products', { method: 'POST', body: payload, token })
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>Loading…</p>

  return (
    <div className="centered">
      <form className="card" onSubmit={handleSubmit}>
        <h1>{isEdit ? 'Edit product' : 'Add product'}</h1>
        {error && <p className="error">{error}</p>}
        <label>
          SKU
          <input value={form.sku} onChange={(e) => handleChange('sku', e.target.value)} required />
        </label>
        <label>
          Name
          <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
        </label>
        <label>
          Unit
          <input value={form.unit} onChange={(e) => handleChange('unit', e.target.value)} required />
        </label>
        <label>
          Category
          <input value={form.category} onChange={(e) => handleChange('category', e.target.value)} />
        </label>
        <label>
          Reorder level
          <input
            type="number"
            min="0"
            value={form.reorderLevel}
            onChange={(e) => handleChange('reorderLevel', e.target.value)}
          />
        </label>
        <button type="submit">{isEdit ? 'Save changes' : 'Create product'}</button>
      </form>
    </div>
  )
}
