import './app.css'

import { useEffect, useMemo, useState } from 'react'
import { fetchTournamentState, registerTournamentPlayer } from '../shared/tournamentApi.js'

const EMPTY_BRACKET = {
  roundOf32: [],
  roundOf16: [],
  quarterFinals: [],
  semiFinals: [],
  final12: null,
  final34: null,
  winners: [],
}

const FINAL_PRIMARY_ROUNDS = 6
const FINAL_ROUNDS_COUNT = 12

const DEFAULT_STATE = {
  tournamentName: 'Жаа атуу боюнча турнир',
  location: 'Чолпон-Ата, 2026-жыл',
  category: 'Классикалык жаа, 50 метр, эркектер',
  players: [],
  scores: {},
  bracket: EMPTY_BRACKET,
  playoffMode: 16,
  playoffStage: 'none',
  playerNumberBook: {},
}

const sections = [
  { id: 'register', label: 'Катталуу' },
  { id: 'rating', label: 'Рейтинг' },
  { id: 'playoff', label: 'Плей-офф' },
]

const seedOrders = {
  32: [0, 31, 15, 16, 7, 24, 8, 23, 4, 27, 11, 20, 3, 28, 12, 19, 2, 29, 13, 18, 5, 26, 10, 21, 6, 25, 9, 22, 1, 30, 14, 17],
  16: [0, 15, 7, 8, 4, 11, 3, 12, 2, 13, 5, 10, 6, 9, 1, 14],
  8: [0, 7, 3, 4, 1, 6, 2, 5],
  4: [0, 3, 1, 2],
}

const initialRegistrationForm = {
  fullName: '',
  phone: '',
  gender: 'male',
}

const stageTitles = {
  roundOf32: '1/16 финал',
  roundOf16: '1/8 финал',
  quarterFinals: 'Чейрек финал',
  semiFinals: 'Жарым финал',
  final12: 'Финал',
  final34: '3-орун үчүн беттеш',
}

const playoffStageKeysByMode = {
  32: ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals'],
  16: ['roundOf16', 'quarterFinals', 'semiFinals'],
  8: ['quarterFinals', 'semiFinals'],
  4: ['semiFinals'],
}

const normalizePlayerName = (name) => name.trim().toLocaleLowerCase()
const sanitizePlayerName = (value) => value.replace(/[^\p{L}\s'-]/gu, '').replace(/\s{2,}/g, ' ')
const sanitizePhone = (value) => value.replace(/\D/g, '').slice(0, 10)
const isValidPlayerName = (value) => /^[\p{L}\s'-]+$/u.test(value.trim())
const isValidPhone = (value) => /^\d+$/.test(value.trim())

const createEmptyState = () => ({
  ...DEFAULT_STATE,
  bracket: { ...EMPTY_BRACKET },
})

const buildPlayerNumberBook = (players, savedBook = {}) => {
  const nextBook = { ...savedBook }

  players.forEach((player, index) => {
    const normalizedName = normalizePlayerName(player.name || '')
    const entryNumber = player.entryNumber ?? index + 1

    if (normalizedName && !nextBook[normalizedName]) {
      nextBook[normalizedName] = entryNumber
    }
  })

  return nextBook
}

const sortPlayersByEntryNumber = (players) =>
  [...players].sort((left, right) => {
    const leftNumber = left.entryNumber ?? Number.MAX_SAFE_INTEGER
    const rightNumber = right.entryNumber ?? Number.MAX_SAFE_INTEGER

    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }

    return (left.name || '').localeCompare(right.name || '')
  })

const parseTournamentState = (payload) => {
  if (!payload) {
    return createEmptyState()
  }

  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
  const players = Array.isArray(parsed.players) ? parsed.players : []
  const normalizedPlayers = players.map((player, index) => ({
    ...player,
    entryNumber: player.entryNumber ?? index + 1,
  }))
  const playerNumberBook = buildPlayerNumberBook(normalizedPlayers, parsed.playerNumberBook || {})

  return {
    ...DEFAULT_STATE,
    ...parsed,
    players: sortPlayersByEntryNumber(normalizedPlayers),
    playerNumberBook,
    bracket: parsed.bracket ? { ...EMPTY_BRACKET, ...parsed.bracket } : { ...EMPTY_BRACKET },
  }
}

const calculateTotal = (scores, playerId) => {
  const playerScores = scores[playerId] || {}
  return Object.values(playerScores).reduce((sum, value) => sum + Number(value || 0), 0)
}

const getAllMatches = (bracket) => [
  ...(bracket.roundOf32 || []).map((match) => ({ ...match, stage: 'roundOf32' })),
  ...(bracket.roundOf16 || []).map((match) => ({ ...match, stage: 'roundOf16' })),
  ...(bracket.quarterFinals || []).map((match) => ({ ...match, stage: 'quarterFinals' })),
  ...(bracket.semiFinals || []).map((match) => ({ ...match, stage: 'semiFinals' })),
  ...(bracket.final12 ? [{ ...bracket.final12, stage: 'final12' }] : []),
  ...(bracket.final34 ? [{ ...bracket.final34, stage: 'final34' }] : []),
]

const getVisibleStageKeys = (playoffMode) => playoffStageKeysByMode[playoffMode] || playoffStageKeysByMode[8]
const getRoundIndex = (playoffMode, stageKey) => getVisibleStageKeys(playoffMode).indexOf(stageKey)

const getStageMatchCount = (playoffMode, stageKey) => {
  const roundIndex = getRoundIndex(playoffMode, stageKey)
  if (roundIndex < 0) return 0
  return playoffMode / 2 ** (roundIndex + 1)
}

const getSeedNumbersForMatch = (playoffMode, stageKey, matchIndex) => {
  const initialStageKey = getVisibleStageKeys(playoffMode)[0]
  if (stageKey !== initialStageKey) return null
  const order = seedOrders[playoffMode]
  if (!order) return null
  return [order[matchIndex * 2] + 1, order[matchIndex * 2 + 1] + 1]
}

const TargetIcon = ({ size = 20 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
)

function App() {
  const [activeSection, setActiveSection] = useState('register')
  const [registrationMessage, setRegistrationMessage] = useState('')
  const [tournamentState, setTournamentState] = useState(createEmptyState)
  const [registrationForm, setRegistrationForm] = useState(initialRegistrationForm)

  useEffect(() => {
    let isMounted = true

    const syncFromServer = async () => {
      try {
        const nextState = parseTournamentState(await fetchTournamentState())
        if (isMounted) {
          setTournamentState(nextState)
        }
      } catch {
        if (isMounted) {
          setTournamentState(createEmptyState())
        }
      }
    }

    syncFromServer()
    const intervalId = window.setInterval(syncFromServer, 3000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  const ratingPlayers = useMemo(() => {
    const players = [...tournamentState.players]
    return players
      .map((player) => ({
        ...player,
        total: calculateTotal(tournamentState.scores, player.id),
      }))
      .sort((left, right) => right.total - left.total)
  }, [tournamentState.players, tournamentState.scores])

  const playoffMatches = useMemo(() => getAllMatches(tournamentState.bracket), [tournamentState.bracket])
  const playoffStages = useMemo(() => {
    const stageKeys = playoffStageKeysByMode[tournamentState.playoffMode] || playoffStageKeysByMode[8]
    return stageKeys.map((stageKey) => ({
      stageKey,
      title: stageTitles[stageKey] || stageKey,
      matches: tournamentState.bracket[stageKey] || [],
    }))
  }, [tournamentState.bracket, tournamentState.playoffMode])
  const hasFinalMatches = Boolean(tournamentState.bracket.final12 || tournamentState.bracket.final34)

  const handleRegistrationChange = ({ target }) => {
    const { name, value } = target

    if (name === 'fullName') {
      setRegistrationForm((current) => ({ ...current, [name]: sanitizePlayerName(value) }))
      return
    }

    if (name === 'phone') {
      setRegistrationForm((current) => ({ ...current, [name]: sanitizePhone(value) }))
      return
    }

    setRegistrationForm((current) => ({ ...current, [name]: value }))
  }

  const handleRegistrationSubmit = async (event) => {
    event.preventDefault()

    const fullName = registrationForm.fullName.trim()
    const phone = registrationForm.phone.trim()

    if (!fullName || !phone) {
      setRegistrationMessage('Атыңызды жана телефон номериңизди толтуруңуз.')
      return
    }

    if (!isValidPlayerName(fullName)) {
      setRegistrationMessage('Аты-жөнү талаасына сандарды же башка белгилерди жазууга болбойт.')
      return
    }

    if (!isValidPhone(phone)) {
      setRegistrationMessage('Телефон номери талаасына сандар гана жазылышы керек.')
      return
    }

    try {
      const nextState = parseTournamentState(
        await registerTournamentPlayer({
          name: fullName,
          phone,
          gender: registrationForm.gender,
        }),
      )

      setTournamentState(nextState)
      setRegistrationForm(initialRegistrationForm)
      setRegistrationMessage('Катталуу ийгиликтүү аяктады.')
    } catch (error) {
      setRegistrationMessage(error.message || 'Катталууну сактоо мүмкүн болгон жок.')
    }
  }

  return (
    <div className="app-shell">
      <div className="app-background" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-icon">
            <TargetIcon />
          </div>
          <div>
            <p className="eyebrow">Катышуучулар үчүн</p>
            <h1 className="brand-title">Жаа атуу платформасы</h1>
          </div>
        </div>

        <div className="topbar__actions">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`tab-button ${activeSection === section.id ? 'tab-button--active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </header>

      <main className="page">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Жандуу маалымат</p>
            <h2 className="hero-card__title">{tournamentState.tournamentName}</h2>
            <p className="hero-card__text">
              Бул жерде катышуучулар катталып, админ-панелде жаңыртылган рейтингди жана плей-офф жыйынтыктарын түз көрө алышат.
            </p>
          </div>

          <div className="hero-stats">
            <div className="stat-chip">
              <span className="stat-chip__label">Катышуучулар</span>
              <strong>{tournamentState.players.length}</strong>
            </div>
            <div className="stat-chip">
              <span className="stat-chip__label">Топ</span>
              <strong>{tournamentState.playoffMode}</strong>
            </div>
            <div className="stat-chip">
              <span className="stat-chip__label">Жери</span>
              <strong className="stat-chip__compact">{tournamentState.location}</strong>
            </div>
          </div>
        </section>

        {activeSection === 'register' && (
          <section className="panel panel--narrow">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Катталуу</p>
                <h3 className="panel__title">Турнирге катышуу формасы</h3>
              </div>
              <div className="pill">Ачык</div>
            </div>

            <div className="info-strip">
              <span>{tournamentState.location}</span>
              <span>{tournamentState.category}</span>
            </div>

            <form className="form-grid" onSubmit={handleRegistrationSubmit}>
              <label className="field">
                <span className="field__label">Аты-жөнү</span>
                <input
                  name="fullName"
                  className="field__control"
                  value={registrationForm.fullName}
                  onChange={handleRegistrationChange}
                  autoComplete="name"
                  required
                />
              </label>

              <label className="field">
                <span className="field__label">Телефон номери</span>
                <input
                  name="phone"
                  className="field__control"
                  value={registrationForm.phone}
                  onChange={handleRegistrationChange}
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="tel"
                  placeholder="996"
                  required
                />
              </label>

              <div className="field field--full">
                <span className="field__label">Жынысы</span>
                <div className="gender-row">
                  <label className="gender-option">
                    <input
                      type="radio"
                      name="gender"
                      value="male"
                      checked={registrationForm.gender === 'male'}
                      onChange={handleRegistrationChange}
                    />
                    <span>Эркек</span>
                  </label>

                  <label className="gender-option">
                    <input
                      type="radio"
                      name="gender"
                      value="female"
                      checked={registrationForm.gender === 'female'}
                      onChange={handleRegistrationChange}
                    />
                    <span>Аял</span>
                  </label>
                </div>
              </div>

              <div className="note-card field--full">
                Форманы жөнөткөндөн кийин катышуучу автоматтык түрдө админ-панелдеги катышуучулар тизмесине кошулат.
              </div>

              <button type="submit" className="primary-button field--full">
                Катталуу
              </button>
            </form>

            {registrationMessage && <p className="message-line">{registrationMessage}</p>}
          </section>
        )}

        {activeSection === 'rating' && (
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Рейтинг</p>
                <h3 className="panel__title">Катышуучулардын жыйынтыгы</h3>
              </div>
              <div className="pill">Авто жаңыланат</div>
            </div>

            <div className="rating-board">
              {ratingPlayers.length > 0 ? (
                <div className="rating-list">
                  {ratingPlayers.map((player, index) => (
                    <article
                      key={player.id}
                      className={`rating-entry ${index < 3 ? `rating-entry--place-${index + 1}` : ''} ${index === 0 ? 'rating-entry--winner' : ''}`}
                    >
                      <div className="rating-entry__place">{index + 1}</div>
                      <div className="rating-entry__content">
                        <h4>{player.name}</h4>
                        <p>{index === 0 ? '1-орун' : index === 1 ? '2-орун' : index === 2 ? '3-орун' : 'Жалпы упай'}</p>
                      </div>
                      <strong>{player.total}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">Азырынча катышуучулар каттала элек.</div>
              )}
            </div>
          </section>
        )}

        {activeSection === 'playoff' && (
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Плей-офф</p>
                <h3 className="panel__title">Беттештердин жыйынтыгы</h3>
              </div>
              <div className="pill">Авто жаңыланат</div>
            </div>

            {playoffMatches.length > 0 ? (
              <div
                className="bracket-grid"
                style={{
                  '--bracket-column-count': playoffStages.length + (hasFinalMatches ? 1 : 0),
                  '--bracket-column-width': tournamentState.playoffMode === 32 ? '248px' : tournamentState.playoffMode === 16 ? '264px' : '280px',
                  '--bracket-column-gap': tournamentState.playoffMode === 32 ? '34px' : tournamentState.playoffMode === 16 ? '40px' : '48px',
                }}
              >
                {playoffStages.map((stage) => (
                  <ReadOnlyStageColumn
                    key={stage.stageKey}
                    stageKey={stage.stageKey}
                    title={stage.title}
                    playoffMode={tournamentState.playoffMode}
                    matches={stage.matches}
                  />
                ))}

                {hasFinalMatches && (
                  <div className="stage-column stage-column--final">
                    <div className="stage-column__header">
                      <p className="stage-column__eyebrow">Этап</p>
                      <h4>Финал</h4>
                    </div>

                    {tournamentState.bracket.final12 && <ReadOnlyMatch match={tournamentState.bracket.final12} isFinal />}
                    {tournamentState.bracket.final34 && <ReadOnlyMatch match={tournamentState.bracket.final34} isFinal />}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">Админ-панелде плей-офф азырынча түзүлгөн жок.</div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

const ReadOnlyStageColumn = ({ stageKey, title, playoffMode, matches }) => {
  const roundIndex = getRoundIndex(playoffMode, stageKey)
  const roundFactor = 2 ** Math.max(roundIndex, 0)
  const slotCount = getStageMatchCount(playoffMode, stageKey)
  const slotStageClassName = `bracket-match-slot--${stageKey}`
  const connectorStageClassName = `bracket-match-slot__connector--${stageKey}`
  const editableConnectorClassName =
    stageKey === 'roundOf32'
      ? 'playoff-line-editable-round32'
      : stageKey === 'roundOf16'
        ? 'playoff-line-editable-round16'
        : stageKey === 'quarterFinals'
          ? 'playoff-line-editable-quarterfinals'
          : stageKey === 'semiFinals'
            ? 'playoff-line-editable-semifinals'
            : 'playoff-line-editable'

  const columnStyle = {
    '--stage-offset': `calc(((var(--bracket-match-height) + var(--bracket-match-gap)) * ${roundFactor - 1}) / 2)`,
    '--stage-gap': `calc((var(--bracket-match-height) + var(--bracket-match-gap)) * ${roundFactor} - var(--bracket-match-height))`,
  }

  const stageSlots = Array.from({ length: slotCount }, (_, matchIndex) => {
    const match = matches[matchIndex]
    if (match) {
      return {
        kind: 'match',
        key: match.id,
        match,
        seedNumbers: getSeedNumbersForMatch(playoffMode, stageKey, matchIndex),
      }
    }

    return {
      kind: 'placeholder',
      key: `${stageKey}-placeholder-${matchIndex}`,
    }
  })

  return (
    <div className="stage-column" style={columnStyle}>
      <div className="stage-column__header">
        <p className="stage-column__eyebrow">Этап</p>
        <h4>{title}</h4>
      </div>

      <div className="stage-column__matches">
        {stageSlots.map((slot) => (
          <div
            key={slot.key}
            className={`bracket-match-slot ${slotStageClassName} ${stageKey === 'semiFinals' ? 'bracket-match-slot--semiFinals' : ''}`}
          >
            {roundIndex > 0 && (
              <div
                className={`bracket-match-slot__connector bracket-match-slot__connector--custom ${editableConnectorClassName} ${connectorStageClassName} ${
                  stageKey === 'semiFinals' ? 'bracket-match-slot__connector--semiFinals' : ''
                }`}
                aria-hidden="true"
              />
            )}
            {slot.kind === 'match' ? <ReadOnlyMatch match={slot.match} seedNumbers={slot.seedNumbers} /> : <ReadOnlyPlaceholderMatch />}
          </div>
        ))}
      </div>
    </div>
  )
}

const ReadOnlyPlaceholderMatch = () => (
  <article className="playoff-card playoff-card--placeholder">
    <div className="playoff-row">
      <div className="playoff-row__name">???</div>
      <div className="playoff-row__score">0</div>
    </div>
    <div className="playoff-row playoff-row--divided">
      <div className="playoff-row__name">???</div>
      <div className="playoff-row__score">0</div>
    </div>
  </article>
)

const ReadOnlyMatch = ({ match, seedNumbers, isFinal = false }) => {
  if (!match) return null

  if (match.isFinal || isFinal) {
    return (
      <article className={`match-card match-card--final ${match.winner ? 'match-card--winner' : ''}`}>
        <ReadOnlyFinalPlayer
          rounds={match.roundsP1 || Array(FINAL_ROUNDS_COUNT).fill(0)}
          name={match.p1?.name || '—'}
          mainScore={match.s1}
          extraScore={match.s1_bot}
          isWinner={match.winner?.id === match.p1?.id}
        />
        <div className="match-divider" />
        <ReadOnlyFinalPlayer
          rounds={match.roundsP2 || Array(FINAL_ROUNDS_COUNT).fill(0)}
          name={match.p2?.name || '—'}
          mainScore={match.s2}
          extraScore={match.s2_bot}
          isWinner={match.winner?.id === match.p2?.id}
        />
      </article>
    )
  }

  return (
    <article className={`playoff-card ${match.winner ? 'playoff-card--winner' : ''}`}>
      <div className={`playoff-row ${match.winner?.id === match.p1?.id ? 'playoff-row--winner' : ''}`}>
        <div className="playoff-row__identity">
          {seedNumbers && <span className="match-player__seed">{seedNumbers[0]}</span>}
          <span className="playoff-row__name">{match.p1?.name || '—'}</span>
        </div>
        <div className="playoff-row__score">{match.s1}</div>
      </div>
      <div className={`playoff-row playoff-row--divided ${match.winner?.id === match.p2?.id ? 'playoff-row--winner' : ''}`}>
        <div className="playoff-row__identity">
          {seedNumbers && <span className="match-player__seed">{seedNumbers[1]}</span>}
          <span className="playoff-row__name">{match.p2?.name || '—'}</span>
        </div>
        <div className="playoff-row__score">{match.s2}</div>
      </div>
    </article>
  )
}

const ReadOnlyFinalPlayer = ({ rounds, name, mainScore, extraScore, isWinner }) => (
  <div className={`final-player ${isWinner ? 'final-player--winner' : ''}`}>
    <div className="final-rounds-group">
      <div className="final-rounds-group__label">Негизги</div>
      <div className="final-rounds">
        {rounds.slice(0, FINAL_PRIMARY_ROUNDS).map((value, index) => (
          <div key={index} className="mini-input mini-input--readonly">
            {value || ''}
          </div>
        ))}
      </div>
    </div>

    <div className="final-player__card">
      <strong>{name}</strong>
      <span>Негизги: {mainScore}</span>
      <span>Кошумча: {extraScore}</span>
    </div>

    <div className="final-rounds-group">
      <div className="final-rounds-group__label">Кошумча</div>
      <div className="final-rounds">
        {rounds.slice(FINAL_PRIMARY_ROUNDS).map((value, index) => (
          <div key={index + FINAL_PRIMARY_ROUNDS} className="mini-input mini-input--accent mini-input--readonly">
            {value || ''}
          </div>
        ))}
      </div>
    </div>
  </div>
)

export default App
