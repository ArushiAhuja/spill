export function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('spill_token')
}

export function setToken(token) {
  localStorage.setItem('spill_token', token)
}

export function removeToken() {
  localStorage.removeItem('spill_token')
  localStorage.removeItem('spill_user')
}

export function getUser() {
  if (typeof window === 'undefined') return null
  try {
    const u = localStorage.getItem('spill_user')
    return u ? JSON.parse(u) : null
  } catch {
    return null
  }
}

export function setUser(user) {
  localStorage.setItem('spill_user', JSON.stringify(user))
}

export function isAuthenticated() {
  return !!getToken()
}

export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
