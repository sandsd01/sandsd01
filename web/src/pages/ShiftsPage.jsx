import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

// Shares the branch the cashier already picked on the POS screen: the drawer
// they reconcile is the drawer they sell from.
const LOCATION_STORAGE_KEY = 'pos.locationId'
const PAGE_SIZE = 10

function shortDateTime(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// In the history table the date and the time stack, so two timestamp columns
// don't squeeze the variance column off the end of the row.
function StackedDateTime({ value }) {
  if (!value) return '—'
  const d = new Date(value)
  return (
    <>
      <span>{d.toLocaleDateString(undefined, { dateStyle: 'short' })}</span>
      <span className="time-line">{d.toLocaleTimeString(undefined, { timeStyle: 'short' })}</span>
    </>
  )
}

function money(value) {
  return Number(value ?? 0).toFixed(2)
}

// Anything inside half a satang of zero is a balanced drawer, not a rounding fight.
function varianceKind(value) {
  const n = Number(value ?? 0)
  if (n <= -0.005) return 'short'
  if (n >= 0.005) return 'over'
  return 'exact'
}

const VARIANCE_GLYPH = { short: '▼', over: '▲', exact: '=' }
const VARIANCE_WORD = { short: 'shifts.varianceShort', over: 'shifts.varianceOver', exact: 'shifts.varianceExact' }
const VARIANCE_HINT = {
  short: 'shifts.varianceShortHint',
  over: 'shifts.varianceOverHint',
  exact: 'shifts.varianceExactHint',
}

// The sign is part of the number, so short/over survives greyscale and a
// screen reader reading the figure alone.
function signedMoney(value) {
  const kind = varianceKind(value)
  const abs = Math.abs(Number(value ?? 0)).toFixed(2)
  if (kind === 'short') return `−${abs}`
  if (kind === 'over') return `+${abs}`
  return abs
}

function VarianceBlock({ value, caption, compact, live, t }) {
  const kind = varianceKind(value)
  return (
    <div
      className={`variance-panel ${kind}${compact ? ' compact' : ''}`}
      {...(live ? { role: 'status', 'aria-live': 'polite' } : {})}
    >
      <span className="variance-caption">{caption}</span>
      <span className="variance-figure">{signedMoney(value)}</span>
      <span className="variance-badge">
        <span className="variance-glyph" aria-hidden="true">
          {VARIANCE_GLYPH[kind]}
        </span>
        {t(VARIANCE_WORD[kind])}
      </span>
      {!compact && <p className="variance-hint">{t(VARIANCE_HINT[kind])}</p>}
    </div>
  )
}

export function ShiftsPage() {
  const { token, user } = useAuth()
  const { t } = useLanguage()
  const isAdmin = user?.role === 'admin'

  // Same rule as the POS: staff with a home branch reconcile that drawer and no
  // other. The backend enforces it too — this only saves them a wrong choice.
  const lockedLocationId =
    user?.role === 'staff' && user?.homeLocationId ? String(user.homeLocationId) : null

  const [locations, setLocations] = useState([])
  const [locationsLoading, setLocationsLoading] = useState(true)
  const [locationsError, setLocationsError] = useState(null)
  const [locationId, setLocationId] = useState(
    () => lockedLocationId || localStorage.getItem(LOCATION_STORAGE_KEY) || ''
  )

  const [shift, setShift] = useState(null)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftError, setShiftError] = useState(null)
  const [closedShift, setClosedShift] = useState(null)

  const [openingFloat, setOpeningFloat] = useState('')
  const [openNote, setOpenNote] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState(null)

  const [countedCash, setCountedCash] = useState('')
  const [closeNote, setCloseNote] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState(null)

  const [history, setHistory] = useState([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)

  const loadLocations = useCallback(() => {
    setLocationsLoading(true)
    setLocationsError(null)
    apiFetch('/locations', { token })
      .then((locs) => {
        const active = locs.filter((l) => l.isActive)
        setLocations(active)
        if (lockedLocationId) return
        const saved = localStorage.getItem(LOCATION_STORAGE_KEY)
        if (saved && !active.some((l) => String(l.id) === saved)) {
          localStorage.removeItem(LOCATION_STORAGE_KEY)
          setLocationId('')
        }
      })
      .catch((err) => setLocationsError(err.message))
      .finally(() => setLocationsLoading(false))
  }, [token, lockedLocationId])

  useEffect(() => {
    loadLocations()
  }, [loadLocations])

  // /auth/me can resolve after the first render, so re-apply the lock when it lands.
  useEffect(() => {
    if (lockedLocationId) setLocationId(lockedLocationId)
  }, [lockedLocationId])

  const loadShift = useCallback(() => {
    if (!locationId) {
      setShift(null)
      return
    }
    setShiftLoading(true)
    setShiftError(null)
    apiFetch(`/cash-shifts/current?locationId=${encodeURIComponent(locationId)}`, { token })
      .then((data) => setShift(data))
      .catch((err) => setShiftError(err.message))
      .finally(() => setShiftLoading(false))
  }, [locationId, token])

  useEffect(() => {
    loadShift()
  }, [loadShift])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    setHistoryError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (locationId) params.set('locationId', locationId)
    if (statusFilter) params.set('status', statusFilter)
    apiFetch(`/cash-shifts?${params.toString()}`, { token })
      .then((result) => {
        setHistory(result.data)
        setHistoryTotal(result.total)
      })
      .catch((err) => setHistoryError(err.message))
      .finally(() => setHistoryLoading(false))
  }, [token, page, locationId, statusFilter])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    setPage(1)
  }, [locationId, statusFilter])

  function handleLocationChange(value) {
    setLocationId(value)
    setClosedShift(null)
    setOpenError(null)
    setCloseError(null)
    if (value) localStorage.setItem(LOCATION_STORAGE_KEY, value)
    else localStorage.removeItem(LOCATION_STORAGE_KEY)
  }

  async function handleOpen(e) {
    e.preventDefault()
    setOpenError(null)
    if (openingFloat === '' || Number.isNaN(Number(openingFloat))) {
      setOpenError(t('shifts.openingFloatRequired'))
      return
    }
    setOpening(true)
    try {
      const body = { locationId: Number(locationId), openingFloat: Number(openingFloat) }
      if (openNote.trim()) body.note = openNote.trim()
      const created = await apiFetch('/cash-shifts/open', { method: 'POST', body, token })
      setShift(created)
      setClosedShift(null)
      setOpeningFloat('')
      setOpenNote('')
      loadHistory()
    } catch (err) {
      setOpenError(err.message)
    } finally {
      setOpening(false)
    }
  }

  async function handleClose(e) {
    e.preventDefault()
    setCloseError(null)
    if (countedCash === '' || Number.isNaN(Number(countedCash))) {
      setCloseError(t('shifts.countedCashRequired'))
      return
    }
    setClosing(true)
    try {
      const body = { countedCash: Number(countedCash) }
      if (closeNote.trim()) body.note = closeNote.trim()
      const closed = await apiFetch(`/cash-shifts/${shift.id}/close`, { method: 'POST', body, token })
      setClosedShift(closed)
      setShift(null)
      setCountedCash('')
      setCloseNote('')
      loadHistory()
    } catch (err) {
      setCloseError(err.message)
    } finally {
      setClosing(false)
    }
  }

  const selectedLocation = useMemo(
    () => locations.find((l) => String(l.id) === String(locationId)) || null,
    [locations, locationId]
  )

  const countedNumber = countedCash === '' ? null : Number(countedCash)
  const previewVariance =
    shift && countedNumber !== null && !Number.isNaN(countedNumber)
      ? countedNumber - Number(shift.expectedCash)
      : null

  const totalPages = Math.max(1, Math.ceil(historyTotal / PAGE_SIZE))

  function renderDrawer() {
    if (locationsLoading) return <p>{t('common.loading')}</p>
    if (locationsError) {
      return (
        <div className="shift-panel narrow">
          <p className="error">{locationsError}</p>
          <button type="button" className="secondary" onClick={loadLocations}>
            {t('shifts.retry')}
          </button>
        </div>
      )
    }
    if (locations.length === 0) return <p className="hint">{t('shifts.noActiveBranches')}</p>
    if (!locationId) return <p className="hint">{t('shifts.selectBranchFirst')}</p>
    if (shiftLoading) return <p>{t('common.loading')}</p>
    if (shiftError) {
      return (
        <div className="shift-panel narrow">
          <p className="error">{shiftError}</p>
          <button type="button" className="secondary" onClick={loadShift}>
            {t('shifts.retry')}
          </button>
        </div>
      )
    }

    if (shift) {
      return (
        <>
          <div className="drawer-state">
            <span className="drawer-state-label">{t('shifts.statusOpen')}</span>
            <span className="meta">
              {t('shifts.openedBy')}: {shift.openedBy?.email}
            </span>
            <span className="meta">
              {t('shifts.openedAt')}: {new Date(shift.openedAt).toLocaleString()}
            </span>
            <span className="meta">
              {t('shifts.saleCount')}: {shift.saleCount}
            </span>
            <button type="button" className="secondary drawer-state-link" onClick={loadShift}>
              {t('shifts.refresh')}
            </button>
          </div>

          <div className="shift-columns">
            <section className="shift-panel">
              <h2>{t('shifts.ledgerTitle')}</h2>
              <div className="ledger">
                <div className="ledger-row">
                  <span className="ledger-label">{t('shifts.float')}</span>
                  <span className="ledger-value">{money(shift.openingFloat)}</span>
                </div>
                <div className="ledger-row">
                  <span className="ledger-label">
                    {t('shifts.cashSales')}
                    <span className="ledger-sub">{t('shifts.cashSalesHint')}</span>
                    <span className="ledger-sub">
                      {t('shifts.saleCountValue', { count: shift.saleCount })}
                    </span>
                  </span>
                  <span className="ledger-value">+ {money(shift.cashSales)}</span>
                </div>
                <div className="ledger-row total">
                  <span className="ledger-label">{t('shifts.expectedCash')}</span>
                  <span className="ledger-value">{money(shift.expectedCash)}</span>
                </div>
              </div>
              {shift.openingNote && (
                <p className="hint">
                  {t('shifts.openingNoteLabel')}: {shift.openingNote}
                </p>
              )}
            </section>

            <form className="shift-panel emphasis" onSubmit={handleClose}>
              <h2>{t('shifts.closeTitle')}</h2>
              <label>
                {t('shifts.countedCash')}
                <input
                  className="count-input"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                />
              </label>
              <p className="field-note">{t('shifts.countedCashHint')}</p>

              {previewVariance !== null && (
                <VarianceBlock compact value={previewVariance} caption={t('shifts.previewLabel')} t={t} />
              )}

              <label>
                {t('shifts.closeNote')}
                <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
              </label>

              {closeError && <p className="error">{closeError}</p>}
              <p className="field-note">{t('shifts.closeWarning')}</p>

              <button type="submit" className="btn-shift" disabled={closing}>
                {closing ? t('shifts.closing') : t('shifts.closeSubmit')}
              </button>
            </form>
          </div>
        </>
      )
    }

    return (
      <>
        {closedShift && (
          <section className="shift-result">
            <h2>{t('shifts.resultTitle')}</h2>
            <VarianceBlock live value={closedShift.variance} caption={t('shifts.variance')} t={t} />
            <div className="shift-result-figures">
              <div className="shift-figure">
                <span className="figure-label">{t('shifts.expected')}</span>
                <span className="figure-value">{money(closedShift.expectedCash)}</span>
              </div>
              <div className="shift-figure">
                <span className="figure-label">{t('shifts.counted')}</span>
                <span className="figure-value">{money(closedShift.countedCash)}</span>
              </div>
              <div className="shift-figure">
                <span className="figure-label">{t('shifts.closedAt')}</span>
                <span className="figure-value figure-value-text">
                  {closedShift.closedAt ? shortDateTime(closedShift.closedAt) : '—'}
                </span>
              </div>
            </div>
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setClosedShift(null)}>
                {t('shifts.done')}
              </button>
            </div>
          </section>
        )}

        <div className="drawer-state idle">
          <span className="drawer-state-label">{t('shifts.noOpenShift')}</span>
          <span className="meta">{t('shifts.noOpenShiftHint')}</span>
        </div>

        <form className="shift-panel emphasis narrow" onSubmit={handleOpen}>
          <h2>{t('shifts.openTitle')}</h2>
          <label>
            {t('shifts.openingFloat')}
            <input
              className="count-input"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
            />
          </label>
          <p className="field-note">{t('shifts.openingFloatHint')}</p>
          <label>
            {t('shifts.openNote')}
            <input value={openNote} onChange={(e) => setOpenNote(e.target.value)} />
          </label>
          {openError && <p className="error">{openError}</p>}
          <button type="submit" className="btn-shift" disabled={opening}>
            {opening ? t('shifts.opening') : t('shifts.openSubmit')}
          </button>
        </form>
      </>
    )
  }

  function renderHistory() {
    if (historyLoading) return <p>{t('common.loading')}</p>
    if (historyError) {
      return (
        <div className="shift-panel narrow">
          <p className="error">{historyError}</p>
          <button type="button" className="secondary" onClick={loadHistory}>
            {t('shifts.retry')}
          </button>
        </div>
      )
    }
    if (history.length === 0) return <p className="hint">{t('shifts.historyEmpty')}</p>

    // With a branch selected every row is that branch — the column would just
    // push the variance off the right edge.
    const showBranch = isAdmin && !locationId

    return (
      <>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('shifts.opened')}</th>
                <th>{t('shifts.closed')}</th>
                {showBranch && <th>{t('shifts.branch')}</th>}
                <th>{t('shifts.staff')}</th>
                <th className="money-cell">{t('shifts.floatShort')}</th>
                <th className="money-cell">{t('shifts.expected')}</th>
                <th className="money-cell">{t('shifts.counted')}</th>
                <th className="money-cell">{t('shifts.variance')}</th>
                <th>{t('shifts.status')}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td className="date-cell">
                    <StackedDateTime value={row.openedAt} />
                  </td>
                  <td className="date-cell">
                    <StackedDateTime value={row.closedAt} />
                  </td>
                  {showBranch && <td>{row.location?.name}</td>}
                  <td className="staff-cell">
                    {row.openedBy?.email}
                    {row.closedBy && row.closedBy.email !== row.openedBy?.email && (
                      <span className="ledger-sub">
                        {t('shifts.closedBy')}: {row.closedBy.email}
                      </span>
                    )}
                  </td>
                  <td className="money-cell">{money(row.openingFloat)}</td>
                  <td className="money-cell">{money(row.expectedCash)}</td>
                  <td className="money-cell">
                    {row.countedCash === null ? '—' : money(row.countedCash)}
                  </td>
                  <td className="money-cell">
                    {row.variance === null ? (
                      '—'
                    ) : (
                      <span className={`variance-tag ${varianceKind(row.variance)}`}>
                        <span className="variance-glyph" aria-hidden="true">
                          {VARIANCE_GLYPH[varianceKind(row.variance)]}
                        </span>
                        {signedMoney(row.variance)}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge shift-${row.status}`}>
                      {t(`shifts.status.${row.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('products.prev')}
          </button>
          <span>
            {t('products.page')} {page} {t('products.of')} {totalPages} ({historyTotal})
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t('products.next')}
          </button>
        </div>
      </>
    )
  }

  return (
    <div>
      <div className="shift-header">
        <h1>{t('shifts.title')}</h1>
        {lockedLocationId ? (
          <div className="shift-branch-fixed">
            <span>{t('shifts.branch')}</span>
            <strong>{selectedLocation?.name || '—'}</strong>
          </div>
        ) : (
          <label className="shift-branch-picker">
            {t('shifts.branch')}
            <select value={locationId} onChange={(e) => handleLocationChange(e.target.value)}>
              <option value="">{t('shifts.selectBranch')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {lockedLocationId && <p className="hint">{t('shifts.branchLockedToHome')}</p>}

      {renderDrawer()}

      <section className="shift-history">
        <div className="shift-header">
          <h2>{t('shifts.historyTitle')}</h2>
          <label className="shift-branch-picker">
            {t('shifts.status')}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('shifts.allStatuses')}</option>
              <option value="open">{t('shifts.status.open')}</option>
              <option value="closed">{t('shifts.status.closed')}</option>
            </select>
          </label>
        </div>
        {renderHistory()}
      </section>
    </div>
  )
}
