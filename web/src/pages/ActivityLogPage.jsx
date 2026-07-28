import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

const PAGE_SIZE = 20

export function ActivityLogPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch(`/reports/activity-log?page=${page}&pageSize=${PAGE_SIZE}`, { token })
      .then((result) => {
        setEntries(result.data)
        setTotal(result.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (loading) return <p>{t('common.loading')}</p>
  if (error) return <p className="error">{error}</p>

  return (
    <div>
      <h1>{t('activityLog.title')}</h1>

      {entries.length === 0 ? (
        <p>{t('products.noneFound')}</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>{t('activityLog.time')}</th>
                <th>{t('activityLog.user')}</th>
                <th>{t('activityLog.action')}</th>
                <th>{t('activityLog.entity')}</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.userEmail}</td>
                  <td>{e.action}</td>
                  <td>
                    {e.entityType}
                    {e.entityId ? ` #${e.entityId}` : ''}
                  </td>
                  <td>{e.details ? JSON.stringify(e.details) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('products.prev')}
            </button>
            <span>
              {t('products.page')} {page} {t('products.of')} {totalPages} ({total})
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('products.next')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
