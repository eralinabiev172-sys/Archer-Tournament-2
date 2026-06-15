import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

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

const DEFAULT_STATE = {
  tournamentName: 'Р–Р°Р° Р°С‚СѓСѓ Р±РѕСЋРЅС‡Р° С‚СѓСЂРЅРёСЂ',
  location: 'Р§РѕР»РїРѕРЅ-РђС‚Р°, 2026-Р¶С‹Р»',
  category: 'РљР»Р°СЃСЃРёРєР°Р»С‹Рє Р¶Р°Р°, 50 РјРµС‚СЂ, СЌСЂРєРµРєС‚РµСЂ',
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

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

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
      const nextState = {
        ...DEFAULT_STATE,
        ...req.body,
        playoffDivision: normalizePlayoffDivision(req.body?.playoffDivision),
        scoreSubmission: normalizeScoreSubmission(req.body?.scoreSubmission),
        competitionDivisions: normalizeCompetitionDivisions(req.body?.competitionDivisions, req.body),
        passwordProtectionEnabled: normalizePasswordProtectionEnabled(req.body?.passwordProtectionEnabled),
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
