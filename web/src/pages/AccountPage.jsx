import { useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../context/AuthContext'

export function AccountPage() {
  const { token, user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      await apiFetch('/auth/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
        token,
      })
      setMessage('Password updated.')
      setCurrentPassword('')
      setNewPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="centered">
      <form className="card" onSubmit={handleSubmit}>
        <h1>Account</h1>
        <p>
          Signed in as <strong>{user?.email}</strong> ({user?.role})
        </p>
        <h2>Change password</h2>
        {error && <p className="error">{error}</p>}
        {message && <p className="notice">{message}</p>}
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}
