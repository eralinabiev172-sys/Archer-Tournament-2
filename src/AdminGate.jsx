import { useEffect, useState } from 'react'
import App from './App.jsx'
import './App.css'
import './admin-gate.css'

const ADMIN_ACCESS_STORAGE_KEY = 'archery_admin_access_v1'
const ADMIN_SESSION_STORAGE_KEY = 'archery_admin_session_v1'
const DEFAULT_ADMIN_ACCOUNT = 'zamirbekbegaliev423@gmail.com'
const DEFAULT_ADMIN_PASSWORD = 'Bow kg.99$'

const sanitizeAdminAccount = (value) => String(value || '').trim().toLowerCase()
const isValidAdminAccount = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
const isValidAdminPassword = (value) => String(value || '').trim().length >= 6

const loadAdminAccess = () => {
  if (typeof window === 'undefined') {
    return {
      account: DEFAULT_ADMIN_ACCOUNT,
      password: DEFAULT_ADMIN_PASSWORD,
    }
  }

  return {
    account: DEFAULT_ADMIN_ACCOUNT,
    password: DEFAULT_ADMIN_PASSWORD,
  }
}

const loadAdminSession = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'true'
}

export default function AdminGate() {
  const initialAccess = loadAdminAccess()
  const [authAccount, setAuthAccount] = useState(initialAccess?.account || DEFAULT_ADMIN_ACCOUNT)
  const [authPassword, setAuthPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authMessage, setAuthMessage] = useState(initialAccess ? '' : 'Админ-доступ азырынча түзүлгөн эмес.')
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(initialAccess && loadAdminSession()))

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.removeItem(ADMIN_ACCESS_STORAGE_KEY)

    if (isAuthenticated) {
      window.sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'true')
      return
    }

    window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY)
  }, [isAuthenticated])

  const handleSubmit = (event) => {
    event.preventDefault()

    const account = sanitizeAdminAccount(authAccount)
    const password = String(authPassword || '').trim()

    if (!isValidAdminAccount(account)) {
      setAuthMessage('Google аккаунт түрүндө туура email жазыңыз.')
      return
    }

    if (!isValidAdminPassword(password)) {
      setAuthMessage('Пароль кеминде 6 символ болушу керек.')
      return
    }

    const savedAccess = loadAdminAccess()
    if (savedAccess.account !== account || savedAccess.password !== password) {
      setAuthMessage('Аккаунт же пароль туура эмес.')
      return
    }

    setAuthMessage('')
    setIsAuthenticated(true)
    setAuthPassword('')
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    setAuthMessage('')
    setAuthPassword('')
    setShowPassword(false)
  }

  if (isAuthenticated) {
    return <App onLogout={handleLogout} />
  }

  return (
    <div className="auth-shell">
      <div className="app-background" aria-hidden="true" />

      <section className="auth-card">
        <div className="auth-card__header">
          <p className="eyebrow">Админ кирүү</p>
          <h1 className="auth-card__title">Админ-панелге кирүү</h1>
          <p className="auth-card__text">Бул экранда азыр бир гана кирүү калды.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Google аккаунт</span>
            <input
              type="email"
              name="account"
              className="field__control"
              value={authAccount}
              onChange={(event) => setAuthAccount(event.target.value)}
              placeholder="name@gmail.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Пароль</span>
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                className="field__control password-field__input"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </label>

          <button type="submit" className="primary-button auth-form__submit">
            Вход
          </button>

          {authMessage && <p className="message-line message-line--auth">{authMessage}</p>}
        </form>
      </section>
    </div>
  )
}
