import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch, uploadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function ProductFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { token } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [form, setForm] = useState({
    sku: '',
    name: '',
    unit: '',
    category: '',
    supplierId: '',
    reorderLevel: 0,
    unitCost: '',
  })
  const [suppliers, setSuppliers] = useState([])
  const [imageUrl, setImageUrl] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    apiFetch('/suppliers', { token })
      .then(setSuppliers)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isEdit) return
    apiFetch(`/products/${id}`, { token })
      .then((p) => {
        setForm({
          sku: p.sku,
          name: p.name,
          unit: p.unit,
          category: p.category || '',
          supplierId: p.supplierId || '',
          reorderLevel: p.reorderLevel,
          unitCost: p.unitCost ?? '',
        })
        setImageUrl(p.imageUrl)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit, token])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    try {
      const payload = {
        ...form,
        reorderLevel: Number(form.reorderLevel),
        supplierId: form.supplierId || null,
        unitCost: form.unitCost === '' ? null : Number(form.unitCost),
      }
      if (isEdit) {
        await apiFetch(`/products/${id}`, { method: 'PATCH', body: payload, token })
      } else {
        await apiFetch('/products', { method: 'POST', body: payload, token })
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleImageChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      const product = await uploadFile(`/products/${id}/image`, { file, fieldName: 'image', token })
      setImageUrl(product.imageUrl)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>

  return (
    <div className="centered">
      <form className="card" onSubmit={handleSubmit}>
        <h1>{isEdit ? t('productForm.editTitle') : t('productForm.addTitle')}</h1>
        {error && <p className="error">{error}</p>}
        <label>
          {t('products.sku')}
          <input value={form.sku} onChange={(e) => handleChange('sku', e.target.value)} required />
        </label>
        <label>
          {t('common.name')}
          <input value={form.name} onChange={(e) => handleChange('name', e.target.value)} required />
        </label>
        <label>
          {t('products.unit')}
          <input value={form.unit} onChange={(e) => handleChange('unit', e.target.value)} required />
        </label>
        <label>
          {t('products.category')}
          <input value={form.category} onChange={(e) => handleChange('category', e.target.value)} />
        </label>
        <label>
          {t('productForm.supplier')}
          <select value={form.supplierId} onChange={(e) => handleChange('supplierId', e.target.value)}>
            <option value="">{t('productForm.none')}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('products.reorderLevel')}
          <input
            type="number"
            min="0"
            value={form.reorderLevel}
            onChange={(e) => handleChange('reorderLevel', e.target.value)}
          />
        </label>
        <label>
          {t('products.unitCost')}
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.unitCost}
            onChange={(e) => handleChange('unitCost', e.target.value)}
          />
        </label>

        {isEdit ? (
          <label>
            {t('productForm.image')}
            {imageUrl && <img src={imageUrl} alt="" className="product-image-preview" />}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} />
          </label>
        ) : (
          <p className="hint">{t('productForm.saveFirst')}</p>
        )}

        <button type="submit">{isEdit ? t('common.save') : t('common.create')}</button>
      </form>
    </div>
  )
}
