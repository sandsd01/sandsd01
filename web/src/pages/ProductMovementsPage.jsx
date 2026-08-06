import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, downloadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function ProductMovementsPage() {
  const { id } = useParams()
  const { token, user } = useAuth()
  const { t } = useLanguage()

  const [product, setProduct] = useState(null)
  const [movements, setMovements] = useState([])
  const [byLocation, setByLocation] = useState([])
  const [locations, setLocations] = useState([])
  const [type, setType] = useState('in')
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, m, bl, locs] = await Promise.all([
        apiFetch(`/products/${id}`, { token }),
        apiFetch(`/products/${id}/movements`, { token }),
        apiFetch(`/products/${id}/movements/by-location`, { token }),
        apiFetch('/locations', { token }),
      ])
      setProduct(p)
      setMovements(m)
      setByLocation(bl)
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

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch(`/products/${id}/movements`, {
        method: 'POST',
        body: {
          type,
          quantity: Number(quantity),
          note: note || undefined,
          locationId: locationId || undefined,
        },
        token,
      })
      setQuantity(1)
      setNote('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleExport() {
    try {
      await downloadFile(`/products/${id}/movements/export`, {
        token,
        filename: `${product.sku}-movements.csv`,
      })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDeleteMovement(movementId) {
    if (!window.confirm('Delete this movement? This will reverse its effect on the quantity.')) return
    try {
      await apiFetch(`/products/${id}/movements/${movementId}`, { method: 'DELETE', token })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>
  if (!product) return <p className="error">{error || 'Product not found'}</p>

  return (
    <div>
      <Link to="/">{t('movements.back')}</Link>
      <h1>
        {product.name} <small>({product.sku})</small>
      </h1>
      <p>
        {t('movements.currentQuantity')}: <strong>{product.quantity}</strong> {product.unit}
      </p>

      {error && <p className="error">{error}</p>}

      <form className="card inline-form" onSubmit={handleSubmit}>
        <h2>{t('movements.recordMovement')}</h2>
        <label>
          {t('movements.type')}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="in">{t('movements.stockIn')}</option>
            <option value="out">{t('movements.stockOut')}</option>
          </select>
        </label>
        <label>
          {t('movements.quantity')}
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <label>
          {t('movements.location')}
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('movements.noLocation')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('movements.note')}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit">{t('movements.submit')}</button>
      </form>

      {byLocation.length > 0 && (
        <>
          <h2>{t('movements.byLocation')}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t('movements.location')}</th>
                <th>{t('products.quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {byLocation.map((l) => (
                <tr key={l.locationId ?? 'unassigned'}>
                  <td>{l.name}</td>
                  <td>{l.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="page-header">
        <h2>{t('movements.history')}</h2>
        {movements.length > 0 && <button onClick={handleExport}>{t('products.exportCsv')}</button>}
      </div>
      {movements.length === 0 ? (
        <p>{t('movements.none')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('movements.date')}</th>
              <th>{t('movements.type.col')}</th>
              <th>{t('movements.quantity')}</th>
              <th>{t('movements.location')}</th>
              <th>{t('movements.note')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td>{m.type}</td>
                <td>{m.quantity}</td>
                <td>{m.location?.name || t('movements.noLocation')}</td>
                <td>{m.note || '-'}</td>
                <td>
                  {user?.role === 'admin' && (
                    <button onClick={() => handleDeleteMovement(m.id)}>{t('common.delete')}</button>
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
