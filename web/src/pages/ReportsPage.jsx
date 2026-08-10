import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, downloadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { MovementsChart } from '../components/MovementsChart'

export function ReportsPage() {
  const { token, user } = useAuth()
  const { t } = useLanguage()
  const isAdmin = user?.role === 'admin'
  const [summary, setSummary] = useState(null)
  const [timeseries, setTimeseries] = useState(null)
  const [salesSummary, setSalesSummary] = useState(null)
  const [salesLocationId, setSalesLocationId] = useState('')
  const [locations, setLocations] = useState([])
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiFetch('/reports/summary', { token }),
      apiFetch('/reports/movements-timeseries?days=30', { token }),
      apiFetch('/reports/sales-summary', { token }),
    ])
      .then(([summaryData, timeseriesData, salesSummaryData]) => {
        setSummary(summaryData)
        setTimeseries(timeseriesData)
        setSalesSummary(salesSummaryData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    if (isAdmin) {
      apiFetch('/locations', { token })
        .then(setLocations)
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (!isAdmin) return
    const params = new URLSearchParams()
    if (salesLocationId) params.set('locationId', salesLocationId)
    apiFetch(`/reports/sales-summary?${params.toString()}`, { token })
      .then(setSalesSummary)
      .catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesLocationId])

  async function handleSendAlert() {
    setMessage(null)
    setError(null)
    try {
      const result = await apiFetch('/reports/send-low-stock-alert', { method: 'POST', token })
      if (result.sent) {
        setMessage(`Alert email sent for ${result.count} low-stock product(s).`)
      } else if (result.reason === 'nothing_low') {
        setMessage('Nothing is low on stock right now — no email sent.')
      } else {
        setMessage('Email not sent: alert email is not configured (set RESEND_API_KEY and ALERT_EMAIL_TO).')
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSendDailySummary() {
    setMessage(null)
    setError(null)
    try {
      const result = await apiFetch('/reports/send-daily-summary', { method: 'POST', token })
      setMessage(
        result.sent
          ? 'Daily summary email sent.'
          : 'Email not sent: alert email is not configured (set RESEND_API_KEY and ALERT_EMAIL_TO).'
      )
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleExportPdf() {
    setError(null)
    try {
      await downloadFile('/reports/summary/pdf', { token, filename: 'inventory-summary.pdf' })
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>
  if (error) return <p className="error">{error}</p>
  if (!summary) return null

  return (
    <div>
      <div className="page-header">
        <h1>{t('reports.title')}</h1>
        <div className="actions">
          <button onClick={handleExportPdf}>{t('reports.exportPdf')}</button>
          {user?.role === 'admin' && (
            <>
              <button onClick={handleSendAlert}>{t('reports.sendAlert')}</button>
              <button onClick={handleSendDailySummary}>{t('reports.sendDailySummary')}</button>
            </>
          )}
        </div>
      </div>
      {message && <p className="notice">{message}</p>}

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{summary.totalProducts}</span>
          <span className="stat-label">{t('reports.products')}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.totalQuantity}</span>
          <span className="stat-label">{t('reports.totalUnits')}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.totalValue.toFixed(2)}</span>
          <span className="stat-label">{t('reports.totalValue')}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{summary.lowStockCount}</span>
          <span className="stat-label">{t('reports.lowOnStock')}</span>
        </div>
      </div>

      <h2>{t('reports.chartTitle')}</h2>
      {timeseries && <MovementsChart data={timeseries} />}

      <h2>{t('reports.lowStockProducts')}</h2>
      {summary.lowStockProducts.length === 0 ? (
        <p>{t('reports.nothingLow')}</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('products.sku')}</th>
                <th>{t('common.name')}</th>
                <th>{t('products.quantity')}</th>
                <th>{t('products.reorderLevel')}</th>
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
                    <Link to={`/products/${p.id}/movements`}>{t('products.recordMovement')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{t('reports.recentMovements')}</h2>
      {summary.recentMovements.length === 0 ? (
        <p>{t('reports.noMovements')}</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('movements.date')}</th>
                <th>{t('common.name')}</th>
                <th>{t('movements.type.col')}</th>
                <th>{t('movements.quantity')}</th>
                <th>{t('activityLog.user')}</th>
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
        </div>
      )}

      <h2>{t('reports.salesTitle')}</h2>
      {isAdmin && (
        <label>
          {t('sales.branch')}
          <select value={salesLocationId} onChange={(e) => setSalesLocationId(e.target.value)}>
            <option value="">{t('sales.allBranches')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {salesSummary && (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <span className="stat-value">{salesSummary.totalRevenue.toFixed(2)}</span>
              <span className="stat-label">{t('reports.totalRevenue')}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{salesSummary.totalSaleCount}</span>
              <span className="stat-label">{t('reports.saleCount')}</span>
            </div>
          </div>

          {isAdmin && salesSummary.revenueByLocation.length > 0 && (
            <>
              <h3>{t('reports.revenueByBranch')}</h3>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('reports.branch')}</th>
                      <th>{t('reports.revenue')}</th>
                      <th>{t('sales.title')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesSummary.revenueByLocation.map((l) => (
                      <tr key={l.locationId}>
                        <td>{l.name}</td>
                        <td>{l.revenue.toFixed(2)}</td>
                        <td>{l.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h3>{t('reports.topProducts')}</h3>
          {salesSummary.topProducts.length === 0 ? (
            <p>{t('reports.noSales')}</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('products.sku')}</th>
                    <th>{t('common.name')}</th>
                    <th>{t('reports.quantitySold')}</th>
                    <th>{t('reports.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {salesSummary.topProducts.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.product?.sku ?? '-'}</td>
                      <td>{p.product?.name ?? '-'}</td>
                      <td>{p.quantitySold}</td>
                      <td>{p.revenue.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
