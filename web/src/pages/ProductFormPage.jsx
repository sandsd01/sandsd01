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
    barcode: '',
    name: '',
    unit: '',
    category: '',
    supplierId: '',
    reorderLevel: 0,
    unitCost: '',
    sellingPrice: '',
  })
  const [suppliers, setSuppliers] = useState([])
  const [imageUrl, setImageUrl] = useState(null)
  const [qrCodeUrl, setQrCodeUrl] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(isEdit)

  const [groups, setGroups] = useState([])
  const [groupsError, setGroupsError] = useState(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupSelectionType, setNewGroupSelectionType] = useState('single')
  const [newGroupRequired, setNewGroupRequired] = useState(false)
  const [optionDrafts, setOptionDrafts] = useState({})

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
          barcode: p.barcode || '',
          name: p.name,
          unit: p.unit,
          category: p.category || '',
          supplierId: p.supplierId || '',
          reorderLevel: p.reorderLevel,
          unitCost: p.unitCost ?? '',
          sellingPrice: p.sellingPrice ?? '',
        })
        setImageUrl(p.imageUrl)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id, isEdit, token])

  async function loadGroups() {
    if (!isEdit) return
    setGroupsError(null)
    try {
      setGroups(await apiFetch(`/products/${id}/modifier-groups`, { token }))
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  useEffect(() => {
    loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit, token])

  async function handleAddGroup(e) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setGroupsError(null)
    try {
      await apiFetch(`/products/${id}/modifier-groups`, {
        method: 'POST',
        body: {
          name: newGroupName,
          selectionType: newGroupSelectionType,
          required: newGroupRequired,
          sortOrder: groups.length,
        },
        token,
      })
      setNewGroupName('')
      setNewGroupSelectionType('single')
      setNewGroupRequired(false)
      await loadGroups()
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  async function handleUpdateGroup(groupId, field, value) {
    setGroupsError(null)
    try {
      await apiFetch(`/products/modifier-groups/${groupId}`, {
        method: 'PATCH',
        body: { [field]: value },
        token,
      })
      await loadGroups()
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  async function handleDeleteGroup(groupId) {
    if (!window.confirm(t('modifiers.confirmDeleteGroup'))) return
    setGroupsError(null)
    try {
      await apiFetch(`/products/modifier-groups/${groupId}`, { method: 'DELETE', token })
      await loadGroups()
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  function updateOptionDraft(groupId, field, value) {
    setOptionDrafts((prev) => ({
      ...prev,
      [groupId]: { ...(prev[groupId] || { name: '', priceDelta: '' }), [field]: value },
    }))
  }

  async function handleAddOption(groupId, e) {
    e.preventDefault()
    const draft = optionDrafts[groupId] || { name: '', priceDelta: '' }
    if (!draft.name.trim()) return
    setGroupsError(null)
    try {
      await apiFetch(`/products/modifier-groups/${groupId}/options`, {
        method: 'POST',
        body: { name: draft.name, priceDelta: draft.priceDelta === '' ? 0 : Number(draft.priceDelta) },
        token,
      })
      setOptionDrafts((prev) => ({ ...prev, [groupId]: { name: '', priceDelta: '' } }))
      await loadGroups()
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  async function handleUpdateOption(optionId, field, value) {
    setGroupsError(null)
    try {
      await apiFetch(`/products/modifier-options/${optionId}`, {
        method: 'PATCH',
        body: { [field]: value },
        token,
      })
      await loadGroups()
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  async function handleDeleteOption(optionId) {
    if (!window.confirm(t('modifiers.confirmDeleteOption'))) return
    setGroupsError(null)
    try {
      await apiFetch(`/products/modifier-options/${optionId}`, { method: 'DELETE', token })
      await loadGroups()
    } catch (err) {
      setGroupsError(err.message)
    }
  }

  useEffect(() => {
    if (!isEdit) return
    let objectUrl
    fetch(`/api/products/${id}/qrcode`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('Failed to load QR code'))))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setQrCodeUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
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
        sellingPrice: form.sellingPrice === '' ? null : Number(form.sellingPrice),
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
    <div>
    <div className="centered">
      <form className="card" onSubmit={handleSubmit}>
        <h1>{isEdit ? t('productForm.editTitle') : t('productForm.addTitle')}</h1>
        {error && <p className="error">{error}</p>}
        <label>
          {t('products.sku')}
          <input value={form.sku} onChange={(e) => handleChange('sku', e.target.value)} required />
        </label>
        <label>
          {t('products.barcode')}
          <input value={form.barcode} onChange={(e) => handleChange('barcode', e.target.value)} />
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
        <label>
          {t('products.sellingPrice')}
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.sellingPrice}
            onChange={(e) => handleChange('sellingPrice', e.target.value)}
          />
        </label>

        {isEdit ? (
          <>
            <label>
              {t('productForm.image')}
              {imageUrl && <img src={imageUrl} alt="" className="product-image-preview" />}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} />
            </label>
            <label>
              {t('productForm.qrCode')}
              {qrCodeUrl && <img src={qrCodeUrl} alt="" className="product-image-preview" />}
            </label>
          </>
        ) : (
          <p className="hint">{t('productForm.saveFirst')}</p>
        )}

        <button type="submit">{isEdit ? t('common.save') : t('common.create')}</button>
      </form>
    </div>

    <div className="modifiers-section">
      <h2>{t('modifiers.title')}</h2>
      {!isEdit ? (
        <p className="hint">{t('modifiers.saveFirst')}</p>
      ) : (
        <>
          {groupsError && <p className="error">{groupsError}</p>}
          {groups.length === 0 && <p>{t('modifiers.noGroups')}</p>}

          {groups.map((group) => (
            <div className="card modifier-group-editor" key={group.id}>
              <div className="page-header">
                <input
                  key={`name-${group.id}-${group.name}`}
                  defaultValue={group.name}
                  onBlur={(e) =>
                    e.target.value !== group.name && handleUpdateGroup(group.id, 'name', e.target.value)
                  }
                />
                <button type="button" onClick={() => handleDeleteGroup(group.id)}>
                  {t('modifiers.deleteGroup')}
                </button>
              </div>
              <label>
                {t('modifiers.selectionType')}
                <select
                  value={group.selectionType}
                  onChange={(e) => handleUpdateGroup(group.id, 'selectionType', e.target.value)}
                >
                  <option value="single">{t('modifiers.selectionType.single')}</option>
                  <option value="multiple">{t('modifiers.selectionType.multiple')}</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={group.required}
                  onChange={(e) => handleUpdateGroup(group.id, 'required', e.target.checked)}
                />{' '}
                {t('modifiers.required')}
              </label>

              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('modifiers.optionName')}</th>
                      <th>{t('modifiers.priceDelta')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.options.map((option) => (
                      <tr key={option.id}>
                        <td>
                          <input
                            key={`opt-name-${option.id}-${option.name}`}
                            defaultValue={option.name}
                            onBlur={(e) =>
                              e.target.value !== option.name &&
                              handleUpdateOption(option.id, 'name', e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            key={`opt-price-${option.id}-${option.priceDelta}`}
                            type="number"
                            step="0.01"
                            defaultValue={option.priceDelta}
                            onBlur={(e) =>
                              Number(e.target.value) !== option.priceDelta &&
                              handleUpdateOption(option.id, 'priceDelta', Number(e.target.value))
                            }
                          />
                        </td>
                        <td>
                          <button type="button" onClick={() => handleDeleteOption(option.id)}>
                            {t('modifiers.deleteOption')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form className="inline-form" onSubmit={(e) => handleAddOption(group.id, e)}>
                <label>
                  {t('modifiers.optionName')}
                  <input
                    value={optionDrafts[group.id]?.name ?? ''}
                    onChange={(e) => updateOptionDraft(group.id, 'name', e.target.value)}
                  />
                </label>
                <label>
                  {t('modifiers.priceDelta')}
                  <input
                    type="number"
                    step="0.01"
                    value={optionDrafts[group.id]?.priceDelta ?? ''}
                    onChange={(e) => updateOptionDraft(group.id, 'priceDelta', e.target.value)}
                  />
                </label>
                <button type="submit">{t('modifiers.addOption')}</button>
              </form>
            </div>
          ))}

          <form className="card inline-form" onSubmit={handleAddGroup}>
            <h3>{t('modifiers.addGroup')}</h3>
            <label>
              {t('modifiers.groupName')}
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} required />
            </label>
            <label>
              {t('modifiers.selectionType')}
              <select
                value={newGroupSelectionType}
                onChange={(e) => setNewGroupSelectionType(e.target.value)}
              >
                <option value="single">{t('modifiers.selectionType.single')}</option>
                <option value="multiple">{t('modifiers.selectionType.multiple')}</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={newGroupRequired}
                onChange={(e) => setNewGroupRequired(e.target.checked)}
              />{' '}
              {t('modifiers.required')}
            </label>
            <button type="submit">{t('modifiers.addGroup')}</button>
          </form>
        </>
      )}
    </div>
    </div>
  )
}
