import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

const PAGE_SIZE = 20

export function SalesHistoryPage() {
  const { token, user } = useAuth()
  const { t } = useLanguage()
  const isAdmin = user?.role === 'admin'

  const [sales, setSales] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) return
    apiFetch('/locations', { token })
      .then(setLocations)
      .catch(() => {})
  }, [isAdmin, token])

  async function loadSales() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (status) params.set('status', status)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (isAdmin && locationId) params.set('locationId', locationId)

      const result = await apiFetch(`/sales?${params.toString()}`, { token })
      setSales(result.data)
      setTotal(result.total)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSales()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, from, to, locationId])

  useEffect(() => {
    setPage(1)
  }, [status, from, to, locationId])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const yourBranchName = !isAdmin && sales.length > 0 ? sales[0].location.name : null

  return (
    <div>
      <h1>{t('sales.title')}</h1>
      {error && <p className="error">{error}</p>}
      {yourBranchName && (
        <p className="hint">
          {t('sales.yourBranch')}: {yourBranchName}
        </p>
      )}

      <div className="filter-row">
        <label>
          {t('sales.status')}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('po.allStatuses')}</option>
            <option value="completed">{t('sales.status.completed')}</option>
            <option value="voided">{t('sales.status.voided')}</option>
          </select>
        </label>
        <label>
          {t('sales.from')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('sales.to')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {isAdmin && (
          <label>
            {t('sales.branch')}
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('sales.allBranches')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : sales.length === 0 ? (
        <p>{t('sales.noneFound')}</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>{t('sales.id')}</th>
                <th>{t('sales.date')}</th>
                <th>{t('sales.branch')}</th>
                <th>{t('sales.cashier')}</th>
                <th>{t('sales.total')}</th>
                <th>{t('sales.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td>#{s.id}</td>
                  <td>{new Date(s.createdAt).toLocaleString()}</td>
                  <td>{s.location.name}</td>
                  <td>{s.cashier.email}</td>
                  <td>{s.total.toFixed(2)}</td>
                  <td>
                    <span className={`status-badge ${s.status}`}>{t(`sales.status.${s.status}`)}</span>
                  </td>
                  <td>
                    <Link to={`/sales/${s.id}`}>{t('sales.view')}</Link>
                  </td>
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
