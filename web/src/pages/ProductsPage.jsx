import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch, downloadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

const PAGE_SIZE = 10

export function ProductsPage() {
  const { token, user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [scanCode, setScanCode] = useState('')
  const [products, setProducts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [lowStockCount, setLowStockCount] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [error, setError] = useState(null)
  const [importMessage, setImportMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef(null)

  async function loadProducts() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortBy,
        sortDir,
      })
      if (search) params.set('search', search)
      if (category) params.set('category', category)

      const [result, summary] = await Promise.all([
        apiFetch(`/products?${params.toString()}`, { token }),
        apiFetch('/reports/summary', { token }),
      ])
      setProducts(result.data)
      setTotal(result.total)
      setLowStockCount(summary.lowStockCount)
      setSelected(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    apiFetch('/products/categories', { token })
      .then(setCategories)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadProducts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, category, sortBy, sortDir])

  useEffect(() => {
    setPage(1)
  }, [search, category])

  function toggleSort(field) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  function sortIndicator(field) {
    if (sortBy !== field) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === products.length ? new Set() : new Set(products.map((p) => p.id))))
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this product?')) return
    try {
      await apiFetch(`/products/${id}`, { method: 'DELETE', token })
      await loadProducts()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selected.size} selected product(s)?`)) return
    try {
      await apiFetch('/products/bulk-delete', {
        method: 'POST',
        body: { ids: Array.from(selected) },
        token,
      })
      await loadProducts()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBulkCategory() {
    const value = window.prompt('Set category for selected products to:')
    if (value === null) return
    try {
      await apiFetch('/products/bulk-category', {
        method: 'POST',
        body: { ids: Array.from(selected), category: value },
        token,
      })
      await loadProducts()
      const cats = await apiFetch('/products/categories', { token })
      setCategories(cats)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleExport() {
    try {
      await downloadFile('/products/export', { token, filename: 'products.csv' })
    } catch (err) {
      setError(err.message)
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImportMessage(null)
    setError(null)
    try {
      const csv = await file.text()
      const result = await apiFetch('/products/import', { method: 'POST', body: { csv }, token })
      setImportMessage(
        `Imported: ${result.created} created, ${result.updated} updated` +
          (result.errors.length > 0 ? `, ${result.errors.length} row(s) skipped with errors` : '')
      )
      await loadProducts()
      const cats = await apiFetch('/products/categories', { token })
      setCategories(cats)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleScan(e) {
    e.preventDefault()
    if (!scanCode.trim()) return
    setError(null)
    try {
      const product = await apiFetch(`/products/lookup?code=${encodeURIComponent(scanCode.trim())}`, {
        token,
      })
      setScanCode('')
      navigate(`/products/${product.id}/movements`)
    } catch {
      setError(t('products.scanNotFound'))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const isAdmin = user?.role === 'admin'

  return (
    <div>
      <div className="page-header">
        <h1>{t('products.title')}</h1>
        <div className="actions">
          <button onClick={handleExport}>{t('products.exportCsv')}</button>
          {isAdmin && (
            <>
              <button onClick={handleImportClick}>{t('products.importCsv')}</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportFile}
                style={{ display: 'none' }}
              />
              <Link to="/products/new" className="button">
                {t('products.addProduct')}
              </Link>
            </>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {importMessage && <p className="notice">{importMessage}</p>}

      <form className="inline-form" onSubmit={handleScan}>
        <input
          type="text"
          placeholder={t('products.scanPlaceholder')}
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
          autoFocus
        />
      </form>

      {lowStockCount > 0 && (
        <p className="warning">
          ⚠ {lowStockCount} {t('products.lowStockWarning')} <Link to="/reports">{t('nav.reports')}</Link>
        </p>
      )}

      <div className="filter-row">
        <input
          type="search"
          placeholder={t('products.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('products.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {isAdmin && selected.size > 0 && (
        <div className="bulk-bar">
          <span>
            {selected.size} {t('products.selected')}
          </span>
          <button onClick={handleBulkDelete}>{t('products.deleteSelected')}</button>
          <button onClick={handleBulkCategory}>{t('products.setCategoryForSelected')}</button>
        </div>
      )}

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : products.length === 0 ? (
        <p>{t('products.noneFound')}</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                {isAdmin && (
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === products.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th></th>
                <th className="sortable" onClick={() => toggleSort('sku')}>
                  {t('products.sku')}
                  {sortIndicator('sku')}
                </th>
                <th className="sortable" onClick={() => toggleSort('name')}>
                  {t('common.name')}
                  {sortIndicator('name')}
                </th>
                <th className="sortable" onClick={() => toggleSort('category')}>
                  {t('products.category')}
                  {sortIndicator('category')}
                </th>
                <th>{t('products.unit')}</th>
                <th className="sortable" onClick={() => toggleSort('quantity')}>
                  {t('products.quantity')}
                  {sortIndicator('quantity')}
                </th>
                <th className="sortable" onClick={() => toggleSort('reorderLevel')}>
                  {t('products.reorderLevel')}
                  {sortIndicator('reorderLevel')}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.quantity <= p.reorderLevel ? 'low-stock' : ''}>
                  {isAdmin && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelected(p.id)}
                      />
                    </td>
                  )}
                  <td>
                    {p.imageUrl && <img src={p.imageUrl} alt={p.name} className="thumb" />}
                  </td>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category || '-'}</td>
                  <td>{p.unit}</td>
                  <td>{p.quantity}</td>
                  <td>{p.reorderLevel}</td>
                  <td className="actions">
                    <Link to={`/products/${p.id}/movements`}>{t('products.recordMovement')}</Link>
                    {isAdmin && (
                      <>
                        <Link to={`/products/${p.id}/edit`}>{t('common.edit')}</Link>
                        <button onClick={() => handleDelete(p.id)}>{t('common.delete')}</button>
                      </>
                    )}
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
