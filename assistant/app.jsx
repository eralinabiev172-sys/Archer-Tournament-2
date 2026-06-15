import { useEffect, useMemo, useState } from 'react'
import { fetchTournamentState, submitPlayerScore, submitPlayoffPlayerScore } from '../shared/tournamentApi.js'
import './app.css'

const EMPTY_BRACKET = {
  roundOf32: [],
  roundOf16: [],
  quarterFinals: [],
  semiFinals: [],
  final12: null,
  final34: null,
  winners: [],
}

const DEFAULT_PLAYOFF_FINAL_ROUNDS = {
  final12: 1,
  final34: 1,
}

const DEFAULT_SCORE_SUBMISSION = {
  activeRound: 1,
  entries: [],
}

const createEmptyCompetitionState = () => ({
  playoffMode: 16,
  playoffStage: 'none',
  playoffFinalRounds: { ...DEFAULT_PLAYOFF_FINAL_ROUNDS },
  bracket: { ...EMPTY_BRACKET },
})

const DEFAULT_STATE = {
  players: [],
  scores: {},
  scoreSubmission: DEFAULT_SCORE_SUBMISSION,
  competitionDivisions: {
    all: createEmptyCompetitionState(),
    male: createEmptyCompetitionState(),
    female: createEmptyCompetitionState(),
  },
  assistantScoringEnabled: false,
}

const normalizePlayerName = (name) => String(name || '').trim().toLocaleLowerCase()
const sortPlayersByEntryNumber = (players) =>
  [...players].sort((left, right) => {
    const leftNumber = left.entryNumber ?? Number.MAX_SAFE_INTEGER
    const rightNumber = right.entryNumber ?? Number.MAX_SAFE_INTEGER
    if (leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return (left.name || '').localeCompare(right.name || '')
  })

const normalizeCompetitionState = (value) => ({
  playoffMode: [32, 16, 8, 4].includes(Number(value?.playoffMode)) ? Number(value.playoffMode) : 16,
  playoffStage: ['none', 'roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final'].includes(value?.playoffStage)
    ? value.playoffStage
    : 'none',
  playoffFinalRounds: {
    final12: [1, 2, 3, 4, 5, 6].includes(Number(value?.playoffFinalRounds?.final12)) ? Number(value.playoffFinalRounds.final12) : 1,
    final34: [1, 2, 3, 4, 5, 6].includes(Number(value?.playoffFinalRounds?.final34)) ? Number(value.playoffFinalRounds.final34) : 1,
  },
  bracket: value?.bracket ? { ...EMPTY_BRACKET, ...value.bracket } : { ...EMPTY_BRACKET },
})

const normalizeCompetitionDivisions = (value) => {
  if (value && typeof value === 'object') {
    return {
      all: normalizeCompetitionState(value.all),
      male: normalizeCompetitionState(value.male),
      female: normalizeCompetitionState(value.female),
    }
  }

  return {
    all: createEmptyCompetitionState(),
    male: createEmptyCompetitionState(),
    female: createEmptyCompetitionState(),
  }
}

const parseTournamentState = (payload) => {
  if (!payload) {
    return { ...DEFAULT_STATE }
  }

  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
  const players = Array.isArray(parsed.players) ? parsed.players : []

  return {
    ...DEFAULT_STATE,
    ...parsed,
    players: sortPlayersByEntryNumber(players),
    scores: parsed.scores || {},
    scoreSubmission: {
      ...DEFAULT_SCORE_SUBMISSION,
      ...(parsed.scoreSubmission || {}),
      entries: Array.isArray(parsed.scoreSubmission?.entries) ? parsed.scoreSubmission.entries : [],
    },
    competitionDivisions: normalizeCompetitionDivisions(parsed.competitionDivisions),
    assistantScoringEnabled: Boolean(parsed.assistantScoringEnabled),
  }
}

const calculateTotal = (scores, playerId) => {
  const playerScores = scores[playerId] || {}
  return Object.values(playerScores).reduce((sum, value) => sum + Number(value || 0), 0)
}

const getPlayerPlayoffMatch = (bracket, playoffStage, playerId) => {
  if (!playerId || playoffStage === 'none') {
    return null
  }

  if (playoffStage === 'final') {
    const finals = [bracket.final12, bracket.final34].filter(Boolean)
    return finals.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
  }

  const stageMatches = Array.isArray(bracket?.[playoffStage]) ? bracket[playoffStage] : []
  return stageMatches.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
}

const stageTitles = {
  roundOf32: '1/16 финал',
  roundOf16: '1/8 финал',
  quarterFinals: 'Чейрек финал',
  semiFinals: 'Жарым финал',
  final12: 'Финал',
  final34: '3-орун үчүн беттеш',
}

export default function AssistantApp() {
  const [tournamentState, setTournamentState] = useState(DEFAULT_STATE)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [playerSearch, setPlayerSearch] = useState('')
  const [journalScore, setJournalScore] = useState('')
  const [playoffScore, setPlayoffScore] = useState('')
  const [journalMessage, setJournalMessage] = useState('')
  const [playoffMessage, setPlayoffMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const sync = async () => {
      try {
        const nextState = parseTournamentState(await fetchTournamentState())
        if (isMounted) {
          setTournamentState(nextState)
        }
      } catch {
        if (isMounted) {
          setTournamentState(DEFAULT_STATE)
        }
      }
    }

    sync()
    const timerId = window.setInterval(sync, 3000)

    return () => {
      isMounted = false
      window.clearInterval(timerId)
    }
  }, [])

  const players = useMemo(() => tournamentState.players || [], [tournamentState.players])

  useEffect(() => {
    if (!selectedPlayerId && players.length > 0) {
      setSelectedPlayerId(players[0].id)
    }
  }, [players, selectedPlayerId])

  const filteredPlayers = useMemo(() => {
    const query = normalizePlayerName(playerSearch)
    if (!query) {
      return players
    }

    return players.filter((player) => {
      const haystack = [
        player.name,
        player.phone,
        player.gender === 'female' ? 'айым' : 'эркек',
        String(player.entryNumber || ''),
      ]
        .join(' ')
        .toLocaleLowerCase()
      return haystack.includes(query)
    })
  }, [players, playerSearch])

  const selectedPlayer = useMemo(
    () => players.find((player) => player.id === selectedPlayerId) || null,
    [players, selectedPlayerId],
  )
  const selectedDivisionId = selectedPlayer?.gender === 'female' ? 'female' : 'male'
  const selectedDivisionState = tournamentState.competitionDivisions?.[selectedDivisionId] || createEmptyCompetitionState()
  const activeRound = tournamentState.scoreSubmission?.activeRound || 1
  const assistantEnabled = Boolean(tournamentState.assistantScoringEnabled)
  const currentRoundScore = selectedPlayer ? tournamentState.scores?.[selectedPlayer.id]?.[activeRound] ?? '' : ''
  const currentRoundLocked = currentRoundScore !== '' && currentRoundScore !== null && currentRoundScore !== undefined
  const currentPlayoffMatch = selectedPlayer
    ? getPlayerPlayoffMatch(selectedDivisionState.bracket, selectedDivisionState.playoffStage, selectedPlayer.id)
    : null
  const isSelectedPlayerOne = currentPlayoffMatch?.p1?.id === selectedPlayer?.id
  const currentPlayoffRoundIndex =
    currentPlayoffMatch && currentPlayoffMatch.isFinal
      ? Math.max((selectedDivisionState.playoffFinalRounds?.[currentPlayoffMatch.id === 'final34' ? 'final34' : 'final12'] || 1) - 1, 0)
      : 0
  const currentPlayoffScore = currentPlayoffMatch
    ? currentPlayoffMatch.isFinal
      ? isSelectedPlayerOne
        ? currentPlayoffMatch.roundsP1?.[currentPlayoffRoundIndex] ?? ''
        : currentPlayoffMatch.roundsP2?.[currentPlayoffRoundIndex] ?? ''
      : isSelectedPlayerOne
        ? currentPlayoffMatch.s1 ?? ''
        : currentPlayoffMatch.s2 ?? ''
    : ''
  const currentPlayoffLocked = currentPlayoffMatch
    ? currentPlayoffMatch.isFinal
      ? isSelectedPlayerOne
        ? Boolean(currentPlayoffMatch.submittedRoundsP1?.[currentPlayoffRoundIndex])
        : Boolean(currentPlayoffMatch.submittedRoundsP2?.[currentPlayoffRoundIndex])
      : isSelectedPlayerOne
        ? Boolean(currentPlayoffMatch.submittedP1 || currentPlayoffMatch.submittedShootOffP1)
        : Boolean(currentPlayoffMatch.submittedP2 || currentPlayoffMatch.submittedShootOffP2)
    : false
  const playoffStageLabel =
    selectedDivisionState.playoffStage === 'final'
      ? `Финал ${currentPlayoffMatch?.id === 'final34' ? '3–4' : '1–2'}`
      : stageTitles[selectedDivisionState.playoffStage] || 'Жеке элек'

  const handleJournalSubmit = async (event) => {
    event.preventDefault()
    if (!selectedPlayer) {
      setJournalMessage('Адегенде оюнчу тандаңыз.')
      return
    }

    if (journalScore === '') {
      setJournalMessage('Упайды жазыңыз.')
      return
    }

    try {
      const nextState = parseTournamentState(
        await submitPlayerScore({
          playerId: selectedPlayer.id,
          score: journalScore,
          source: 'assistant',
        }),
      )

      setTournamentState(nextState)
      setJournalScore('')
      setJournalMessage('Журналга упай жазылды.')
    } catch (error) {
      setJournalMessage(error.message || 'Журналга упай жазуу мүмкүн болгон жок.')
    }
  }

  const handlePlayoffSubmit = async (event) => {
    event.preventDefault()
    if (!selectedPlayer) {
      setPlayoffMessage('Адегенде оюнчу тандаңыз.')
      return
    }

    if (!currentPlayoffMatch) {
      setPlayoffMessage('Бул оюнчу үчүн активдүү беттеш жок.')
      return
    }

    if (playoffScore === '') {
      setPlayoffMessage('Упайды жазыңыз.')
      return
    }

    try {
      const nextState = parseTournamentState(
        await submitPlayoffPlayerScore({
          playerId: selectedPlayer.id,
          score: playoffScore,
          source: 'assistant',
        }),
      )

      setTournamentState(nextState)
      setPlayoffScore('')
      setPlayoffMessage('Жеке элекке упай жазылды.')
    } catch (error) {
      setPlayoffMessage(error.message || 'Жеке элекке упай жазуу мүмкүн болгон жок.')
    }
  }

  return (
    <div className="app-shell assistant-shell">
      <div className="app-background" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-icon">★</div>
          <div>
            <p className="eyebrow">Жардамчы админ</p>
            <h1 className="brand-title">Упай киргизүү панели</h1>
          </div>
        </div>

        <div className="topbar__utility">
          <div className={`pill ${assistantEnabled ? '' : 'pill--muted'}`}>
            {assistantEnabled ? 'Помощник күйүк' : 'Помощник өчүк'}
          </div>
          <button type="button" className="secondary-button secondary-button--auto" onClick={() => window.open('/admin/', '_blank', 'noopener,noreferrer')}>
            Админди ачуу
          </button>
        </div>
      </header>

      <main className="page">
        <section className="hero-card assistant-banner">
          <div>
            <p className="eyebrow">Режим</p>
            <h2 className="hero-card__title">{assistantEnabled ? 'Жардамчы активдүү' : 'Жардамчы админ режимин күйгүзүңүз'}</h2>
            <p className="hero-card__text">
              Бул бет журналдагы жана жеке электеги упайларды админдин ордуна киргизүүгө жардам берет.
            </p>
          </div>
          <div className="hero-stats">
            <div className="stat-chip">
              <span className="stat-chip__label">Оюнчулар</span>
              <strong>{players.length}</strong>
            </div>
            <div className="stat-chip">
              <span className="stat-chip__label">Ачык айлампа</span>
              <strong>{activeRound}</strong>
            </div>
            <div className="stat-chip">
              <span className="stat-chip__label">Этап</span>
              <strong>{playoffStageLabel}</strong>
            </div>
          </div>
        </section>

        <div className="assistant-grid">
          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Оюнчу</p>
                <h3 className="panel__title">Тандаңыз</h3>
              </div>
            </div>

            <label className="field">
              <span className="field__label">Издөө</span>
              <input className="field__control" value={playerSearch} onChange={(event) => setPlayerSearch(event.target.value)} placeholder="Аты, телефон же жынысы" />
            </label>

            <div className="assistant-player-list">
              {filteredPlayers.length > 0 ? (
                filteredPlayers.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className={`assistant-player-button ${selectedPlayerId === player.id ? 'assistant-player-button--active' : ''}`}
                    onClick={() => setSelectedPlayerId(player.id)}
                  >
                    <strong>{player.name}</strong>
                    <span>
                      № {player.entryNumber || '—'} • {player.gender === 'female' ? 'Айым' : 'Эркек'} • {player.phone || 'Телефон жок'}
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-state">Оюнчу табылган жок.</div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <div>
                <p className="eyebrow">Упайлар</p>
                <h3 className="panel__title">{selectedPlayer ? selectedPlayer.name : 'Оюнчу тандаңыз'}</h3>
              </div>
              <div className="pill">Упай киргизүү</div>
            </div>

            <div className="assistant-preview">
              <div className="assistant-preview__match">
                <div className="assistant-preview__row">
                  <span>Жалпы упай</span>
                  <strong>{selectedPlayer ? calculateTotal(tournamentState.scores, selectedPlayer.id) : '—'}</strong>
                </div>
                <div className="assistant-preview__row">
                  <span>Журналдагы маани</span>
                  <strong>{selectedPlayer ? (currentRoundLocked ? currentRoundScore : 'жок') : '—'}</strong>
                </div>
                <div className="assistant-preview__row">
                  <span>Жеке элек</span>
                  <strong>{currentPlayoffMatch ? playoffStageLabel : 'жок'}</strong>
                </div>
              </div>
            </div>

            <form className="assistant-form" onSubmit={handleJournalSubmit}>
              <div className="field">
                <span className="field__label">Журнал, айлампа {activeRound}</span>
                <input
                  className="field__control"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={currentRoundLocked ? String(currentRoundScore) : journalScore}
                  onChange={(event) => setJournalScore(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                  disabled={!selectedPlayer || currentRoundLocked}
                  placeholder="0-30"
                />
              </div>

              <button type="submit" className="primary-button" disabled={!selectedPlayer || currentRoundLocked}>
                Журналга жазуу
              </button>

              {journalMessage && <p className="message-line">{journalMessage}</p>}
            </form>

            <form className="assistant-form" onSubmit={handlePlayoffSubmit} style={{ marginTop: '22px' }}>
              <div className="field">
                <span className="field__label">Жеке элек</span>
                <input
                  className="field__control"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={2}
                  value={currentPlayoffLocked ? String(currentPlayoffScore) : playoffScore}
                  onChange={(event) => setPlayoffScore(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                  disabled={!selectedPlayer || !currentPlayoffMatch || currentPlayoffLocked}
                  placeholder="0-30"
                />
              </div>

              <div className="assistant-preview__match">
                <div className="assistant-preview__row">
                  <span>Этап</span>
                  <strong>{playoffStageLabel}</strong>
                </div>
                <div className="assistant-preview__row">
                  <span>Каршы оюнчу</span>
                  <strong>
                    {currentPlayoffMatch
                      ? currentPlayoffMatch.p1?.id === selectedPlayer?.id
                        ? currentPlayoffMatch.p2?.name || '—'
                        : currentPlayoffMatch.p1?.name || '—'
                      : '—'}
                  </strong>
                </div>
              </div>

              <button type="submit" className="primary-button" disabled={!selectedPlayer || !currentPlayoffMatch || currentPlayoffLocked}>
                Жеке элекке жазуу
              </button>

              {playoffMessage && <p className="message-line">{playoffMessage}</p>}
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}
