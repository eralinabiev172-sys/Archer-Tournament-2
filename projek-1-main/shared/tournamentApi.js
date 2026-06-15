const API_BASE = '/api'
const API_RETRY_COOLDOWN_MS = 30000

let apiBlockedUntil = 0
let lastApiErrorMessage = ''

const createApiError = (message, code = 'API_ERROR', status = null) => {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

const isServerUnavailableStatus = (status) => status >= 500
const markApiUnavailable = (message, status = null) => {
  apiBlockedUntil = Date.now() + API_RETRY_COOLDOWN_MS
  lastApiErrorMessage = message
  return createApiError(message, 'API_UNAVAILABLE', status)
}

const request = async (path, options = {}) => {
  if (Date.now() < apiBlockedUntil) {
    throw createApiError(lastApiErrorMessage || 'API убактылуу жеткиликсиз. Кийинчерээк кайра аракет кылыңыз.', 'API_UNAVAILABLE')
  }

  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    })
  } catch {
    throw markApiUnavailable('Backend жеткиликсиз. Колдонмо локалдык режимде иштеп жатат.')
  }

  if (!response.ok) {
    const text = await response.text()
    let parsedPayload = null

    try {
      parsedPayload = JSON.parse(text)
    } catch (parseError) {
      void parseError
    }

    const message = parsedPayload?.error || parsedPayload?.message || text || `Request failed: ${response.status}`

    if (isServerUnavailableStatus(response.status)) {
      throw markApiUnavailable(message, response.status)
    }

    throw createApiError(message, 'API_ERROR', response.status)
  }

  apiBlockedUntil = 0
  lastApiErrorMessage = ''
  return response.json()
}

export const fetchTournamentState = async () => request('/state')

export const saveTournamentState = async (state) =>
  request('/state', {
    method: 'PUT',
    body: JSON.stringify(state),
  })

export const registerTournamentPlayer = async (player) =>
  request('/register-player', {
    method: 'POST',
    body: JSON.stringify(player),
  })

export const submitPlayerScore = async (payload) =>
  request('/player-score', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const submitPlayoffPlayerScore = async (payload) =>
  request('/playoff-player-score', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
