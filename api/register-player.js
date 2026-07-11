import { getSupabaseClient, getSupabaseConfigError, isSupabaseConfigured } from './supabaseClient.js'

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
const STATE_VERSION_META_KEY = '__stateVersion'
const STATE_UPDATED_AT_META_KEY = '__stateUpdatedAt'
const DEFAULT_PASSWORD_PROTECTION_ENABLED = false

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

const normalizePlayerName = (name) => name.trim().toLocaleLowerCase()
const sanitizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10)
const sanitizePassword = (value) => String(value || '').replace(/\D/g, '').slice(0, 4)
const sanitizePlayerName = (value) => String(value || '').replace(/[^\p{L}\s'-]/gu, '').replace(/\s{2,}/g, ' ').trim()
const isValidPlayerName = (value) => /^[\p{L}\s'-]+$/u.test(value)
const isValidPhone = (value) => !value || /^\d{1,10}$/.test(value)
const isValidPassword = (value) => /^\d{4}$/.test(value)
const normalizePasswordProtectionEnabled = (value) => (typeof value === 'boolean' ? value : DEFAULT_PASSWORD_PROTECTION_ENABLED)
const LETTER_SEQUENCE = ['A', 'B', 'C', 'D']
const getLaneLetter = (entryNumber) => LETTER_SEQUENCE[(Math.max(Number(entryNumber) || 1, 1) - 1) % LETTER_SEQUENCE.length]

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
    players: jsState.players,
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
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isSupabaseConfigured()) {
    return res.status(500).json(getSupabaseConfigError())
  }

  const supabase = getSupabaseClient()

  try {
    const { name: rawName, phone: rawPhone, password: rawPassword, gender } = req.body
    const name = sanitizePlayerName(rawName)
    const phone = sanitizePhone(rawPhone)
    const password = sanitizePassword(rawPassword)
    const playerGender = gender === 'female' ? 'female' : 'male'

    if (!name || !isValidPlayerName(name)) {
      return res.status(400).json({ error: 'Name is invalid.' })
    }

    if (phone && !isValidPhone(phone)) {
      return res.status(400).json({ error: 'Phone is invalid.' })
    }

    if (rawPassword !== undefined && rawPassword !== null && String(rawPassword).trim() !== '' && !isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be exactly 4 digits.' })
    }

    const { data: currentData, error: fetchError } = await supabase
      .from('tournament_state')
      .select('*')
      .eq('id', 'main')
      .single()

    if (fetchError) {
      console.error('Fetch error:', fetchError)
      return res.status(500).json({ error: fetchError.message })
    }

    const currentState = dbToJs(currentData)
    const normalizedName = normalizePlayerName(name)
    const existsByName = currentState.players.some((player) => normalizePlayerName(player.name || '') === normalizedName)
    const existsByPhone = phone && currentState.players.some((player) => sanitizePhone(player.phone) === phone)
    const hasPassword = isValidPassword(password)

    if (existsByName || existsByPhone) {
      return res.status(200).json(currentState)
    }

    const highestNumber = Math.max(0, ...Object.values(currentState.playerNumberBook || {}).map((value) => Number(value) || 0))
    const entryNumber = highestNumber + 1
    const newPlayer = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      phone,
      password: hasPassword ? password : '',
      gender: playerGender,
      entryNumber,
      laneLetter: getLaneLetter(entryNumber),
    }

    const nextState = {
      ...currentState,
      version: currentState.version + 1,
      updatedAt: new Date().toISOString(),
      players: [...currentState.players, newPlayer],
      playerNumberBook: {
        ...(currentState.playerNumberBook || {}),
        [normalizedName]: entryNumber,
      },
    }

    const { data: updatedData, error: updateError } = await supabase
      .from('tournament_state')
      .update(jsToDb(nextState))
      .eq('id', 'main')
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      return res.status(500).json({ error: updateError.message })
    }

    return res.status(200).json(dbToJs(updatedData))
  } catch (error) {
    console.error('Error registering player:', error)
    return res.status(500).json({ error: error.message || 'Internal server error' })
  }
}
