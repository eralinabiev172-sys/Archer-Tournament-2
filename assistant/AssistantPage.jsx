import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchTournamentState, saveTournamentState, submitAssistantPlayoffPlayerScore } from '../shared/tournamentApi.js'
import { useTheme } from '../shared/useTheme.js'

const EMPTY_BRACKET = {
  roundOf32: [],
  roundOf16: [],
  quarterFinals: [],
  semiFinals: [],
  fifthPlaceSemiFinals: [],
  fifthPlaceFinal: null,
  fifthPlaceSentToReport: false,
  final12: null,
  final34: null,
  winners: [],
}

const TOURNAMENT_SYNC_KEY = 'tournament_state_sync_v1'

const SEED_ORDERS = {
  32: [0, 31, 15, 16, 7, 24, 8, 23, 4, 27, 11, 20, 3, 28, 12, 19, 2, 29, 13, 18, 5, 26, 10, 21, 6, 25, 9, 22, 1, 30, 14, 17],
  16: [0, 15, 7, 8, 4, 11, 3, 12, 2, 13, 5, 10, 6, 9, 1, 14],
  8: [0, 7, 3, 4, 1, 6, 2, 5],
  4: [0, 3, 1, 2],
}

const PLAYOFF_STAGE_KEYS_BY_MODE = {
  32: ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals'],
  16: ['roundOf16', 'quarterFinals', 'semiFinals'],
  8: ['quarterFinals', 'semiFinals'],
  4: ['semiFinals'],
}

const COMPETITION_DIVISIONS = [
  { id: 'all', label: 'Баары' },
  { id: 'male', label: 'Эркек' },
  { id: 'female', label: 'Айым' },
]

const PLAYOFF_STAGE_TITLES = {
  roundOf32: 'Топ-32',
  roundOf16: 'Топ-16',
  quarterFinals: 'Топ-8',
  semiFinals: 'Топ-4',
  fifthPlace: '5-место',
  final: 'Финал',
}

const ASSISTANT_DRAFTS_STORAGE_KEY = 'assistant_playoff_drafts_v1'
const FIFTH_PLACE_STAGE_KEYS = ['fifthPlaceSemiFinals', 'fifthPlaceFinal']

const getVisibleStageKeys = (playoffMode) => PLAYOFF_STAGE_KEYS_BY_MODE[playoffMode] || PLAYOFF_STAGE_KEYS_BY_MODE[8]
const getRoundIndex = (playoffMode, stageKey) => getVisibleStageKeys(playoffMode).indexOf(stageKey)
const getNextStageKey = (playoffMode, stageKey) => {
  const stageKeys = getVisibleStageKeys(playoffMode)
  const stageIndex = stageKeys.indexOf(stageKey)
  if (stageIndex < 0 || stageIndex >= stageKeys.length - 1) {
    return null
  }

  return stageKeys[stageIndex + 1]
}

const getStageMatchCount = (playoffMode, stageKey) => {
  const roundIndex = getRoundIndex(playoffMode, stageKey)
  if (roundIndex < 0) {
    return 0
  }

  return playoffMode / 2 ** (roundIndex + 1)
}

const getSeedNumbersForMatch = (playoffMode, stageKey, matchIndex) => {
  const initialStageKey = getVisibleStageKeys(playoffMode)[0]
  if (stageKey !== initialStageKey) {
    return null
  }

  const order = SEED_ORDERS[playoffMode]
  if (!order) {
    return null
  }

  return [order[matchIndex * 2] + 1, order[matchIndex * 2 + 1] + 1]
}

const createEmptyCompetitionState = () => ({
  playoffMode: 16,
  playoffStage: 'none',
  playoffFinalRounds: { final12: 1, final34: 1 },
  bracket: { ...EMPTY_BRACKET },
})

const createEmptyState = () => ({
  assistantScoringEnabled: false,
  version: 0,
  updatedAt: null,
  competitionDivisions: {
    all: createEmptyCompetitionState(),
    male: createEmptyCompetitionState(),
    female: createEmptyCompetitionState(),
  },
})

const normalizeCompetitionState = (value) => ({
  ...createEmptyCompetitionState(),
  ...(value || {}),
  playoffMode: [32, 16, 8, 4].includes(Number(value?.playoffMode)) ? Number(value.playoffMode) : 16,
  playoffStage: ['none', 'roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final', 'fifthPlace'].includes(value?.playoffStage)
    ? value.playoffStage
    : 'none',
  playoffFinalRounds: {
    final12: [1, 2, 3, 4, 5, 6].includes(Number(value?.playoffFinalRounds?.final12)) ? Number(value.playoffFinalRounds.final12) : 1,
    final34: [1, 2, 3, 4, 5, 6].includes(Number(value?.playoffFinalRounds?.final34)) ? Number(value.playoffFinalRounds.final34) : 1,
  },
  bracket: value?.bracket ? { ...EMPTY_BRACKET, ...value.bracket } : { ...EMPTY_BRACKET },
})

const normalizeState = (payload) => ({
  ...createEmptyState(),
  ...(payload || {}),
  assistantScoringEnabled: Boolean(payload?.assistantScoringEnabled),
  version: Number.isInteger(payload?.version) && payload.version >= 0 ? payload.version : 0,
  updatedAt: typeof payload?.updatedAt === 'string' || payload?.updatedAt === null ? payload.updatedAt : null,
  competitionDivisions: {
    all: normalizeCompetitionState(payload?.competitionDivisions?.all),
    male: normalizeCompetitionState(payload?.competitionDivisions?.male),
    female: normalizeCompetitionState(payload?.competitionDivisions?.female),
  },
})

const sanitizeScore = (value) => String(value || '').replace(/[^\d]/g, '').slice(0, 2)
const getStageScoreDraftKey = (divisionId, stageKey, playerId) => `${divisionId}:${stageKey}:${playerId}`
const getFinalScoreDraftKey = (divisionId, matchId, playerId, roundIndex) => `${divisionId}:${matchId}:${playerId}:${roundIndex}`

const createMatch = (id, p1, p2, isFinal = false) => ({
  id,
  p1,
  p2,
  s1: 0,
  s2: 0,
  shootOffS1: 0,
  shootOffS2: 0,
  s1_bot: 0,
  s2_bot: 0,
  winner: null,
  isFinal,
  roundsP1: Array(12).fill(0),
  roundsP2: Array(12).fill(0),
  submittedRoundsP1: Array(6).fill(false),
  submittedRoundsP2: Array(6).fill(false),
  submittedShootOffP1: false,
  submittedShootOffP2: false,
})

const mergeMatchState = (existingMatch, nextMatch) => {
  if (!existingMatch || existingMatch.p1?.id !== nextMatch.p1?.id || existingMatch.p2?.id !== nextMatch.p2?.id) {
    return nextMatch
  }

  return {
    ...nextMatch,
    s1: existingMatch.s1,
    s2: existingMatch.s2,
    shootOffS1: existingMatch.shootOffS1,
    shootOffS2: existingMatch.shootOffS2,
    s1_bot: existingMatch.s1_bot,
    s2_bot: existingMatch.s2_bot,
    winner: existingMatch.winner,
    roundsP1: Array.isArray(existingMatch.roundsP1) ? [...existingMatch.roundsP1] : [...nextMatch.roundsP1],
    roundsP2: Array.isArray(existingMatch.roundsP2) ? [...existingMatch.roundsP2] : [...nextMatch.roundsP2],
    submittedP1: Boolean(existingMatch.submittedP1),
    submittedP2: Boolean(existingMatch.submittedP2),
    submittedShootOffP1: Boolean(existingMatch.submittedShootOffP1),
    submittedShootOffP2: Boolean(existingMatch.submittedShootOffP2),
  }
}

const samePlayer = (left, right) => Boolean(left?.id && right?.id && left.id === right.id)
const sameMatchParticipants = (left, right) => samePlayer(left?.p1, right?.p1) && samePlayer(left?.p2, right?.p2)

const resolvePlayoffWinner = (match) => {
  if (!match) return null
  const isStandardMatch = !match.isFinal || match.id === 'fifthPlaceFinal'
  const hasSubmissionTracking =
    Object.prototype.hasOwnProperty.call(match, 'submittedP1') ||
    Object.prototype.hasOwnProperty.call(match, 'submittedP2') ||
    Object.prototype.hasOwnProperty.call(match, 'submittedShootOffP1') ||
    Object.prototype.hasOwnProperty.call(match, 'submittedShootOffP2')

  if (isStandardMatch && hasSubmissionTracking && (!match.submittedP1 || !match.submittedP2)) {
    return null
  }

  if (Number(match.s1) > Number(match.s2)) return match.p1
  if (Number(match.s2) > Number(match.s1)) return match.p2
  if (isStandardMatch) {
    if (hasSubmissionTracking && (!match.submittedShootOffP1 || !match.submittedShootOffP2)) {
      return null
    }
    if (Number(match.shootOffS1) > Number(match.shootOffS2)) return match.p1
    if (Number(match.shootOffS2) > Number(match.shootOffS1)) return match.p2
    return null
  }
  if (Number(match.s1_bot) > Number(match.s2_bot)) return match.p1
  if (Number(match.s2_bot) > Number(match.s1_bot)) return match.p2
  return null
}

const finalizeStandardMatchForAdvance = (match, resolveWinner) => {
  if (!match || (match.isFinal && match.id !== 'fifthPlaceFinal')) {
    return match
  }

  const nextMatch = { ...match }
  const mainScoresDiffer = Number(nextMatch.s1) !== Number(nextMatch.s2)
  if (mainScoresDiffer && (nextMatch.submittedP1 || nextMatch.submittedP2)) {
    if (!nextMatch.submittedP1 && Number(nextMatch.s1) === 0) {
      nextMatch.submittedP1 = true
    }

    if (!nextMatch.submittedP2 && Number(nextMatch.s2) === 0) {
      nextMatch.submittedP2 = true
    }
  }

  const shootOffScoresDiffer = Number(nextMatch.shootOffS1) !== Number(nextMatch.shootOffS2)
  if (
    Number(nextMatch.s1) === Number(nextMatch.s2) &&
    shootOffScoresDiffer &&
    (nextMatch.submittedShootOffP1 || nextMatch.submittedShootOffP2)
  ) {
    if (!nextMatch.submittedShootOffP1 && Number(nextMatch.shootOffS1) === 0) {
      nextMatch.submittedShootOffP1 = true
    }

    if (!nextMatch.submittedShootOffP2 && Number(nextMatch.shootOffS2) === 0) {
      nextMatch.submittedShootOffP2 = true
    }
  }

  nextMatch.winner = resolveWinner(nextMatch)
  return nextMatch
}

const getQuarterFinalLosers = (bracket) =>
  (bracket?.quarterFinals || [])
    .map((match) => {
      const winner = resolvePlayoffWinner(match)
      if (!winner) return null
      return winner.id === match.p1?.id ? match.p2 : match.p1
    })
    .filter(Boolean)

const syncFifthPlaceBracketState = (bracket) => {
  const nextBracket = { ...EMPTY_BRACKET, ...(bracket || {}) }
  const removeFifthPlaceFromReport = () => {
    nextBracket.fifthPlaceSentToReport = false
    nextBracket.winners = (nextBracket.winners || []).filter((entry) => entry.position !== 5)
  }

  const losers = getQuarterFinalLosers(nextBracket)
  if (losers.length !== 4) {
    nextBracket.fifthPlaceSemiFinals = []
    nextBracket.fifthPlaceFinal = null
    removeFifthPlaceFromReport()
    return nextBracket
  }

  const existingSemiFinals = Array.isArray(nextBracket.fifthPlaceSemiFinals) ? nextBracket.fifthPlaceSemiFinals : []
  const rebuiltSemiFinals = [
    mergeMatchState(existingSemiFinals[0], createMatch('fifthPlaceSemiFinals-0', losers[0], losers[1])),
    mergeMatchState(existingSemiFinals[1], createMatch('fifthPlaceSemiFinals-1', losers[2], losers[3])),
  ].map((match) => ({
    ...match,
    winner: resolvePlayoffWinner(finalizeStandardMatchForAdvance(match, resolvePlayoffWinner)),
  }))

  const semiFinalsChanged =
    existingSemiFinals.length !== rebuiltSemiFinals.length ||
    rebuiltSemiFinals.some((match, index) => !sameMatchParticipants(existingSemiFinals[index], match))

  nextBracket.fifthPlaceSemiFinals = rebuiltSemiFinals

  const semiFinalWinners = rebuiltSemiFinals.map((match) => match.winner).filter(Boolean)
  if (semiFinalWinners.length === 2) {
    const existingFinal = nextBracket.fifthPlaceFinal
    const rebuiltFinal = mergeMatchState(existingFinal, createMatch('fifthPlaceFinal', semiFinalWinners[0], semiFinalWinners[1]))
    const finalChanged = !sameMatchParticipants(existingFinal, rebuiltFinal)
    nextBracket.fifthPlaceFinal = {
      ...rebuiltFinal,
      winner: resolvePlayoffWinner(finalizeStandardMatchForAdvance(rebuiltFinal, resolvePlayoffWinner)),
    }

    if (semiFinalsChanged || finalChanged) {
      removeFifthPlaceFromReport()
    }
  } else {
    nextBracket.fifthPlaceFinal = null
    removeFifthPlaceFromReport()
  }

  if (nextBracket.fifthPlaceSentToReport && nextBracket.fifthPlaceFinal?.winner) {
    nextBracket.winners = [
      ...(nextBracket.winners || []).filter((entry) => entry.position !== 5),
      { position: 5, player: nextBracket.fifthPlaceFinal.winner },
    ].sort((left, right) => left.position - right.position)
  } else {
    removeFifthPlaceFromReport()
  }

  return nextBracket
}

const getStageMatches = (competitionState) => {
  if (!competitionState || competitionState.playoffStage === 'none') {
    return []
  }

  if (competitionState.playoffStage === 'final') {
    return [competitionState.bracket.final34, competitionState.bracket.final12].filter(Boolean)
  }

  if (competitionState.playoffStage === 'fifthPlace') {
    return competitionState.bracket.fifthPlaceFinal
      ? [competitionState.bracket.fifthPlaceFinal]
      : (competitionState.bracket.fifthPlaceSemiFinals || [])
  }

  return Array.isArray(competitionState.bracket?.[competitionState.playoffStage]) ? competitionState.bracket[competitionState.playoffStage] : []
}

const getStageMatchesByKey = (competitionState, stageKey) => {
  if (!competitionState || !stageKey || stageKey === 'none') {
    return []
  }

  if (stageKey === 'final') {
    return [competitionState.bracket.final34, competitionState.bracket.final12].filter(Boolean)
  }

  if (stageKey === 'fifthPlace') {
    return competitionState.bracket.fifthPlaceFinal
      ? [competitionState.bracket.fifthPlaceFinal]
      : (competitionState.bracket.fifthPlaceSemiFinals || [])
  }

  if (stageKey === 'fifthPlaceSemiFinals') {
    return competitionState.bracket.fifthPlaceSemiFinals || []
  }

  if (stageKey === 'fifthPlaceFinal') {
    return competitionState.bracket.fifthPlaceFinal ? [competitionState.bracket.fifthPlaceFinal] : []
  }

  return Array.isArray(competitionState.bracket?.[stageKey]) ? competitionState.bracket[stageKey] : []
}

const getPlayerScore = (match, playerId) => {
  if (!match) return ''

  if (match.isFinal) {
    if (match.p1?.id === playerId) {
      return match.s1 ?? ''
    }

    if (match.p2?.id === playerId) {
      return match.s2 ?? ''
    }
  }

  if (match.p1?.id === playerId) {
    return match.s1 ?? ''
  }

  if (match.p2?.id === playerId) {
    return match.s2 ?? ''
  }

  return ''
}

const getMatchRoundLabel = (competitionState, match) => {
  if (!match?.isFinal) {
    return PLAYOFF_STAGE_TITLES[competitionState.playoffStage] || 'Этап'
  }

  const roundKey = match.id === 'final34' ? 'final34' : 'final12'
  return `${PLAYOFF_STAGE_TITLES.final} • A${competitionState.playoffFinalRounds?.[roundKey] || 1}`
}

const createEmptyAssistantDraftState = () => ({
  drafts: {},
  savedDrafts: {},
})

const loadAssistantDraftState = () => {
  if (typeof window === 'undefined') {
    return createEmptyAssistantDraftState()
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(ASSISTANT_DRAFTS_STORAGE_KEY) || '{}')
    return {
      drafts: parsed?.drafts && typeof parsed.drafts === 'object' ? parsed.drafts : {},
      savedDrafts: parsed?.savedDrafts && typeof parsed.savedDrafts === 'object' ? parsed.savedDrafts : {},
    }
  } catch {
    return createEmptyAssistantDraftState()
  }
}

export default function AssistantPage({ onLogout }) {
  const { theme, toggleTheme } = useTheme()
  const [tournamentState, setTournamentState] = useState(createEmptyState)
  const [selectedDivision, setSelectedDivision] = useState('all')
  const [assistantView, setAssistantView] = useState('main')
  const initialAssistantDraftState = useMemo(() => loadAssistantDraftState(), [])
  const [scoreDrafts, setScoreDrafts] = useState(initialAssistantDraftState.drafts)
  const [savedScoreDrafts, setSavedScoreDrafts] = useState(initialAssistantDraftState.savedDrafts)
  const [statusMessage, setStatusMessage] = useState('')
  const [divisionMessage, setDivisionMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const stateVersionRef = useRef(0)
  const stateUpdatedAtRef = useRef(null)

  useEffect(() => {
    stateVersionRef.current = Number.isInteger(tournamentState.version) ? tournamentState.version : 0
    stateUpdatedAtRef.current = typeof tournamentState.updatedAt === 'string' || tournamentState.updatedAt === null ? tournamentState.updatedAt : null
  }, [tournamentState.updatedAt, tournamentState.version])

  useEffect(() => {
    let isMounted = true

    const syncFromServer = async () => {
      try {
        const nextState = normalizeState(await fetchTournamentState())
        if (isMounted) {
          setTournamentState(nextState)
          setDivisionMessage('')
        }
      } catch (error) {
        if (isMounted) {
          setDivisionMessage(error.message || 'Сервер менен байланыш жок.')
        }
      }
    }

    syncFromServer()
    const intervalId = window.setInterval(syncFromServer, 3000)
    const handleTournamentSync = (event) => {
      if (event.key === TOURNAMENT_SYNC_KEY) {
        syncFromServer()
      }
    }

    window.addEventListener('storage', handleTournamentSync)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      window.removeEventListener('storage', handleTournamentSync)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      ASSISTANT_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        drafts: scoreDrafts,
        savedDrafts: savedScoreDrafts,
      }),
    )
  }, [scoreDrafts, savedScoreDrafts])

  const activeCompetitionState = useMemo(
    () => normalizeCompetitionState(tournamentState.competitionDivisions?.[selectedDivision]),
    [selectedDivision, tournamentState.competitionDivisions],
  )

  const assistantEnabled = Boolean(tournamentState.assistantScoringEnabled)
  const stageOptions = useMemo(
    () =>
      getVisibleStageKeys(activeCompetitionState.playoffMode).map((stageKey) => ({
        id: stageKey,
        label: PLAYOFF_STAGE_TITLES[stageKey],
      })),
    [activeCompetitionState.playoffMode],
  )
  const stageNavigationOptions = useMemo(
    () => [...stageOptions, { id: 'final', label: PLAYOFF_STAGE_TITLES.final }],
    [stageOptions],
  )
  const isFifthPlaceView = assistantView === 'fifthPlace'
  const currentAssistantStage =
    isFifthPlaceView
      ? 'fifthPlace'
      : activeCompetitionState.playoffStage === 'fifthPlace'
        ? 'none'
        : activeCompetitionState.playoffStage

  const stageLabel = activeCompetitionState.playoffStage === 'final' ? 'Финал' : PLAYOFF_STAGE_TITLES[activeCompetitionState.playoffStage] || 'Тандоо жок'
  const hasPendingDrafts = useMemo(() => {
    if (currentAssistantStage === 'final') {
      return [activeCompetitionState.bracket.final34, activeCompetitionState.bracket.final12]
        .filter(Boolean)
        .some((match) => {
          const activeRoundCount = match.id === 'final34' ? activeCompetitionState.playoffFinalRounds.final34 : activeCompetitionState.playoffFinalRounds.final12
          return [match.p1, match.p2].filter(Boolean).some((player) =>
            Array.from({ length: activeRoundCount }, (_, roundIndex) => roundIndex).some((roundIndex) => {
              const draftKey = getFinalScoreDraftKey(selectedDivision, match.id, player.id, roundIndex)
              return sanitizeScore(scoreDrafts[draftKey] || '') !== ''
            }),
          )
        })
    }

    if (!['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'fifthPlace'].includes(currentAssistantStage)) {
      return false
    }

    if (currentAssistantStage === 'fifthPlace') {
      return FIFTH_PLACE_STAGE_KEYS.some((stageKey) =>
        getStageMatchesByKey(activeCompetitionState, stageKey).some((match) =>
          [match?.p1, match?.p2].filter(Boolean).some((player) => {
            const draftKey = getStageScoreDraftKey(selectedDivision, stageKey, player.id)
            return sanitizeScore(scoreDrafts[draftKey] || '') !== ''
          }),
        ),
      )
    }

    return getStageMatchesByKey(activeCompetitionState, currentAssistantStage).some((match) =>
      [match?.p1, match?.p2].filter(Boolean).some((player) => {
        const draftKey = getStageScoreDraftKey(selectedDivision, currentAssistantStage, player.id)
        return sanitizeScore(scoreDrafts[draftKey] || '') !== ''
      }),
    )
  }, [activeCompetitionState.bracket, activeCompetitionState.playoffFinalRounds.final12, activeCompetitionState.playoffFinalRounds.final34, currentAssistantStage, scoreDrafts, selectedDivision])
  const hasSavedDraftsForCurrentStage = useMemo(() => {
    if (currentAssistantStage === 'final') {
      return [activeCompetitionState.bracket.final34, activeCompetitionState.bracket.final12]
        .filter(Boolean)
        .some((match) => {
          const activeRoundCount = match.id === 'final34' ? activeCompetitionState.playoffFinalRounds.final34 : activeCompetitionState.playoffFinalRounds.final12
          return [match.p1, match.p2].filter(Boolean).some((player) =>
            Array.from({ length: activeRoundCount }, (_, roundIndex) => roundIndex).some((roundIndex) => {
              const draftKey = getFinalScoreDraftKey(selectedDivision, match.id, player.id, roundIndex)
              return sanitizeScore(savedScoreDrafts[draftKey] || '') !== ''
            }),
          )
        })
    }

    if (!['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'fifthPlace'].includes(currentAssistantStage)) {
      return false
    }

    if (currentAssistantStage === 'fifthPlace') {
      return FIFTH_PLACE_STAGE_KEYS.some((stageKey) =>
        getStageMatchesByKey(activeCompetitionState, stageKey).some((match) =>
          [match?.p1, match?.p2].filter(Boolean).some((player) => {
            const draftKey = getStageScoreDraftKey(selectedDivision, stageKey, player.id)
            return sanitizeScore(savedScoreDrafts[draftKey] || '') !== ''
          }),
        ),
      )
    }

    return getStageMatchesByKey(activeCompetitionState, currentAssistantStage).some((match) =>
      [match?.p1, match?.p2].filter(Boolean).some((player) => {
        const draftKey = getStageScoreDraftKey(selectedDivision, currentAssistantStage, player.id)
        return sanitizeScore(savedScoreDrafts[draftKey] || '') !== ''
      }),
    )
  }, [activeCompetitionState.bracket, activeCompetitionState.playoffFinalRounds.final12, activeCompetitionState.playoffFinalRounds.final34, currentAssistantStage, savedScoreDrafts, selectedDivision])
  const hasUnsavedDraftChanges = useMemo(() => {
    const currentDraftKeys = Object.keys(scoreDrafts)
    const savedDraftKeys = Object.keys(savedScoreDrafts)

    if (currentDraftKeys.length !== savedDraftKeys.length) {
      return true
    }

    for (const key of currentDraftKeys) {
      if (scoreDrafts[key] !== savedScoreDrafts[key]) {
        return true
      }
    }

    return false
  }, [scoreDrafts, savedScoreDrafts])
  const stageColumns = useMemo(
    () =>
      stageOptions.map((option) => ({
        ...option,
        isActive: activeCompetitionState.playoffStage === option.id,
        matches: Array.isArray(activeCompetitionState.bracket?.[option.id]) ? activeCompetitionState.bracket[option.id] : [],
      })),
    [activeCompetitionState.bracket, activeCompetitionState.playoffStage, stageOptions],
  )
  const hasFinalMatches = Boolean(activeCompetitionState.bracket.final12 || activeCompetitionState.bracket.final34)
  const canOpenFifthPlace = getQuarterFinalLosers(activeCompetitionState.bracket).length === 4
  const hasFifthPlaceBracket = Boolean((activeCompetitionState.bracket.fifthPlaceSemiFinals || []).length || activeCompetitionState.bracket.fifthPlaceFinal)
  const fifthPlaceWinner = activeCompetitionState.bracket.fifthPlaceFinal?.winner || null
  const fifthPlaceSavedToReport = Boolean(
    activeCompetitionState.bracket.fifthPlaceSentToReport &&
      (activeCompetitionState.bracket.winners || []).some((entry) => entry.position === 5),
  )
  const fifthPlaceStages = [
    {
      id: 'fifthPlaceSemiFinals',
      label: PLAYOFF_STAGE_TITLES.fifthPlace,
      matches: activeCompetitionState.bracket.fifthPlaceSemiFinals || [],
    },
    {
      id: 'fifthPlaceFinal',
      label: '5-место финал',
      matches: activeCompetitionState.bracket.fifthPlaceFinal ? [activeCompetitionState.bracket.fifthPlaceFinal] : [],
    },
  ].filter((stage) => stage.matches.length > 0)

  const handleSendFifthPlaceToReport = async () => {
    setIsSaving(true)
    try {
      const latestState = normalizeState(await fetchTournamentState())
      setTournamentState(latestState)
      const currentDivisionState = normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision])
      const resolvedFifthPlaceWinner = currentDivisionState.bracket.fifthPlaceFinal?.winner || null

      if (!resolvedFifthPlaceWinner) {
        setStatusMessage('5-местонун жеңүүчүсү азырынча аныктала элек.')
        return
      }

      const savedState = await saveSelectedDivisionState(
        latestState,
        {
          ...currentDivisionState,
          bracket: {
            ...currentDivisionState.bracket,
            fifthPlaceSentToReport: true,
            winners: [
              ...(currentDivisionState.bracket.winners || []).filter((entry) => entry.position !== 5),
              { position: 5, player: resolvedFifthPlaceWinner },
            ].sort((left, right) => left.position - right.position),
          },
        },
        `${resolvedFifthPlaceWinner.name} отчётко 5-место болуп кошулду.`,
      )
      setTournamentState(savedState)
      setAssistantView('fifthPlace')
    } catch (error) {
      setStatusMessage(error.message || '5-местону отчётко жөнөтүү мүмкүн болгон жок.')
    } finally {
      setIsSaving(false)
    }
  }

  const saveSelectedDivisionState = async (latestState, nextDivisionState, message) => {
    const nextState = normalizeState({
      ...latestState,
      version: stateVersionRef.current,
      updatedAt: stateUpdatedAtRef.current,
      competitionDivisions: {
        ...latestState.competitionDivisions,
        [selectedDivision]: normalizeCompetitionState(nextDivisionState),
      },
    })
    try {
      const savedState = normalizeState(await saveTournamentState(nextState))
      setTournamentState(savedState)
      setStatusMessage(message)
      return savedState
    } catch (error) {
      if (error?.code === 'STATE_CONFLICT' && error.currentState) {
        const latestServerState = normalizeState(error.currentState)
        setTournamentState(latestServerState)
        setStatusMessage('Башка терезеде жаңы өзгөртүү сакталгандыктан бул бөлүм акыркы абал менен жаңыртылды.')
        return latestServerState
      }

      throw error
    }
  }

  const handleOpenFifthPlace = async () => {
    setIsSaving(true)
    try {
      let latestState = normalizeState(await fetchTournamentState())
      setTournamentState(latestState)
      if (hasPendingDrafts) {
        latestState = (await handleBatchSubmit(scoreDrafts, true)) || latestState
      }

      const currentDivisionState = normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision])
      const resolvedQuarterFinalLosers = getQuarterFinalLosers(currentDivisionState.bracket)
      const syncedFifthPlaceBracket = syncFifthPlaceBracketState(currentDivisionState.bracket)
      const hasExistingFifthPlaceBracket = Boolean(
        (currentDivisionState.bracket.fifthPlaceSemiFinals || []).length || currentDivisionState.bracket.fifthPlaceFinal,
      )

      if (resolvedQuarterFinalLosers.length !== 4 && !hasExistingFifthPlaceBracket) {
        setStatusMessage('5-место үчүн Топ-8деги 4 утулган оюнчу керек.')
        return
      }

      const shouldSaveSyncedBracket =
        currentDivisionState.playoffStage !== 'fifthPlace' ||
        JSON.stringify(currentDivisionState.bracket) !== JSON.stringify(syncedFifthPlaceBracket)

      if (shouldSaveSyncedBracket) {
        await saveSelectedDivisionState(
          latestState,
          {
            ...currentDivisionState,
            playoffStage: 'fifthPlace',
            bracket: syncedFifthPlaceBracket,
          },
          hasExistingFifthPlaceBracket ? '5-место жаңыртылды.' : '5-место ачылды.',
        )
      }
      setAssistantView('fifthPlace')
    } catch (error) {
      setStatusMessage(error.message || '5-место ачуу мүмкүн болгон жок.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleFifthPlaceForward = async () => {
    setIsSaving(true)
    try {
      let latestState = normalizeState(await fetchTournamentState())
      setTournamentState(latestState)
      const hadFifthPlaceFinal = Boolean(normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision]).bracket.fifthPlaceFinal)
      if (hasPendingDrafts) {
        latestState = (await handleBatchSubmit(scoreDrafts, true)) || latestState
        latestState = normalizeState(await fetchTournamentState())
        setTournamentState(latestState)
      }

      const currentDivisionState = normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision])
      const syncedBracket = syncFifthPlaceBracketState(currentDivisionState.bracket)

      if (!hadFifthPlaceFinal && syncedBracket.fifthPlaceFinal) {
        const savedState = await saveSelectedDivisionState(
          latestState,
          {
            ...currentDivisionState,
            playoffStage: 'fifthPlace',
            bracket: syncedBracket,
          },
          '5-местонун финалы ачылды.',
        )
        setTournamentState(savedState)
        setAssistantView('fifthPlace')
        return
      }

      if (!syncedBracket.fifthPlaceFinal) {
        setStatusMessage('Адегенде 5-местонун эки беттешинин упайын толтуруңуз.')
        return
      }

      const normalizedFifthPlaceFinal = finalizeStandardMatchForAdvance(
        syncedBracket.fifthPlaceFinal,
        resolvePlayoffWinner,
      )
      const fifthWinner = resolvePlayoffWinner(normalizedFifthPlaceFinal)
      if (!fifthWinner) {
        setStatusMessage('5-местонун финалындагы упайлар толук эмес.')
        return
      }

      const savedState = await saveSelectedDivisionState(
        latestState,
        {
          ...currentDivisionState,
          playoffStage: 'fifthPlace',
          bracket: {
            ...syncedBracket,
            fifthPlaceFinal: {
              ...normalizedFifthPlaceFinal,
              winner: fifthWinner,
            },
            fifthPlaceSentToReport: false,
            winners: (syncedBracket.winners || []).filter((entry) => entry.position !== 5),
          },
        },
        `${fifthWinner.name} 5-местону утту. Эми отчётко өзүнчө жөнөтсө болот.`,
      )
      setTournamentState(savedState)
      setAssistantView('fifthPlace')
    } catch (error) {
      setStatusMessage(error.message || '5-местону алдыга жылдыруу мүмкүн болгон жок.')
    } finally {
      setIsSaving(false)
    }
  }
  const handleAssistantToggle = async (nextValue) => {
    setIsSaving(true)
    try {
      const nextState = normalizeState(
        await saveTournamentState({
          ...tournamentState,
          assistantScoringEnabled: nextValue,
        }),
      )
      setTournamentState(nextState)
      setStatusMessage(nextValue ? 'Жардамчы режими күйгүзүлдү.' : 'Жардамчы режими өчүрүлдү.')
    } catch (error) {
      setStatusMessage(error.message || 'Режимди өзгөртүү мүмкүн болгон жок.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleStageChange = async (stageKey) => {
    setIsSaving(true)
    try {
      let latestState = tournamentState

      if (hasPendingDrafts) {
        latestState = (await handleBatchSubmit(scoreDrafts, true)) || latestState
      }

      const nextState = normalizeState({
        ...latestState,
        competitionDivisions: {
          ...latestState.competitionDivisions,
          [selectedDivision]: {
            ...normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision]),
            playoffStage: stageKey,
          },
        },
      })
      const savedState = normalizeState(await saveTournamentState(nextState))
      setTournamentState(savedState)
      setStatusMessage(stageKey === 'final' ? '????? ??????.' : `${PLAYOFF_STAGE_TITLES[stageKey] || '????'} ??????.`)
    } catch (error) {
      setStatusMessage(error.message || '?????? ???????? ?????? ?????? ???.')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePlayoffForward = async () => {
    setIsSaving(true)
    try {
      let latestState = normalizeState(await fetchTournamentState())
      setTournamentState(latestState)

      if (hasPendingDrafts) {
        latestState = (await handleBatchSubmit(scoreDrafts)) || latestState
        latestState = normalizeState(await fetchTournamentState())
        setTournamentState(latestState)
      }

      const currentDivisionState = normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision])
      const currentStage = currentDivisionState.playoffStage

      if (!['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final'].includes(currentStage)) {
        setStatusMessage('Алга жылдыруу үчүн активдүү плей-офф этабы керек.')
        return
      }

      if (currentStage === 'final') {
        const final12Winner = resolvePlayoffWinner(currentDivisionState.bracket.final12)
        const final34Winner = resolvePlayoffWinner(currentDivisionState.bracket.final34)

        if (!final12Winner || !final34Winner) {
          setStatusMessage('Финал менен 3-4 орун беттешинин упайларын толук киргизиңиз.')
          return
        }

        const silver = final12Winner.id === currentDivisionState.bracket.final12.p1?.id
          ? currentDivisionState.bracket.final12.p2
          : currentDivisionState.bracket.final12.p1
        const fourth = final34Winner.id === currentDivisionState.bracket.final34.p1?.id
          ? currentDivisionState.bracket.final34.p2
          : currentDivisionState.bracket.final34.p1
        const savedState = await saveSelectedDivisionState(
          latestState,
          {
            ...currentDivisionState,
            bracket: {
              ...currentDivisionState.bracket,
              final12: {
                ...currentDivisionState.bracket.final12,
                winner: final12Winner,
              },
              final34: {
                ...currentDivisionState.bracket.final34,
                winner: final34Winner,
              },
              winners: [
                { position: 1, player: final12Winner },
                { position: 2, player: silver },
                { position: 3, player: final34Winner },
                { position: 4, player: fourth },
              ],
            },
          },
          'Финалдын жыйынтыгы сакталды.',
        )
        setTournamentState(savedState)
        return
      }

      const currentMatches = Array.isArray(currentDivisionState.bracket?.[currentStage]) ? currentDivisionState.bracket[currentStage] : []
      if (!currentMatches.length) {
        setStatusMessage('Бул этапта беттештер табылган жок.')
        return
      }

      const normalizedMatches = currentMatches.map((match) => finalizeStandardMatchForAdvance(match, resolvePlayoffWinner))
      const winners = normalizedMatches.map((match) => resolvePlayoffWinner(match))
      if (winners.some((winner) => !winner)) {
        setStatusMessage('Адегенде бул этаптагы бардык упайларды толук киргизиңиз.')
        return
      }

      if (currentStage === 'semiFinals') {
        const losers = normalizedMatches.map((match) => (resolvePlayoffWinner(match)?.id === match.p1?.id ? match.p2 : match.p1))
        const savedState = await saveSelectedDivisionState(
          latestState,
          {
            ...currentDivisionState,
            playoffStage: 'final',
            bracket: {
              ...currentDivisionState.bracket,
              semiFinals: normalizedMatches,
              final12: mergeMatchState(currentDivisionState.bracket.final12, createMatch('final12', winners[0], winners[1], true)),
              final34: mergeMatchState(currentDivisionState.bracket.final34, createMatch('final34', losers[0], losers[1], true)),
            },
          },
          'Финал ачылды.',
        )
        setTournamentState(savedState)
        return
      }

      const nextStageKey = getNextStageKey(currentDivisionState.playoffMode, currentStage)
      if (!nextStageKey) {
        setStatusMessage('Кийинки этап табылган жок.')
        return
      }

      const existingNextMatches = Array.isArray(currentDivisionState.bracket?.[nextStageKey]) ? currentDivisionState.bracket[nextStageKey] : []
      const nextMatches = []
      for (let index = 0; index < winners.length; index += 2) {
        nextMatches.push(
          mergeMatchState(
            existingNextMatches[index / 2],
            createMatch(`${nextStageKey}-${index}`, winners[index], winners[index + 1]),
          ),
        )
      }

      const savedState = await saveSelectedDivisionState(
        latestState,
        {
          ...currentDivisionState,
          playoffStage: nextStageKey,
          bracket: {
            ...currentDivisionState.bracket,
            [currentStage]: normalizedMatches,
            [nextStageKey]: nextMatches,
          },
        },
        `${PLAYOFF_STAGE_TITLES[nextStageKey] || 'Кийинки этап'} ачылды.`,
      )
      setTournamentState(savedState)
    } catch (error) {
      setStatusMessage(error.message || 'Плей-оффту алдыга жылдыруу мүмкүн болгон жок.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleFinalRoundChange = async (finalKey, nextRound) => {
    setIsSaving(true)
    try {
      let latestState = tournamentState

      if (hasPendingDrafts) {
        latestState = (await handleBatchSubmit(scoreDrafts, true)) || latestState
      }

      const safeRound = Math.min(Math.max(Number(nextRound) || 1, 1), 6)
      const currentDivisionState = normalizeCompetitionState(latestState.competitionDivisions?.[selectedDivision])
      const nextState = normalizeState({
        ...latestState,
        competitionDivisions: {
          ...latestState.competitionDivisions,
          [selectedDivision]: {
            ...currentDivisionState,
            playoffStage: 'final',
            playoffFinalRounds: {
              ...currentDivisionState.playoffFinalRounds,
              [finalKey]: safeRound,
            },
          },
        },
      })
      const savedState = normalizeState(await saveTournamentState(nextState))
      setTournamentState(savedState)
      setStatusMessage(`Финал ${finalKey === 'final34' ? '3-4' : '1-2'} үчүн A${safeRound} тандалды.`)
    } catch (error) {
      setStatusMessage(error.message || 'Финалдын айлампасын өзгөртүү мүмкүн болгон жок.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveDrafts = () => {
    setSavedScoreDrafts(scoreDrafts)
    setStatusMessage('Упайлар сакталды. Эми “Админ панелге жөнөтүү” бассаңыз болот.')
  }

  const handleBatchSubmit = async (sourceDrafts = scoreDrafts) => {

    const submissions = []

    if (currentAssistantStage === 'final') {
      for (const match of [activeCompetitionState.bracket.final34, activeCompetitionState.bracket.final12].filter(Boolean)) {
        const currentRoundCount = match.id === 'final34' ? activeCompetitionState.playoffFinalRounds.final34 : activeCompetitionState.playoffFinalRounds.final12
        for (const player of [match.p1, match.p2].filter(Boolean)) {
          for (let roundIndex = 0; roundIndex < currentRoundCount; roundIndex += 1) {
            const draftKey = getFinalScoreDraftKey(selectedDivision, match.id, player.id, roundIndex)
            const score = sanitizeScore(sourceDrafts[draftKey] || '')
            if (score === '') continue
            submissions.push({ draftKey, payload: { playerId: player.id, score, roundIndex, divisionId: selectedDivision, stageKey: 'final' } })
          }
        }
      }
    } else if (currentAssistantStage === 'fifthPlace') {
      for (const stageKey of FIFTH_PLACE_STAGE_KEYS) {
        for (const match of getStageMatchesByKey(activeCompetitionState, stageKey)) {
          for (const player of [match?.p1, match?.p2].filter(Boolean)) {
            const draftKey = getStageScoreDraftKey(selectedDivision, stageKey, player.id)
            const score = sanitizeScore(sourceDrafts[draftKey] || '')
            if (score === '') continue
            submissions.push({ draftKey, payload: { playerId: player.id, score, divisionId: selectedDivision, stageKey } })
          }
        }
      }
    } else {
      for (const match of getStageMatchesByKey(activeCompetitionState, currentAssistantStage)) {
        for (const player of [match?.p1, match?.p2].filter(Boolean)) {
          const draftKey = getStageScoreDraftKey(selectedDivision, currentAssistantStage, player.id)
          const score = sanitizeScore(sourceDrafts[draftKey] || '')
          if (score === '') continue
          submissions.push({ draftKey, payload: { playerId: player.id, score, divisionId: selectedDivision, stageKey: currentAssistantStage } })
        }
      }
    }

    if (submissions.length === 0) {
      setStatusMessage('Жөнөтө турган упай жок, адегенде маанилерди толтуруп коюңуз.')
      return null
    }

    setIsSaving(true)
    try {
      let nextState = tournamentState
      for (const submission of submissions) {
        nextState = normalizeState(await submitAssistantPlayoffPlayerScore(submission.payload))
        setTournamentState(nextState)
        setScoreDrafts((current) => {
          const nextDrafts = { ...current }
          delete nextDrafts[submission.draftKey]
          return nextDrafts
        })
        setSavedScoreDrafts((current) => {
          const nextDrafts = { ...current }
          delete nextDrafts[submission.draftKey]
          return nextDrafts
        })
      }
      setStatusMessage('Упайлар админ панелине жөнөтүлдү.')
      return nextState
    } catch (error) {
      setStatusMessage(error.message || 'Упайларды жөнөтүү мүмкүн болгон жок.')
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const setDraftForPlayer = (playerId, value) => {
    setScoreDrafts((current) => ({
      ...current,
      [playerId]: sanitizeScore(value),
    }))
  }

  return (
    <div className="app-shell assistant-shell">
      <div className="app-background" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-icon">A</div>
          <div>
            <p className="eyebrow">Жардамчы админ</p>
            <h1 className="brand-title">Плей-офф жардамчысы</h1>
          </div>
        </div>

        <div className="topbar__utility">
          <button type="button" className="theme-toggle" onClick={toggleTheme}>
            <span>{theme === 'dark' ? 'Караңгы' : 'Жарык'}</span>
          </button>
          <button type="button" className="theme-toggle assistant-link-button" onClick={() => window.location.assign('/admin/')}>
            Админге
          </button>
          <button type="button" className="theme-toggle assistant-link-button" onClick={onLogout}>
            Чыгуу
          </button>
        </div>
      </header>

      <main className="page assistant-page">
        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Жардамчы режим</p>
              <h2 className="panel__title">Оюнчулардын упайын киргизүү</h2>
            </div>
            <div className="pill">{assistantEnabled ? 'Күйүк' : 'Өчүк'}</div>
          </div>

          <div className="assistant-toolbar">
            <div className="mode-switch">
              <button
                type="button"
                className={`mode-switch__button ${!assistantEnabled ? 'mode-switch__button--active' : ''}`}
                onClick={() => handleAssistantToggle(false)}
                disabled={isSaving}
              >
                Өчүк
              </button>
              <button
                type="button"
                className={`mode-switch__button ${assistantEnabled ? 'mode-switch__button--active' : ''}`}
                onClick={() => handleAssistantToggle(true)}
                disabled={isSaving}
              >
                Күйүк
              </button>
            </div>

            <div className="assistant-toolbar__hint">
              {assistantEnabled
                ? 'Бул режимде оюнчулар сайтта упай киргизе албайт. Плей-офф упайын азыр жардамчы админ гана жазат.'
                : 'Өчүк режим: оюнчулар өздөрү упай киргизе алат.'}
            </div>
          </div>

          <div className="mode-switch assistant-division-switch">
            {COMPETITION_DIVISIONS.map((division) => (
              <button
                key={division.id}
                type="button"
                className={`mode-switch__button ${selectedDivision === division.id ? 'mode-switch__button--active' : ''}`}
                onClick={() => setSelectedDivision(division.id)}
              >
                {division.label}
              </button>
            ))}
          </div>

          <div className="mode-switch assistant-stage-switch">
            {stageNavigationOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`mode-switch__button ${activeCompetitionState.playoffStage === option.id ? 'mode-switch__button--active' : ''}`}
                onClick={() => (option.id === 'final' ? handleStageChange('final') : handleStageChange(option.id))}
                disabled={isSaving}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="assistant-fifth-place-actions">
            <button
              type="button"
              className="secondary-button secondary-button--auto"
              onClick={handleOpenFifthPlace}
              disabled={isSaving || (!canOpenFifthPlace && !hasFifthPlaceBracket)}
            >
              {hasFifthPlaceBracket ? '5-местого өтүү' : '5-место'}
            </button>
            {isFifthPlaceView && (
              <button
                type="button"
                className="secondary-button secondary-button--auto"
                onClick={() => setAssistantView('main')}
                disabled={isSaving}
              >
                Артка
              </button>
            )}
          </div>

          <div className="assistant-stage-banner">
            <strong>{currentAssistantStage === 'final' ? 'Финал' : PLAYOFF_STAGE_TITLES[currentAssistantStage] || 'Тандоо жок'}</strong>
            <span>Топ: {activeCompetitionState.playoffMode}</span>
            <span>Этап: {activeCompetitionState.playoffStage === 'none' ? 'Жок' : activeCompetitionState.playoffStage}</span>
          </div>

          {divisionMessage && <p className="message-line">{divisionMessage}</p>}
          {statusMessage && <p className="message-line">{statusMessage}</p>}
        </section>

        <section className="panel">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Плей-офф</p>
              <h3 className="panel__title">Сетка жана упай киргизүү</h3>
            </div>
            <div className="pill">Админдеги сыяктуу сетка</div>
          </div>

          {isFifthPlaceView ? (
            fifthPlaceStages.length > 0 ? (
              <div
                className="bracket-grid"
                style={{
                  '--bracket-column-count': fifthPlaceStages.length + (fifthPlaceWinner ? 1 : 0),
                  '--bracket-column-width': '280px',
                  '--bracket-column-gap': '40px',
                }}
              >
                {fifthPlaceStages.map((stage, index) => (
                  <EditableStageColumn
                    key={stage.id}
                    divisionId={selectedDivision}
                    stageKey={stage.id}
                    title={stage.label}
                    playoffMode={4}
                    stageIndex={index}
                    matches={stage.matches}
                    isActive
                    canEdit={activeCompetitionState.playoffStage === 'fifthPlace'}
                    scoreDrafts={scoreDrafts}
                    onDraftChange={setDraftForPlayer}
                    onScoreSubmit={handleBatchSubmit}
                    isSaving={isSaving}
                    assistantEnabled={assistantEnabled}
                  />
                ))}

                {fifthPlaceWinner && (
                  <div className="stage-column stage-column--winner stage-column--winner-fifth">
                    <div className="stage-column__header">
                      <p className="stage-column__eyebrow">Жеңүүчү</p>
                      <h4>5-место</h4>
                    </div>

                    <div className="stage-column__matches">
                      <div className="bracket-match-slot bracket-match-slot--winner">
                        <article className="playoff-card playoff-card--winner">
                          <div className="playoff-row playoff-row--winner">
                            <div className="playoff-row__identity">
                              <span className="playoff-row__name">{fifthPlaceWinner.name}</span>
                            </div>
                            <div className="playoff-row__score">
                              {activeCompetitionState.bracket.fifthPlaceFinal?.winner?.id === activeCompetitionState.bracket.fifthPlaceFinal?.p1?.id
                                ? activeCompetitionState.bracket.fifthPlaceFinal?.s1
                                : activeCompetitionState.bracket.fifthPlaceFinal?.s2}
                            </div>
                          </div>
                        </article>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">5-место азырынча ачыла элек.</div>
            )
          ) : stageColumns.length > 0 ? (
            <div
              className="bracket-grid"
              style={{
                '--bracket-column-count': stageColumns.length + (hasFinalMatches ? 1 : 0),
                '--bracket-column-width': activeCompetitionState.playoffMode === 32 ? '248px' : activeCompetitionState.playoffMode === 16 ? '264px' : '280px',
                '--bracket-column-gap': activeCompetitionState.playoffMode === 32 ? '34px' : activeCompetitionState.playoffMode === 16 ? '40px' : '48px',
              }}
            >
              {stageColumns.map((stage, index) => (
                <EditableStageColumn
                  key={stage.id}
                  divisionId={selectedDivision}
                  stageKey={stage.id}
                  title={stage.label}
                  playoffMode={activeCompetitionState.playoffMode}
                  stageIndex={index}
                  matches={stage.matches}
                  isActive={stage.isActive}
                  canEdit={stage.isActive}
                  scoreDrafts={scoreDrafts}
                  onDraftChange={setDraftForPlayer}
                  onScoreSubmit={handleBatchSubmit}
                  isSaving={isSaving}
                  assistantEnabled={assistantEnabled}
                />
              ))}

              {false && fifthPlaceStages.map((stage, index) => (
                <EditableStageColumn
                  key={stage.id}
                  divisionId={selectedDivision}
                  stageKey={stage.id}
                  title={stage.label}
                  playoffMode={4}
                  stageIndex={index}
                  matches={stage.matches}
                  isActive={activeCompetitionState.playoffStage === 'fifthPlace'}
                  canEdit={activeCompetitionState.playoffStage === 'fifthPlace' && (stage.id === 'fifthPlaceFinal' || !activeCompetitionState.bracket.fifthPlaceFinal)}
                  scoreDrafts={scoreDrafts}
                  onDraftChange={setDraftForPlayer}
                  onScoreSubmit={handleBatchSubmit}
                  isSaving={isSaving}
                  assistantEnabled={assistantEnabled}
                />
              ))}

              {hasFinalMatches && (
                <div className="stage-column stage-column--final">
                  <div className="stage-column__header">
                    <p className="stage-column__eyebrow">Этап</p>
                    <h4>Финал</h4>
                  </div>

                  <div className="stage-column__final-matches final-stack final-stack--assistant">
                    {activeCompetitionState.bracket.final12 && (
                      <div className="final-stack__item final-stack__item--front">
                        <div className="mode-switch mode-switch--compact assistant-final-round-switch">
                          <span className="pill">A{activeCompetitionState.playoffFinalRounds.final12}</span>
                          {Array.from({ length: activeCompetitionState.playoffFinalRounds.final12 }, (_, index) => index + 1).map((round) => (
                            <button
                              key={`final12-round-${round}`}
                              type="button"
                              className={`mode-switch__button ${activeCompetitionState.playoffFinalRounds.final12 === round ? 'mode-switch__button--active' : ''}`}
                              onClick={() => handleFinalRoundChange('final12', round)}
                              disabled={isSaving}
                            >
                              A{round}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="mode-switch__button mode-switch__button--plus"
                            onClick={() => handleFinalRoundChange('final12', activeCompetitionState.playoffFinalRounds.final12 - 1)}
                            disabled={activeCompetitionState.playoffFinalRounds.final12 <= 1 || isSaving}
                            aria-label="Previous round"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            className="mode-switch__button mode-switch__button--plus"
                            onClick={() => handleFinalRoundChange('final12', activeCompetitionState.playoffFinalRounds.final12 + 1)}
                            disabled={activeCompetitionState.playoffFinalRounds.final12 >= 6 || isSaving}
                            aria-label="Next round"
                          >
                            +
                          </button>
                        </div>
                        <EditableMatch
                          divisionId={selectedDivision}
                          draftStageKey="final12"
                          match={activeCompetitionState.bracket.final12}
                          scoreDrafts={scoreDrafts}
                          onDraftChange={setDraftForPlayer}
                          onScoreSubmit={handleBatchSubmit}
                          isSaving={isSaving}
                          assistantEnabled={assistantEnabled}
                          canEdit={activeCompetitionState.playoffStage === 'final'}
                          activeRound={activeCompetitionState.playoffFinalRounds.final12}
                        />
                      </div>
                    )}

                    {activeCompetitionState.bracket.final34 && (
                      <div className="final-stack__item final-stack__item--back">
                        <div className="mode-switch mode-switch--compact assistant-final-round-switch">
                          <span className="pill">A{activeCompetitionState.playoffFinalRounds.final34}</span>
                          {Array.from({ length: activeCompetitionState.playoffFinalRounds.final34 }, (_, index) => index + 1).map((round) => (
                            <button
                              key={`final34-round-${round}`}
                              type="button"
                              className={`mode-switch__button ${activeCompetitionState.playoffFinalRounds.final34 === round ? 'mode-switch__button--active' : ''}`}
                              onClick={() => handleFinalRoundChange('final34', round)}
                              disabled={isSaving}
                            >
                              A{round}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="mode-switch__button mode-switch__button--plus"
                            onClick={() => handleFinalRoundChange('final34', activeCompetitionState.playoffFinalRounds.final34 - 1)}
                            disabled={activeCompetitionState.playoffFinalRounds.final34 <= 1 || isSaving}
                            aria-label="Previous round 3-4"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            className="mode-switch__button mode-switch__button--plus"
                            onClick={() => handleFinalRoundChange('final34', activeCompetitionState.playoffFinalRounds.final34 + 1)}
                            disabled={activeCompetitionState.playoffFinalRounds.final34 >= 6 || isSaving}
                            aria-label="Next round 3-4"
                          >
                            +
                          </button>
                        </div>
                        <EditableMatch
                          divisionId={selectedDivision}
                          draftStageKey="final34"
                          match={activeCompetitionState.bracket.final34}
                          scoreDrafts={scoreDrafts}
                          onDraftChange={setDraftForPlayer}
                          onScoreSubmit={handleBatchSubmit}
                          isSaving={isSaving}
                          assistantEnabled={assistantEnabled}
                          canEdit={activeCompetitionState.playoffStage === 'final'}
                          activeRound={activeCompetitionState.playoffFinalRounds.final34}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">Плей-офф үчүн сетка азырынча түзүлгөн жок.</div>
          )}

          <div className="assistant-submit-bar">
            <button
              type="button"
              className="secondary-button assistant-save-drafts"
              onClick={handleSaveDrafts}
              disabled={!assistantEnabled || isSaving || !hasPendingDrafts}
            >
              Сактоо
            </button>
            <button
              type="button"
              className="primary-button assistant-batch-submit"
              onClick={() => handleBatchSubmit(scoreDrafts)}
              disabled={!assistantEnabled || isSaving || !hasPendingDrafts}
            >
              Админ панелге жөнөтүү
            </button>
            {isFifthPlaceView && fifthPlaceWinner && !fifthPlaceSavedToReport && (
              <button
                type="button"
                className="primary-button assistant-forward-button"
                onClick={handleSendFifthPlaceToReport}
                disabled={!assistantEnabled || isSaving}
              >
                Отчётко жөнөтүү
              </button>
            )}
            <button
              type="button"
              className="primary-button assistant-forward-button"
              style={{
                display:
                  (isFifthPlaceView && !(fifthPlaceWinner && !fifthPlaceSavedToReport)) ||
                  ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final'].includes(activeCompetitionState.playoffStage)
                    ? 'inline-flex'
                    : 'none',
              }}
              onClick={
                isFifthPlaceView
                  ? (fifthPlaceWinner && !fifthPlaceSavedToReport ? handleSendFifthPlaceToReport : handleFifthPlaceForward)
                  : handlePlayoffForward
              }
              disabled={
                !assistantEnabled ||
                isSaving ||
                (isFifthPlaceView
                  ? activeCompetitionState.playoffStage !== 'fifthPlace' || !hasFifthPlaceBracket
                  : !['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final'].includes(activeCompetitionState.playoffStage))
              }
            >
              Алга
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

const EditableStageColumn = ({
  divisionId,
  stageKey,
  title,
  playoffMode,
  stageIndex,
  matches,
  isActive,
  canEdit,
  scoreDrafts,
  onDraftChange,
  onScoreSubmit,
  isSaving,
  assistantEnabled,
}) => {
  const roundIndex = getRoundIndex(playoffMode, stageKey)
  const roundFactor = 2 ** Math.max(roundIndex, 0)
  const slotCount = stageKey === 'fifthPlaceSemiFinals' || stageKey === 'fifthPlaceFinal' ? matches.length : getStageMatchCount(playoffMode, stageKey)
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
    <div className={`stage-column ${isActive ? 'stage-column--active' : ''}`} style={columnStyle}>
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
            {slot.kind === 'match' ? (
              <EditableMatch
                match={slot.match}
                seedNumbers={slot.seedNumbers}
                divisionId={divisionId}
                draftStageKey={stageKey}
                canEdit={canEdit}
                scoreDrafts={scoreDrafts}
                onDraftChange={onDraftChange}
                onScoreSubmit={onScoreSubmit}
                isSaving={isSaving}
                assistantEnabled={assistantEnabled}
              />
            ) : (
              <EditablePlaceholderMatch />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const EditablePlaceholderMatch = () => (
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

const EditableMatch = ({ match, seedNumbers, divisionId, draftStageKey, canEdit, activeRound = 1, scoreDrafts, onDraftChange, onScoreSubmit, isSaving, assistantEnabled }) => {
  if (!match) {
    return null
  }

  if (!canEdit) {
    if (match.isFinal) {
      return (
        <article className={`match-card match-card--final ${match.winner ? 'match-card--winner' : ''}`}>
          <div className="final-player">
            <div className="final-player__card">
              <strong>{match.p1?.name || '—'}</strong>
              <span>Негизги: {match.s1}</span>
              <span>Кошумча: {match.s1_bot}</span>
            </div>
          </div>
          <div className="match-divider" />
          <div className="final-player">
            <div className="final-player__card">
              <strong>{match.p2?.name || '—'}</strong>
              <span>Негизги: {match.s2}</span>
              <span>Кошумча: {match.s2_bot}</span>
            </div>
          </div>
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

  if (match.isFinal) {
    return (
      <article className={`match-card match-card--final ${match.winner ? 'match-card--winner' : ''}`}>
        <EditableFinalPlayer
          match={match}
          player={match.p1}
          divisionId={divisionId}
          canEdit={canEdit}
          activeRound={activeRound}
          scoreDrafts={scoreDrafts}
          onDraftChange={onDraftChange}
          onScoreSubmit={onScoreSubmit}
          isSaving={isSaving}
          assistantEnabled={assistantEnabled}
        />
        <div className="match-divider" />
        <EditableFinalPlayer
          match={match}
          player={match.p2}
          divisionId={divisionId}
          canEdit={canEdit}
          activeRound={activeRound}
          scoreDrafts={scoreDrafts}
          onDraftChange={onDraftChange}
          onScoreSubmit={onScoreSubmit}
          isSaving={isSaving}
          assistantEnabled={assistantEnabled}
        />
      </article>
    )
  }

  return (
    <article className={`playoff-card ${match.winner ? 'playoff-card--winner' : ''}`}>
      <div className={`playoff-row ${match.winner?.id === match.p1?.id ? 'playoff-row--winner' : ''}`}>
        <div className="playoff-row__identity">
          {seedNumbers && <span className="match-player__seed">{seedNumbers[0]}</span>}
          <div>
            <span className="playoff-row__name">{match.p1?.name || '—'}</span>
            <div className="assistant-row-meta">Жазылган: {getPlayerScore(match, match.p1?.id) || '—'}</div>
          </div>
        </div>

        <div className="playoff-score-stack">
          {(() => {
            const draftKey = getStageScoreDraftKey(divisionId, draftStageKey, match.p1?.id)
            const currentScore = getPlayerScore(match, match.p1?.id) || ''
            return (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            className="playoff-score-input"
            value={scoreDrafts[draftKey] ?? currentScore}
            onChange={(event) => onDraftChange(draftKey, event.target.value)}
            disabled={!assistantEnabled || isSaving || !canEdit}
          />
            )
          })()}
        </div>
      </div>

      <div className={`playoff-row playoff-row--divided ${match.winner?.id === match.p2?.id ? 'playoff-row--winner' : ''}`}>
        <div className="playoff-row__identity">
          {seedNumbers && <span className="match-player__seed">{seedNumbers[1]}</span>}
          <div>
            <span className="playoff-row__name">{match.p2?.name || '—'}</span>
            <div className="assistant-row-meta">Жазылган: {getPlayerScore(match, match.p2?.id) || '—'}</div>
          </div>
        </div>

        <div className="playoff-score-stack">
          {(() => {
            const draftKey = getStageScoreDraftKey(divisionId, draftStageKey, match.p2?.id)
            const currentScore = getPlayerScore(match, match.p2?.id) || ''
            return (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            className="playoff-score-input"
            value={scoreDrafts[draftKey] ?? currentScore}
            onChange={(event) => onDraftChange(draftKey, event.target.value)}
            disabled={!assistantEnabled || isSaving}
          />
            )
          })()}
        </div>
      </div>
    </article>
  )
}

const EditableFinalPlayer = ({ match, player, divisionId, canEdit, activeRound = 1, scoreDrafts, onDraftChange, isSaving, assistantEnabled }) => {
  if (!player) {
    return null
  }

  const playerRounds = player.id === match.p1?.id ? Array.isArray(match.roundsP1) ? match.roundsP1 : [] : Array.isArray(match.roundsP2) ? match.roundsP2 : []
  const primaryRounds = playerRounds.slice(0, activeRound)
  const extraRounds = playerRounds.slice(6, 6 + activeRound)

  return (
    <div className={`final-player ${match.winner?.id === player.id ? 'final-player--winner' : ''}`}>
      <div className="final-rounds-group">
        <div className="final-rounds-group__label">Негизги</div>
        <div className="final-rounds">
          {primaryRounds.map((value, index) => {
            const draftKey = getFinalScoreDraftKey(divisionId, match.id, player.id, index)
            const currentValue = String(value ?? '')
            const draftValue = scoreDrafts[draftKey]
            return (
              <input
                key={draftKey}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
              maxLength={2}
              className="mini-input"
              value={draftValue ?? currentValue}
              onChange={(event) => onDraftChange(draftKey, event.target.value)}
              disabled={!assistantEnabled || isSaving || !canEdit}
            />
            )
          })}
        </div>
      </div>

      <div className="final-player__card">
        <strong>{player.name}</strong>
        <span>Негизги: {player.id === match.p1?.id ? match.s1 : match.s2}</span>
        <span>Кошумча: {player.id === match.p1?.id ? match.s1_bot : match.s2_bot}</span>
      </div>

      <div className="final-rounds-group">
        <div className="final-rounds-group__label">Кошумча</div>
        <div className="final-rounds">
          {extraRounds.map((value, index) => (
            <input
              key={`${match.id}:${player.id}:extra:${index}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="mini-input mini-input--accent"
              value={value ?? ''}
              readOnly
              tabIndex={-1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
