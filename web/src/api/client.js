const BASE_URL = '/api'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function apiFetch(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return null

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed with status ${res.status}`, res.status)
  }

  return data
}

export async function uploadFile(path, { file, fieldName = 'image', token } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const formData = new FormData()
  formData.append(fieldName, file)

  const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData })
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed with status ${res.status}`, res.status)
  }

  return data
}

export async function downloadFile(path, { token, filename } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { headers })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(data?.error || `Request failed with status ${res.status}`, res.status)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'download.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
