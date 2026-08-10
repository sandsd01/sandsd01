import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, downloadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function SaleDetailPage() {
  const { id } = useParams()
  const { token, user } = useAuth()
  const { t } = useLanguage()

  const [sale, setSale] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setSale(await apiFetch(`/sales/${id}`, { token }))
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

  async function handleVoid() {
    const reason = window.prompt(t('sales.voidReasonPrompt'))
    if (!reason) return
    setError(null)
    try {
      await apiFetch(`/sales/${id}/void`, { method: 'POST', body: { reason }, token })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDownloadReceipt() {
    setError(null)
    try {
      await downloadFile(`/sales/${id}/receipt`, { token, filename: `receipt-${id}.pdf` })
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>
  if (!sale) return <p className="error">{error || 'Sale not found'}</p>

  return (
    <div>
      <Link to="/sales">{t('sales.back')}</Link>
      <div className="page-header">
        <h1>
          {t('sales.detailTitle')} #{sale.id}{' '}
          <span className={`status-badge ${sale.status}`}>{t(`sales.status.${sale.status}`)}</span>
        </h1>
        <div className="actions">
          <button onClick={handleDownloadReceipt}>{t('sales.downloadReceipt')}</button>
          {user?.role === 'admin' && sale.status !== 'voided' && (
            <button onClick={handleVoid}>{t('sales.void')}</button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <p>
        {t('sales.date')}: {new Date(sale.createdAt).toLocaleString()}
      </p>
      <p>
        {t('sales.branch')}: {sale.location.name}
      </p>
      <p>
        {t('sales.cashier')}: {sale.cashier.email}
      </p>
      <p>
        {t('sales.paymentMethod')}: {t(`pos.paymentMethod.${sale.paymentMethod}`)}
      </p>
      {sale.amountTendered !== null && (
        <p>
          {t('sales.amountTendered')}: {sale.amountTendered.toFixed(2)}
        </p>
      )}
      {sale.changeDue !== null && (
        <p>
          {t('sales.changeDue')}: {sale.changeDue.toFixed(2)}
        </p>
      )}
      {sale.note && (
        <p>
          {t('sales.note')}: {sale.note}
        </p>
      )}
      {sale.status === 'voided' && (
        <>
          <p>
            {t('sales.voidedAt')}: {sale.voidedAt ? new Date(sale.voidedAt).toLocaleString() : '-'}
          </p>
          <p>
            {t('sales.voidedBy')}: {sale.voidedBy?.email || '-'}
          </p>
        </>
      )}

      <h2>{t('sales.items')}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>{t('sales.product')}</th>
            <th>{t('sales.modifiers')}</th>
            <th>{t('sales.unitPrice')}</th>
            <th>{t('sales.quantity')}</th>
            <th>{t('sales.lineTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td>{item.productName}</td>
              <td>{item.modifiers.length > 0 ? item.modifiers.map((m) => m.name).join(', ') : '-'}</td>
              <td>{item.unitPrice.toFixed(2)}</td>
              <td>{item.quantity}</td>
              <td>{item.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="cart-totals">
        <span>{t('pos.total')}</span>
        <span>{sale.total.toFixed(2)}</span>
      </p>
    </div>
  )
}
