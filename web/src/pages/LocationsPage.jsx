import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function LocationsPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [locations, setLocations] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setLocations(await apiFetch('/locations', { token }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch('/locations', { method: 'POST', body: { name }, token })
      setName('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm(t('locations.confirmDelete'))) return
    try {
      await apiFetch(`/locations/${id}`, { method: 'DELETE', token })
      setLocations((prev) => prev.filter((l) => l.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>

  return (
    <div>
      <h1>{t('locations.title')}</h1>
      {error && <p className="error">{error}</p>}

      <form className="card inline-form" onSubmit={handleCreate}>
        <h2>{t('locations.addLocation')}</h2>
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit">{t('locations.addLocation')}</button>
      </form>

      {locations.length === 0 ? (
        <p>{t('products.noneFound')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td className="actions">
                  <button onClick={() => handleDelete(l.id)}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
