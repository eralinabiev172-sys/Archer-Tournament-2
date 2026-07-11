import { getSupabaseClient, getSupabaseConfigError, isSupabaseConfigured } from './supabaseClient.js'

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

const DEFAULT_PLAYOFF_FINAL_ROUNDS = {
  final12: 1,
  final34: 1,
}

const SCORE_SUBMISSION_META_KEY = '__scoreSubmission'
const PLAYOFF_DIVISION_META_KEY = '__playoffDivision'
const PLAYOFF_FINAL_ROUNDS_META_KEY = '__playoffFinalRounds'
const COMPETITION_DIVISIONS_META_KEY = '__competitionDivisions'
const PASSWORD_PROTECTION_META_KEY = '__passwordProtectionEnabled'
const STATE_VERSION_META_KEY = '__stateVersion'
const STATE_UPDATED_AT_META_KEY = '__stateUpdatedAt'
const DEFAULT_PASSWORD_PROTECTION_ENABLED = false

function createEmptyBracket() {
  return {
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

const DEFAULT_STATE = {
  tournamentName: 'Жаа атуу боюнча турнир',
  location: 'Чолпон-Ата, 2026-жыл',
  category: 'Классикалык жаа, 50 метр, эркектер',
  playoffDivision: 'all',
  headReferee: '',
  headSecretary: '',
  players: [],
  scores: {},
  competitionDivisions: createDefaultCompetitionDivisions(),
  playerNumberBook: {},
  scoreSubmission: {
    activeRound: 1,
    entries: [],
  },
  passwordProtectionEnabled: DEFAULT_PASSWORD_PROTECTION_ENABLED,
  version: 0,
  updatedAt: null,
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
const normalizePasswordProtectionEnabled = (value) => (typeof value === 'boolean' ? value : DEFAULT_PASSWORD_PROTECTION_ENABLED)

const normalizeCompetitionState = (value) => ({
  playoffMode: [32, 16, 8, 4].includes(Number(value?.playoffMode)) ? Number(value.playoffMode) : 16,
  playoffStage: ['none', 'roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final', 'fifthPlace'].includes(value?.playoffStage)
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
        bracket.fifthPlaceFinal ||
        bracket.winners?.length ||
        bracket.roundOf32?.length ||
        bracket.roundOf16?.length ||
        bracket.quarterFinals?.length ||
        bracket.semiFinals?.length ||
        bracket.fifthPlaceSemiFinals?.length),
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

const samePlayer = (left, right) => Boolean(left?.id && right?.id && left.id === right.id)
const sameMatchParticipants = (left, right) =>
  samePlayer(left?.p1, right?.p1) && samePlayer(left?.p2, right?.p2) && Boolean(left?.isFinal) === Boolean(right?.isFinal)

const mergeMatchState = (existingMatch, nextMatch) => {
  if (!existingMatch || !sameMatchParticipants(existingMatch, nextMatch)) {
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
    submittedRoundsP1: Array.isArray(existingMatch.submittedRoundsP1) ? [...existingMatch.submittedRoundsP1] : [...nextMatch.submittedRoundsP1],
    submittedRoundsP2: Array.isArray(existingMatch.submittedRoundsP2) ? [...existingMatch.submittedRoundsP2] : [...nextMatch.submittedRoundsP2],
    submittedP1: Boolean(existingMatch.submittedP1),
    submittedP2: Boolean(existingMatch.submittedP2),
    submittedShootOffP1: Boolean(existingMatch.submittedShootOffP1),
    submittedShootOffP2: Boolean(existingMatch.submittedShootOffP2),
  }
}

const syncFifthPlaceBracket = (bracket) => {
  const nextBracket = { ...createEmptyBracket(), ...(bracket || {}) }
  const removeFifthPlaceFromReport = () => {
    nextBracket.fifthPlaceSentToReport = false
    nextBracket.winners = (nextBracket.winners || []).filter((entry) => entry.position !== 5)
  }

  const quarterFinalLosers = (nextBracket.quarterFinals || [])
    .map((match) => {
      const winner = resolvePlayoffWinner(match)
      if (!winner) return null
      return winner.id === match.p1?.id ? match.p2 : match.p1
    })
    .filter(Boolean)

  if (quarterFinalLosers.length !== 4) {
    nextBracket.fifthPlaceSemiFinals = []
    nextBracket.fifthPlaceFinal = null
    removeFifthPlaceFromReport()
    return nextBracket
  }

  const existingSemiFinals = Array.isArray(nextBracket.fifthPlaceSemiFinals) ? nextBracket.fifthPlaceSemiFinals : []
  const rebuiltSemiFinals = [
    mergeMatchState(existingSemiFinals[0], createMatch('fifthPlaceSemiFinals-0', quarterFinalLosers[0], quarterFinalLosers[1])),
    mergeMatchState(existingSemiFinals[1], createMatch('fifthPlaceSemiFinals-1', quarterFinalLosers[2], quarterFinalLosers[3])),
  ].map((match) => ({
    ...match,
    winner: resolvePlayoffWinner(match),
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
      winner: resolvePlayoffWinner(rebuiltFinal),
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

const syncCompetitionDivisionsFifthPlace = (competitionDivisions, legacy = {}) =>
  Object.fromEntries(
    Object.entries(normalizeCompetitionDivisions(competitionDivisions, legacy)).map(([divisionId, divisionState]) => [
      divisionId,
      {
        ...divisionState,
        bracket: syncFifthPlaceBracket(divisionState.bracket),
      },
    ]),
  )

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
  delete nextBook[STATE_VERSION_META_KEY]
  delete nextBook[STATE_UPDATED_AT_META_KEY]
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

const readStoredStateVersion = (dbRow) => {
  const value = Number(dbRow.player_number_book?.[STATE_VERSION_META_KEY])
  return Number.isInteger(value) && value >= 0 ? value : 0
}

const readStoredStateUpdatedAt = (dbRow) => {
  const value = dbRow.player_number_book?.[STATE_UPDATED_AT_META_KEY]
  return typeof value === 'string' || value === null ? value : null
}

const writeStoredPlayerNumberBook = (
  playerNumberBook,
  scoreSubmission,
  playoffDivision,
  playoffFinalRounds,
  competitionDivisions,
  passwordProtectionEnabled,
  version,
  updatedAt,
) => ({
  ...(playerNumberBook || {}),
  [SCORE_SUBMISSION_META_KEY]: normalizeScoreSubmission(scoreSubmission),
  [PLAYOFF_DIVISION_META_KEY]: normalizePlayoffDivision(playoffDivision),
  [PLAYOFF_FINAL_ROUNDS_META_KEY]: normalizePlayoffFinalRounds(playoffFinalRounds),
  [COMPETITION_DIVISIONS_META_KEY]: normalizeCompetitionDivisions(competitionDivisions),
  [PASSWORD_PROTECTION_META_KEY]: normalizePasswordProtectionEnabled(passwordProtectionEnabled),
  [STATE_VERSION_META_KEY]: Number.isInteger(version) && version >= 0 ? version : 0,
  [STATE_UPDATED_AT_META_KEY]: typeof updatedAt === 'string' || updatedAt === null ? updatedAt : null,
})

const dbToJs = (dbRow) => {
  const playoffDivision = readStoredPlayoffDivision(dbRow)
  const competitionDivisions = readStoredCompetitionDivisions(dbRow)
  const legacyDivisionId = playoffDivision === 'female' ? 'female' : playoffDivision === 'male' ? 'male' : 'all'
  const legacyDivisionState = competitionDivisions[legacyDivisionId] || createEmptyCompetitionState()

  return {
    tournamentName: dbRow.tournament_name,
    location: dbRow.location,
    category: dbRow.category,
    playoffDivision,
    playoffFinalRounds: legacyDivisionState.playoffFinalRounds,
    headReferee: dbRow.head_referee,
    headSecretary: dbRow.head_secretary,
    players: dbRow.players || [],
    scores: dbRow.scores || {},
    bracket: legacyDivisionState.bracket,
    playoffStage: legacyDivisionState.playoffStage,
    playoffMode: legacyDivisionState.playoffMode,
    competitionDivisions,
    passwordProtectionEnabled: readStoredPasswordProtectionEnabled(dbRow),
    version: readStoredStateVersion(dbRow),
    updatedAt: readStoredStateUpdatedAt(dbRow),
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
    tournament_name: jsState.tournamentName,
    location: jsState.location,
    category: jsState.category,
    head_referee: jsState.headReferee,
    head_secretary: jsState.headSecretary,
    players: jsState.players,
    scores: jsState.scores,
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
      jsState.version,
      jsState.updatedAt,
    ),
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true })
  }

  if (!isSupabaseConfigured()) {
    return res.status(500).json(getSupabaseConfigError())
  }

  const supabase = getSupabaseClient()

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('tournament_state')
        .select('*')
        .eq('id', 'main')
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          const { data: newData, error: insertError } = await supabase
            .from('tournament_state')
            .insert([{ id: 'main', ...jsToDb(DEFAULT_STATE) }])
            .select()
            .single()

          if (insertError) {
            console.error('Insert error:', insertError)
            return res.status(500).json({ error: insertError.message })
          }

          return res.status(200).json(dbToJs(newData))
        }

        console.error('Select error:', error)
        return res.status(500).json({ error: error.message })
      }

      return res.status(200).json(dbToJs(data))
    }

    if (req.method === 'PUT') {
      const { data: currentData, error: currentError } = await supabase
        .from('tournament_state')
        .select('*')
        .eq('id', 'main')
        .single()

      if (currentError) {
        console.error('Conflict check fetch error:', currentError)
        return res.status(500).json({ error: currentError.message })
      }

      const currentState = dbToJs(currentData)
      if (Number.isInteger(req.body?.version) && req.body.version !== currentState.version) {
        return res.status(409).json({
          error: 'Tournament state was updated in another session. Reload the latest data and try again.',
          currentState,
          currentVersion: currentState.version,
        })
      }

      const syncedCompetitionDivisions = syncCompetitionDivisionsFifthPlace(req.body?.competitionDivisions, req.body)
      const nextState = {
        ...DEFAULT_STATE,
        ...req.body,
        playoffDivision: normalizePlayoffDivision(req.body?.playoffDivision),
        scoreSubmission: normalizeScoreSubmission(req.body?.scoreSubmission),
        competitionDivisions: syncedCompetitionDivisions,
        passwordProtectionEnabled: normalizePasswordProtectionEnabled(req.body?.passwordProtectionEnabled),
        version: currentState.version + 1,
        updatedAt: new Date().toISOString(),
      }

      const { data, error } = await supabase
        .from('tournament_state')
        .update(jsToDb(nextState))
        .eq('id', 'main')
        .select()
        .single()

      if (error) {
        console.error('Update error:', error)
        return res.status(500).json({ error: error.message })
      }

      return res.status(200).json(dbToJs(data))
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('Error handling state:', error)
    return res.status(500).json({ error: error.message || 'Internal server error' })
  }
}
