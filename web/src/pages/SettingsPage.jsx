import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function SettingsPage() {
  const { token } = useAuth()
  const { t } = useLanguage()

  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/settings/shop', { token })
      .then(setForm)
      .catch((err) => setError(err.message))
  }, [token])

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const updated = await apiFetch('/settings/shop', {
        method: 'PATCH',
        token,
        body: {
          legalName: form.legalName,
          taxId: form.taxId,
          address: form.address,
          vatRegistered: form.vatRegistered,
          vatRate: Number(form.vatRate),
          pricesIncludeVat: form.pricesIncludeVat,
        },
      })
      setForm(updated)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!form) return <p>{error ? <span className="error">{error}</span> : t('common.loading')}</p>

  return (
    <div>
      <h1>{t('settings.title')}</h1>
      {error && <p className="error">{error}</p>}
      {saved && <p className="hint">{t('settings.saved')}</p>}

      <form onSubmit={handleSubmit} className="card">
        <label>
          {t('settings.legalName')}
          <input
            type="text"
            value={form.legalName || ''}
            onChange={(e) => update('legalName', e.target.value)}
          />
        </label>

        <label>
          {t('settings.taxId')}
          <input
            type="text"
            inputMode="numeric"
            value={form.taxId || ''}
            onChange={(e) => update('taxId', e.target.value)}
          />
        </label>

        <label>
          {t('settings.address')}
          <input
            type="text"
            value={form.address || ''}
            onChange={(e) => update('address', e.target.value)}
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.vatRegistered}
            onChange={(e) => update('vatRegistered', e.target.checked)}
          />
          {t('settings.vatRegistered')}
        </label>

        <label>
          {t('settings.vatRate')}
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={form.vatRate}
            onChange={(e) => update('vatRate', e.target.value)}
          />
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.pricesIncludeVat}
            onChange={(e) => update('pricesIncludeVat', e.target.checked)}
          />
          {t('settings.pricesIncludeVat')}
        </label>

        <p className="hint">{t('settings.vatHint')}</p>

        <button type="submit" disabled={saving}>
          {saving ? t('common.loading') : t('settings.save')}
        </button>
      </form>
    </div>
  )
}
