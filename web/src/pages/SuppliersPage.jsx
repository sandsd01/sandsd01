import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function SuppliersPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [suppliers, setSuppliers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setSuppliers(await apiFetch('/suppliers', { token }))
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
      await apiFetch('/suppliers', {
        method: 'POST',
        body: { name, contactEmail: contactEmail || undefined, contactPhone: contactPhone || undefined },
        token,
      })
      setName('')
      setContactEmail('')
      setContactPhone('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this supplier? Products linked to it will be unlinked.')) return
    try {
      await apiFetch(`/suppliers/${id}`, { method: 'DELETE', token })
      setSuppliers((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>

  return (
    <div>
      <h1>{t('suppliers.title')}</h1>
      {error && <p className="error">{error}</p>}

      <form className="card inline-form" onSubmit={handleCreate}>
        <h2>{t('suppliers.addSupplier')}</h2>
        <label>
          {t('common.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          {t('suppliers.contactEmail')}
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </label>
        <label>
          {t('suppliers.contactPhone')}
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <button type="submit">{t('suppliers.addSupplier')}</button>
      </form>

      {suppliers.length === 0 ? (
        <p>{t('products.noneFound')}</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('suppliers.contactEmail')}</th>
                <th>{t('suppliers.contactPhone')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.contactEmail || '-'}</td>
                  <td>{s.contactPhone || '-'}</td>
                  <td className="actions">
                    <button onClick={() => handleDelete(s.id)}>{t('common.delete')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
