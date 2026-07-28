import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, downloadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'

const PAGE_SIZE = 10

export function ProductsPage() {
  const { token, user } = useAuth()
  const [products, setProducts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [lowStockCount, setLowStockCount] = useState(0)
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

  async function handleDelete(id) {
    if (!window.confirm('Delete this product?')) return
    try {
      await apiFetch(`/products/${id}`, { method: 'DELETE', token })
      await loadProducts()
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <div className="page-header">
        <h1>Products</h1>
        <div className="actions">
          <button onClick={handleExport}>Export CSV</button>
          {user?.role === 'admin' && (
            <>
              <button onClick={handleImportClick}>Import CSV</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportFile}
                style={{ display: 'none' }}
              />
              <Link to="/products/new" className="button">+ Add product</Link>
            </>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {importMessage && <p className="notice">{importMessage}</p>}

      {lowStockCount > 0 && (
        <p className="warning">
          ⚠ {lowStockCount} product{lowStockCount > 1 ? 's are' : ' is'} at or below reorder level.
          See the <Link to="/reports">Reports</Link> page for details.
        </p>
      )}

      <div className="filter-row">
        <input
          type="search"
          placeholder="Search by SKU or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : products.length === 0 ? (
        <p>No products found.</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('sku')}>
                  SKU{sortIndicator('sku')}
                </th>
                <th className="sortable" onClick={() => toggleSort('name')}>
                  Name{sortIndicator('name')}
                </th>
                <th className="sortable" onClick={() => toggleSort('category')}>
                  Category{sortIndicator('category')}
                </th>
                <th>Unit</th>
                <th className="sortable" onClick={() => toggleSort('quantity')}>
                  Quantity{sortIndicator('quantity')}
                </th>
                <th className="sortable" onClick={() => toggleSort('reorderLevel')}>
                  Reorder level{sortIndicator('reorderLevel')}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.quantity <= p.reorderLevel ? 'low-stock' : ''}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category || '-'}</td>
                  <td>{p.unit}</td>
                  <td>{p.quantity}</td>
                  <td>{p.reorderLevel}</td>
                  <td className="actions">
                    <Link to={`/products/${p.id}/movements`}>Record movement</Link>
                    {user?.role === 'admin' && (
                      <>
                        <Link to={`/products/${p.id}/edit`}>Edit</Link>
                        <button onClick={() => handleDelete(p.id)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              &larr; Prev
            </button>
            <span>
              Page {page} of {totalPages} ({total} products)
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next &rarr;
            </button>
          </div>
        </>
      )}
    </div>
  )
}
