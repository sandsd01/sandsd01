// Grid of sellable products (must have a sellingPrice) for the POS screen,
// filterable by search/category. Presentational only — the caller decides what
// happens on click (usually: fetch modifier groups, then either open
// ModifierPickerModal or add straight to the cart).
export function ProductGrid({
  products,
  categories,
  category,
  onCategoryChange,
  search,
  onSearchChange,
  onSelectProduct,
  loading,
  t,
}) {
  return (
    <div className="pos-products">
      <div className="filter-row">
        <input
          type="search"
          placeholder={t('products.search')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="search-input"
        />
        <select value={category} onChange={(e) => onCategoryChange(e.target.value)}>
          <option value="">{t('products.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : products.length === 0 ? (
        <p>{t('pos.noSellableProducts')}</p>
      ) : (
        <div className="product-grid">
          {products.map((p) => {
            const outOfStock = p.stockQty !== undefined && p.stockQty <= 0
            return (
              <button
                type="button"
                key={p.id}
                className={`product-card${outOfStock ? ' out-of-stock' : ''}`}
                onClick={() => onSelectProduct(p)}
              >
                <span className="product-card-name">{p.name}</span>
                <span className="product-card-sku">{p.sku}</span>
                <span className="price">{p.sellingPrice.toFixed(2)}</span>
                {p.stockQty !== undefined && (
                  <span className="stock">
                    {t('pos.stockAtBranch')}: {p.stockQty}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
