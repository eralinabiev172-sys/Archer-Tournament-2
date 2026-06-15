import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
const MAX_PLAYER_SCORE = 30

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

const SCORE_SUBMISSION_META_KEY = '__scoreSubmission'
const PLAYOFF_DIVISION_META_KEY = '__playoffDivision'
const PLAYOFF_FINAL_ROUNDS_META_KEY = '__playoffFinalRounds'
const COMPETITION_DIVISIONS_META_KEY = '__competitionDivisions'
const PASSWORD_PROTECTION_META_KEY = '__passwordProtectionEnabled'
const PLAYOFF_SUBMISSION_STAGES = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final']
const PLAYOFF_STAGE_KEYS_BY_MODE = {
  32: ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals'],
  16: ['roundOf16', 'quarterFinals', 'semiFinals'],
  8: ['quarterFinals', 'semiFinals'],
  4: ['semiFinals'],
}

function createEmptyBracket() {
  return {
    roundOf32: [],
    roundOf16: [],
    quarterFinals: [],
    semiFinals: [],
    final12: null,
    final34: null,
    winners: [],
  }
}

function createEmptyCompetitionState() {
  return {
    playoffMode: 16,
    playoffStage: 'none',
    playoffFinalRounds: { ...DEFAULT_PLAYOFF_FINAL_ROUNDS },
    bracket: createEmptyBracket(),
  }
}

function createDefaultCompetitionDivisions() {
  return {
    all: createEmptyCompetitionState(),
    male: createEmptyCompetitionState(),
    female: createEmptyCompetitionState(),
  }
}

const normalizeScoreSubmission = (value) => ({
  activeRound: [1, 2, 3, 4, 5, 6].includes(Number(value?.activeRound)) ? Number(value.activeRound) : 1,
  entries: Array.isArray(value?.entries) ? value.entries : [],
})

const normalizePlayoffFinalRounds = (value) => ({
  final12: [1, 2, 3, 4, 5, 6].includes(Number(value?.final12)) ? Number(value.final12) : 1,
  final34: [1, 2, 3, 4, 5, 6].includes(Number(value?.final34)) ? Number(value.final34) : 1,
})

const normalizePlayoffDivision = (value) => (['all', 'male', 'female'].includes(value) ? value : 'all')

const normalizeCompetitionState = (value) => ({
  playoffMode: [32, 16, 8, 4].includes(Number(value?.playoffMode)) ? Number(value.playoffMode) : 16,
  playoffStage: ['none', 'roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final'].includes(value?.playoffStage)
    ? value.playoffStage
    : 'none',
  playoffFinalRounds: normalizePlayoffFinalRounds(value?.playoffFinalRounds),
  bracket: value?.bracket ? { ...EMPTY_BRACKET, ...value.bracket } : createEmptyBracket(),
})

const hasBracketData = (bracket) =>
  Boolean(
    bracket &&
      (bracket.final12 ||
        bracket.final34 ||
        bracket.winners?.length ||
        bracket.roundOf32?.length ||
        bracket.roundOf16?.length ||
        bracket.quarterFinals?.length ||
        bracket.semiFinals?.length),
  )

const normalizeCompetitionDivisions = (value, legacy = {}) => {
  const defaults = createDefaultCompetitionDivisions()

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      all: normalizeCompetitionState(value.all),
      male: normalizeCompetitionState(value.male),
      female: normalizeCompetitionState(value.female),
    }
  }

  const legacyDivision =
    legacy.playoffDivision === 'female'
      ? 'female'
      : legacy.playoffDivision === 'male'
        ? 'male'
        : 'all'
  if (hasBracketData(legacy.bracket) || legacy.playoffStage !== 'none') {
    defaults[legacyDivision] = normalizeCompetitionState({
      playoffMode: legacy.playoffMode,
      playoffStage: legacy.playoffStage,
      playoffFinalRounds: legacy.playoffFinalRounds,
      bracket: legacy.bracket,
    })
  }

  return defaults
}

const extractPlayerNumberBook = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const nextBook = { ...value }
  delete nextBook[SCORE_SUBMISSION_META_KEY]
  delete nextBook[PLAYOFF_DIVISION_META_KEY]
  delete nextBook[PLAYOFF_FINAL_ROUNDS_META_KEY]
  delete nextBook[COMPETITION_DIVISIONS_META_KEY]
  delete nextBook[PASSWORD_PROTECTION_META_KEY]
  return nextBook
}

const readStoredScoreSubmission = (dbRow) =>
  normalizeScoreSubmission(dbRow.score_submission || dbRow.player_number_book?.[SCORE_SUBMISSION_META_KEY])

const readStoredPlayoffDivision = (dbRow) => normalizePlayoffDivision(dbRow.player_number_book?.[PLAYOFF_DIVISION_META_KEY])

const readStoredPlayoffFinalRounds = (dbRow) =>
  normalizePlayoffFinalRounds(dbRow.player_number_book?.[PLAYOFF_FINAL_ROUNDS_META_KEY])

const readStoredCompetitionDivisions = (dbRow) =>
  normalizeCompetitionDivisions(dbRow.player_number_book?.[COMPETITION_DIVISIONS_META_KEY], {
    playoffDivision: readStoredPlayoffDivision(dbRow),
    bracket: dbRow.bracket,
    playoffStage: dbRow.playoff_stage,
    playoffMode: dbRow.playoff_mode,
    playoffFinalRounds: readStoredPlayoffFinalRounds(dbRow),
  })

const readStoredPasswordProtectionEnabled = (dbRow) =>
  normalizePasswordProtectionEnabled(dbRow.player_number_book?.[PASSWORD_PROTECTION_META_KEY])

const writeStoredPlayerNumberBook = (
  playerNumberBook,
  scoreSubmission,
  playoffDivision,
  playoffFinalRounds,
  competitionDivisions,
  passwordProtectionEnabled,
) => ({
  ...(playerNumberBook || {}),
  [SCORE_SUBMISSION_META_KEY]: normalizeScoreSubmission(scoreSubmission),
  [PLAYOFF_DIVISION_META_KEY]: normalizePlayoffDivision(playoffDivision),
  [PLAYOFF_FINAL_ROUNDS_META_KEY]: normalizePlayoffFinalRounds(playoffFinalRounds),
  [COMPETITION_DIVISIONS_META_KEY]: normalizeCompetitionDivisions(competitionDivisions),
  [PASSWORD_PROTECTION_META_KEY]: normalizePasswordProtectionEnabled(passwordProtectionEnabled),
})

const dbToJs = (dbRow) => {
  const playoffDivision = readStoredPlayoffDivision(dbRow)
  const competitionDivisions = readStoredCompetitionDivisions(dbRow)
  const legacyDivisionId = playoffDivision === 'female' ? 'female' : playoffDivision === 'male' ? 'male' : 'all'
  const legacyDivisionState = competitionDivisions[legacyDivisionId] || createEmptyCompetitionState()

  return {
    playoffDivision,
    playoffFinalRounds: legacyDivisionState.playoffFinalRounds,
    players: dbRow.players || [],
    scores: dbRow.scores || {},
    bracket: legacyDivisionState.bracket,
    playoffStage: legacyDivisionState.playoffStage,
    playoffMode: legacyDivisionState.playoffMode,
    competitionDivisions,
    passwordProtectionEnabled: readStoredPasswordProtectionEnabled(dbRow),
    playerNumberBook: extractPlayerNumberBook(dbRow.player_number_book),
    scoreSubmission: readStoredScoreSubmission(dbRow),
  }
}

const jsToDb = (jsState) => {
  const playoffDivision = normalizePlayoffDivision(jsState.playoffDivision)
  const competitionDivisions = normalizeCompetitionDivisions(jsState.competitionDivisions, jsState)
  const legacyDivisionId = playoffDivision === 'female' ? 'female' : playoffDivision === 'male' ? 'male' : 'all'
  const legacyDivisionState = competitionDivisions[legacyDivisionId] || createEmptyCompetitionState()

  return {
    bracket: legacyDivisionState.bracket,
    playoff_stage: legacyDivisionState.playoffStage,
    playoff_mode: legacyDivisionState.playoffMode,
    player_number_book: writeStoredPlayerNumberBook(
      jsState.playerNumberBook,
      jsState.scoreSubmission,
      playoffDivision,
      legacyDivisionState.playoffFinalRounds,
      competitionDivisions,
      jsState.passwordProtectionEnabled,
    ),
  }
}

const sanitizePassword = (value) => String(value || '').replace(/\D/g, '').slice(0, 4)
const isValidPassword = (value) => /^\d{4}$/.test(value)
const DEFAULT_PASSWORD_PROTECTION_ENABLED = false
const normalizePasswordProtectionEnabled = (value) => (typeof value === 'boolean' ? value : DEFAULT_PASSWORD_PROTECTION_ENABLED)
const isValidScoreValue = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_PLAYER_SCORE
const isScoreInputDigitsOnly = (value) => /^\d{1,3}$/.test(String(value || '').trim())

const findActivePlayoffMatch = (bracket, playoffStage, playerId) => {
  if (playoffStage === 'final') {
    const finals = [bracket.final12, bracket.final34].filter(Boolean)
    return finals.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
  }

  if (!PLAYOFF_SUBMISSION_STAGES.includes(playoffStage)) {
    return null
  }

  const stageMatches = Array.isArray(bracket?.[playoffStage]) ? bracket[playoffStage] : []
  return stageMatches.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
}

const resolvePlayoffWinner = (match) => {
  if (!match) return null
  if (Number(match.s1) > Number(match.s2)) return match.p1
  if (Number(match.s2) > Number(match.s1)) return match.p2
  if (!match.isFinal) {
    if (Number(match.shootOffS1) > Number(match.shootOffS2)) return match.p1
    if (Number(match.shootOffS2) > Number(match.shootOffS1)) return match.p2
    return null
  }
  if (Number(match.s1_bot) > Number(match.s2_bot)) return match.p1
  if (Number(match.s2_bot) > Number(match.s1_bot)) return match.p2
  return null
}

const shouldUseShootOffForStandardMatch = (match) =>
  Boolean(
    match &&
      !match.isFinal &&
      Number(match.s1) === Number(match.s2) &&
      ((match.submittedP1 && match.submittedP2) || Number(match.s1) !== 0 || Number(match.s2) !== 0),
  )

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
  autoRecalculated: false,
})

const getVisibleStageKeys = (playoffMode) => PLAYOFF_STAGE_KEYS_BY_MODE[playoffMode] || PLAYOFF_STAGE_KEYS_BY_MODE[8]

const samePlayer = (left, right) => Boolean(left?.id && right?.id && left.id === right.id)

const sameMatchParticipants = (left, right) => samePlayer(left?.p1, right?.p1) && samePlayer(left?.p2, right?.p2)

const mergeMatchState = (existingMatch, nextMatch, autoRecalculated = false) => {
  if (!existingMatch || !sameMatchParticipants(existingMatch, nextMatch) || Boolean(existingMatch.isFinal) !== Boolean(nextMatch.isFinal)) {
    return {
      ...nextMatch,
      autoRecalculated,
    }
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
    submittedRoundsP1: Array.isArray(existingMatch.submittedRoundsP1) ? [...existingMatch.submittedRoundsP1] : [...nextMatch.submittedRoundsP1],
    submittedRoundsP2: Array.isArray(existingMatch.submittedRoundsP2) ? [...existingMatch.submittedRoundsP2] : [...nextMatch.submittedRoundsP2],
    submittedShootOffP1: Boolean(existingMatch.submittedShootOffP1),
    submittedShootOffP2: Boolean(existingMatch.submittedShootOffP2),
    autoRecalculated,
  }
}

const resolveWinningPlayer = (match) => resolvePlayoffWinner(match)

const rebuildBracketAfterStageEdit = (divisionState, changedStageKey) => {
  const nextBracket = {
    ...createEmptyBracket(),
    ...(divisionState.bracket || {}),
  }

  const recalculateWinners = (markAsAutoRecalculated = false) => {
    const final12 = nextBracket.final12 ? { ...nextBracket.final12 } : null
    const final34 = nextBracket.final34 ? { ...nextBracket.final34 } : null

    if (final12) {
      final12.winner = resolveWinningPlayer(final12)
    }
    if (final34) {
      final34.winner = resolveWinningPlayer(final34)
    }

    nextBracket.final12 = final12
    nextBracket.final34 = final34

    if (final12?.winner && final34?.winner) {
      const silver = final12.winner.id === final12.p1.id ? final12.p2 : final12.p1
      const fourth = final34.winner.id === final34.p1.id ? final34.p2 : final34.p1
      nextBracket.winners = [
        { position: 1, player: final12.winner, autoRecalculated: markAsAutoRecalculated },
        { position: 2, player: silver, autoRecalculated: markAsAutoRecalculated },
        { position: 3, player: final34.winner, autoRecalculated: markAsAutoRecalculated },
        { position: 4, player: fourth, autoRecalculated: markAsAutoRecalculated },
      ]
    } else {
      nextBracket.winners = []
    }
  }

  if (changedStageKey === 'final') {
    recalculateWinners(false)
    return nextBracket
  }

  const stageOrder = getVisibleStageKeys(divisionState.playoffMode)
  const currentStageIndex = stageOrder.indexOf(changedStageKey)
  if (currentStageIndex < 0) {
    return nextBracket
  }

  let currentMatches = Array.isArray(nextBracket[changedStageKey]) ? nextBracket[changedStageKey] : []
  let shouldClearDownstream = false

  for (let stageIndex = currentStageIndex + 1; stageIndex < stageOrder.length; stageIndex += 1) {
    const nextStageKey = stageOrder[stageIndex]

    if (shouldClearDownstream) {
      nextBracket[nextStageKey] = []
      currentMatches = []
      continue
    }

    const winners = currentMatches.map((match) => resolveWinningPlayer(match))
    const isIncomplete = winners.length === 0 || winners.length % 2 !== 0 || winners.some((player) => !player)

    if (isIncomplete) {
      nextBracket[nextStageKey] = []
      currentMatches = []
      shouldClearDownstream = true
      continue
    }

    const existingMatches = Array.isArray(nextBracket[nextStageKey]) ? nextBracket[nextStageKey] : []
    const rebuiltMatches = []

    for (let matchIndex = 0; matchIndex < winners.length; matchIndex += 2) {
      const nextMatch = createMatch(`${nextStageKey}-${matchIndex}`, winners[matchIndex], winners[matchIndex + 1])
      const mergedMatch = mergeMatchState(existingMatches[matchIndex / 2], nextMatch, true)
      mergedMatch.winner = resolveWinningPlayer(mergedMatch)
      rebuiltMatches.push(mergedMatch)
    }

    nextBracket[nextStageKey] = rebuiltMatches
    currentMatches = rebuiltMatches
  }

  const semiFinals = Array.isArray(nextBracket.semiFinals) ? nextBracket.semiFinals : []
  const semiWinners = semiFinals.map((match) => resolveWinningPlayer(match))
  const semiLosers = semiFinals.map((match) => {
    const winner = resolveWinningPlayer(match)
    if (!winner) return null
    return winner.id === match.p1?.id ? match.p2 : match.p1
  })

  if (semiWinners.length !== 2 || semiLosers.length !== 2 || semiWinners.some((player) => !player) || semiLosers.some((player) => !player)) {
    nextBracket.final12 = null
    nextBracket.final34 = null
    nextBracket.winners = []
    return nextBracket
  }

  const final12Match = mergeMatchState(nextBracket.final12, createMatch('final12', semiWinners[0], semiWinners[1], true), true)
  const final34Match = mergeMatchState(nextBracket.final34, createMatch('final34', semiLosers[0], semiLosers[1], true), true)

  final12Match.winner = resolveWinningPlayer(final12Match)
  final34Match.winner = resolveWinningPlayer(final34Match)

  nextBracket.final12 = final12Match
  nextBracket.final34 = final34Match

  recalculateWinners(true)
  return nextBracket
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    const playerId = String(req.body?.playerId || '').trim()
    const password = sanitizePassword(req.body?.password)
    const rawScore = String(req.body?.score || '').trim()
    const score = Number.parseInt(rawScore, 10)
    const requestedRoundIndex = Number.isInteger(req.body?.roundIndex) ? Number(req.body.roundIndex) : null

    if (!playerId) {
      return res.status(400).json({ error: 'Player is required.' })
    }

    if (!isScoreInputDigitsOnly(rawScore) || !isValidScoreValue(score)) {
      return res.status(400).json({ error: `Score must be between 0 and ${MAX_PLAYER_SCORE}.` })
    }

    const { data: currentData, error: fetchError } = await supabase
      .from('tournament_state')
      .select('*')
      .eq('id', 'main')
      .single()

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message })
    }

    const currentState = dbToJs(currentData)
    const passwordProtectionEnabled = false
    const player = currentState.players.find((item) => item.id === playerId)

    if (!player) {
      return res.status(400).json({ error: 'Player not found.' })
    }

    if (passwordProtectionEnabled && (!password || !isValidPassword(password))) {
      return res.status(400).json({ error: 'Password must be exactly 4 digits.' })
    }

    if (passwordProtectionEnabled && sanitizePassword(player.password) !== password) {
      return res.status(400).json({ error: 'Incorrect 4-digit password.' })
    }

    const divisionId = player.gender === 'female' ? 'female' : 'male'
    const divisionState = normalizeCompetitionState(currentState.competitionDivisions?.[divisionId])
    const activeMatch = findActivePlayoffMatch(divisionState.bracket, divisionState.playoffStage, playerId)

    if (!activeMatch) {
      return res.status(400).json({ error: 'No active playoff match found for this player.' })
    }

    const isPlayerOne = activeMatch?.p1?.id === playerId
    const updatedMatch = {
      ...activeMatch,
      roundsP1: Array.isArray(activeMatch.roundsP1) ? [...activeMatch.roundsP1] : Array(12).fill(0),
      roundsP2: Array.isArray(activeMatch.roundsP2) ? [...activeMatch.roundsP2] : Array(12).fill(0),
      submittedRoundsP1: Array.isArray(activeMatch.submittedRoundsP1) ? [...activeMatch.submittedRoundsP1] : Array(6).fill(false),
      submittedRoundsP2: Array.isArray(activeMatch.submittedRoundsP2) ? [...activeMatch.submittedRoundsP2] : Array(6).fill(false),
      shootOffS1: Number(activeMatch.shootOffS1 || 0),
      shootOffS2: Number(activeMatch.shootOffS2 || 0),
      submittedShootOffP1: Boolean(activeMatch.submittedShootOffP1),
      submittedShootOffP2: Boolean(activeMatch.submittedShootOffP2),
      autoRecalculated: false,
    }

    if (divisionState.playoffStage === 'final') {
      const finalStageKey = activeMatch.id === 'final34' ? 'final34' : 'final12'
      const activeRound =
        requestedRoundIndex !== null
          ? requestedRoundIndex + 1
          : divisionState.playoffFinalRounds?.[finalStageKey] || 1

      if (activeRound < 1 || activeRound > 6) {
        return res.status(400).json({ error: 'Final round index is out of range.' })
      }

      const submittedRoundsKey = isPlayerOne ? 'submittedRoundsP1' : 'submittedRoundsP2'
      const roundsKey = isPlayerOne ? 'roundsP1' : 'roundsP2'

      updatedMatch[roundsKey][activeRound - 1] = score
      updatedMatch[submittedRoundsKey][activeRound - 1] = true
      updatedMatch.s1 = updatedMatch.roundsP1.slice(0, 6).reduce((sum, item) => sum + Number(item || 0), 0)
      updatedMatch.s2 = updatedMatch.roundsP2.slice(0, 6).reduce((sum, item) => sum + Number(item || 0), 0)

      for (let index = 0; index < 6; index += 1) {
        const left = Number(updatedMatch.roundsP1[index] || 0)
        const right = Number(updatedMatch.roundsP2[index] || 0)
        const bonusIndex = index + 6

        if (!updatedMatch.submittedRoundsP1[index] && !updatedMatch.submittedRoundsP2[index]) {
          updatedMatch.roundsP1[bonusIndex] = 0
          updatedMatch.roundsP2[bonusIndex] = 0
        } else if (left > right) {
          updatedMatch.roundsP1[bonusIndex] = 2
          updatedMatch.roundsP2[bonusIndex] = 0
        } else if (right > left) {
          updatedMatch.roundsP1[bonusIndex] = 0
          updatedMatch.roundsP2[bonusIndex] = 2
        } else {
          updatedMatch.roundsP1[bonusIndex] = 1
          updatedMatch.roundsP2[bonusIndex] = 1
        }
      }

      updatedMatch.s1_bot = updatedMatch.roundsP1.slice(6).reduce((sum, item) => sum + Number(item || 0), 0)
      updatedMatch.s2_bot = updatedMatch.roundsP2.slice(6).reduce((sum, item) => sum + Number(item || 0), 0)
    } else {
      const useShootOff = shouldUseShootOffForStandardMatch(updatedMatch)
      const submissionKey = useShootOff
        ? isPlayerOne ? 'submittedShootOffP1' : 'submittedShootOffP2'
        : isPlayerOne ? 'submittedP1' : 'submittedP2'

      if (useShootOff) {
        updatedMatch[isPlayerOne ? 'shootOffS1' : 'shootOffS2'] = score
      } else {
        updatedMatch[isPlayerOne ? 's1' : 's2'] = score
      }

      updatedMatch[submissionKey] = true
    }

    updatedMatch.winner = resolvePlayoffWinner(updatedMatch)

    const updatedDivisionState = {
      ...divisionState,
      bracket: { ...divisionState.bracket },
    }

    if (divisionState.playoffStage === 'final') {
      if (updatedDivisionState.bracket.final12?.id === updatedMatch.id) {
        updatedDivisionState.bracket.final12 = updatedMatch
      } else if (updatedDivisionState.bracket.final34?.id === updatedMatch.id) {
        updatedDivisionState.bracket.final34 = updatedMatch
      }
      updatedDivisionState.bracket = rebuildBracketAfterStageEdit(updatedDivisionState, 'final')
    } else {
      updatedDivisionState.bracket[divisionState.playoffStage] = (updatedDivisionState.bracket[divisionState.playoffStage] || []).map((match) =>
        match.id === updatedMatch.id ? updatedMatch : match,
      )
      updatedDivisionState.bracket = rebuildBracketAfterStageEdit(updatedDivisionState, divisionState.playoffStage)
    }

    const nextState = {
      ...currentState,
      competitionDivisions: {
        ...currentState.competitionDivisions,
        [divisionId]: updatedDivisionState,
      },
    }

    const { data: updatedData, error: updateError } = await supabase
      .from('tournament_state')
      .update(jsToDb(nextState))
      .eq('id', 'main')
      .select('*')
      .single()

    if (updateError) {
      return res.status(500).json({ error: updateError.message })
    }

    return res.status(200).json(dbToJs(updatedData))
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' })
  }
}
