import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function TrashPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [products, setProducts] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setProducts(await apiFetch('/products/trash', { token }))
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

  async function handleRestore(id) {
    try {
      await apiFetch(`/products/${id}/restore`, { method: 'POST', token })
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handlePermanentDelete(id, sku) {
    if (!window.confirm(t('trash.confirmPermanentDelete').replace('{sku}', sku))) return
    try {
      await apiFetch(`/products/${id}/permanent`, { method: 'DELETE', token })
      setProducts((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>

  return (
    <div>
      <h1>{t('trash.title')}</h1>
      {error && <p className="error">{error}</p>}

      {products.length === 0 ? (
        <p>{t('trash.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('products.sku')}</th>
              <th>{t('common.name')}</th>
              <th>{t('trash.deletedAt')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.sku}</td>
                <td>{p.name}</td>
                <td>{new Date(p.deletedAt).toLocaleString()}</td>
                <td className="actions">
                  <button onClick={() => handleRestore(p.id)}>{t('trash.restore')}</button>
                  <button onClick={() => handlePermanentDelete(p.id, p.sku)}>
                    {t('trash.permanentDelete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
