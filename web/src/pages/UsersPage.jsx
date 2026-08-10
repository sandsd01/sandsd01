import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function UsersPage() {
  const { token } = useAuth()
  const { t } = useLanguage()
  const [users, setUsers] = useState([])
  const [locations, setLocations] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('staff')
  const [homeLocationId, setHomeLocationId] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [userList, locationList] = await Promise.all([
        apiFetch('/users', { token }),
        apiFetch('/locations', { token }),
      ])
      setUsers(userList)
      setLocations(locationList)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: { email, password, role, homeLocationId: homeLocationId || null },
        token,
      })
      setEmail('')
      setPassword('')
      setRole('staff')
      setHomeLocationId('')
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRoleChange(id, newRole) {
    try {
      await apiFetch(`/users/${id}`, { method: 'PATCH', body: { role: newRole }, token })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleHomeLocationChange(id, newHomeLocationId) {
    try {
      await apiFetch(`/users/${id}`, {
        method: 'PATCH',
        body: { homeLocationId: newHomeLocationId || null },
        token,
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this user?')) return
    try {
      await apiFetch(`/users/${id}`, { method: 'DELETE', token })
      setUsers((prev) => prev.filter((u) => u.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p>{t('common.loading')}</p>

  return (
    <div>
      <h1>{t('users.title')}</h1>
      {error && <p className="error">{error}</p>}

      <form className="card inline-form" onSubmit={handleCreate}>
        <h2>{t('users.addUser')}</h2>
        <label>
          {t('common.email')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          {t('login.password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <label>
          {t('common.role')}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>
          {t('users.homeBranch')}
          <select value={homeLocationId} onChange={(e) => setHomeLocationId(e.target.value)}>
            <option value="">{t('users.noHomeBranch')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{t('users.addUser')}</button>
      </form>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t('common.email')}</th>
              <th>{t('common.role')}</th>
              <th>{t('users.homeBranch')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <select value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)}>
                    <option value="staff">staff</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <select
                    value={u.homeLocationId ?? ''}
                    onChange={(e) => handleHomeLocationChange(u.id, e.target.value)}
                  >
                    <option value="">{t('users.noHomeBranch')}</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="actions">
                  <button onClick={() => handleDelete(u.id)}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
