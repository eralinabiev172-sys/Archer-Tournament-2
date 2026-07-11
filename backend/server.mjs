import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
const dataFile = join(dataDir, 'tournament-state.json')
const PORT = Number(process.env.PORT || 8787)
const MAX_PLAYER_SCORE = 30

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

const createEmptyCompetitionState = () => ({
  playoffMode: 16,
  playoffStage: 'none',
  playoffFinalRounds: { final12: 1, final34: 1 },
  bracket: { ...EMPTY_BRACKET },
})

const DEFAULT_STATE = {
  tournamentName: 'Жаа атуу боюнча турнир',
  location: 'Чолпон-Ата, 2026-жыл',
  category: 'Классикалык жаа, 50 метр, эркектер',
  playoffDivision: 'all',
  headReferee: '',
  headSecretary: '',
  players: [],
  scores: {},
  competitionDivisions: {
    all: createEmptyCompetitionState(),
    male: createEmptyCompetitionState(),
    female: createEmptyCompetitionState(),
  },
  playerNumberBook: {},
  scoreSubmission: {
    activeRound: 1,
    entries: [],
  },
  passwordProtectionEnabled: false,
  assistantScoringEnabled: false,
  version: 0,
  updatedAt: null,
}

const normalizePlayerName = (name) => name.trim().toLocaleLowerCase()
const sanitizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10)
const sanitizePassword = (value) => String(value || '').replace(/\D/g, '').slice(0, 4)
const sanitizePlayerName = (value) => String(value || '').replace(/[^\p{L}\s'-]/gu, '').replace(/\s{2,}/g, ' ').trim()
const LETTER_SEQUENCE = ['A', 'B', 'C', 'D']
const getLaneLetter = (entryNumber) => LETTER_SEQUENCE[(Math.max(Number(entryNumber) || 1, 1) - 1) % LETTER_SEQUENCE.length]
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

let writeQueue = Promise.resolve()

const ensureStorage = async () => {
  await mkdir(dataDir, { recursive: true })
  try {
    await readFile(dataFile, 'utf8')
  } catch {
    await writeFile(dataFile, JSON.stringify(DEFAULT_STATE, null, 2), 'utf8')
  }
}

const readState = async () => {
  await ensureStorage()
  try {
    const raw = await readFile(dataFile, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_STATE,
      ...parsed,
      playoffDivision: normalizePlayoffDivision(parsed.playoffDivision),
      competitionDivisions: normalizeCompetitionDivisions(parsed.competitionDivisions, parsed),
      players: Array.isArray(parsed.players) ? parsed.players : [],
      scores: parsed.scores || {},
      playerNumberBook: parsed.playerNumberBook || {},
      scoreSubmission: normalizeScoreSubmission(parsed.scoreSubmission),
      passwordProtectionEnabled: normalizePasswordProtectionEnabled(parsed.passwordProtectionEnabled),
      assistantScoringEnabled: normalizeAssistantScoringEnabled(parsed.assistantScoringEnabled),
      version: Number.isInteger(parsed.version) && parsed.version >= 0 ? parsed.version : 0,
      updatedAt: typeof parsed.updatedAt === 'string' || parsed.updatedAt === null ? parsed.updatedAt : null,
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

const writeState = async (state, previousState = null) => {
  await ensureStorage()
  const baseState = previousState || DEFAULT_STATE
  const nextState = {
    ...state,
    version: (Number.isInteger(baseState.version) ? baseState.version : 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  writeQueue = writeQueue.then(() => writeFile(dataFile, JSON.stringify(nextState, null, 2), 'utf8'))
  await writeQueue
  return nextState
}

const createHttpError = (statusCode, message, extra = {}) => {
  const error = new Error(message)
  error.statusCode = statusCode
  Object.assign(error, extra)
  return error
}

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  response.end(JSON.stringify(payload))
}

const readBody = async (request) =>
  new Promise((resolve, reject) => {
    let data = ''
    request.on('data', (chunk) => {
      data += chunk
    })
    request.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })

const isValidPlayerName = (value) => /^[\p{L}\s'-]+$/u.test(value)
const isValidPhone = (value) => !value || /^\d{1,10}$/.test(value)
const isValidPassword = (value) => /^\d{4}$/.test(value)
const normalizePasswordProtectionEnabled = (value) => (typeof value === 'boolean' ? value : false)
const normalizeAssistantScoringEnabled = (value) => (typeof value === 'boolean' ? value : false)
const isValidScoreValue = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_PLAYER_SCORE
const isScoreInputDigitsOnly = (value) => /^\d{1,3}$/.test(String(value || '').trim())
const PLAYOFF_SUBMISSION_STAGES = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final', 'fifthPlace']
const normalizeScoreSubmission = (value) => ({
  activeRound: [1, 2, 3, 4, 5, 6].includes(Number(value?.activeRound)) ? Number(value.activeRound) : 1,
  entries: Array.isArray(value?.entries) ? value.entries : [],
})
const normalizePlayoffDivision = (value) => (['all', 'male', 'female'].includes(value) ? value : 'all')
const normalizePlayoffFinalRounds = (value) => ({
  final12: [1, 2, 3, 4, 5, 6].includes(Number(value?.final12)) ? Number(value.final12) : 1,
  final34: [1, 2, 3, 4, 5, 6].includes(Number(value?.final34)) ? Number(value.final34) : 1,
})
const normalizeCompetitionState = (value) => ({
  playoffMode: [32, 16, 8, 4].includes(Number(value?.playoffMode)) ? Number(value.playoffMode) : 16,
  playoffStage: PLAYOFF_SUBMISSION_STAGES.includes(value?.playoffStage) || value?.playoffStage === 'none' || value?.playoffStage === 'final'
    ? value?.playoffStage || 'none'
    : 'none',
  playoffFinalRounds: normalizePlayoffFinalRounds(value?.playoffFinalRounds),
  bracket: value?.bracket ? { ...EMPTY_BRACKET, ...value.bracket } : { ...EMPTY_BRACKET },
})
const normalizeCompetitionDivisions = (value, legacy = {}) => {
  const defaults = {
    all: createEmptyCompetitionState(),
    male: createEmptyCompetitionState(),
    female: createEmptyCompetitionState(),
  }

  if (value && typeof value === 'object') {
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
  const hasLegacyBracket = Boolean(
    legacy.bracket &&
      (legacy.bracket.final12 ||
        legacy.bracket.final34 ||
        legacy.bracket.winners?.length ||
        legacy.bracket.roundOf32?.length ||
        legacy.bracket.roundOf16?.length ||
        legacy.bracket.quarterFinals?.length ||
        legacy.bracket.semiFinals?.length),
  )

  if (hasLegacyBracket || legacy.playoffStage !== 'none') {
    defaults[legacyDivision] = normalizeCompetitionState({
      playoffMode: legacy.playoffMode,
      playoffStage: legacy.playoffStage,
      playoffFinalRounds: legacy.playoffFinalRounds,
      bracket: legacy.bracket,
    })
  }

  return defaults
}

const findActivePlayoffMatch = (bracket, playoffStage, playerId, explicitStageKey = null) => {
  const stageKey = explicitStageKey || playoffStage

  if (stageKey === 'final') {
    const finals = [bracket.final12, bracket.final34].filter(Boolean)
    return finals.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
  }

  if (stageKey === 'fifthPlaceFinal') {
    return bracket.fifthPlaceFinal?.p1?.id === playerId || bracket.fifthPlaceFinal?.p2?.id === playerId
      ? bracket.fifthPlaceFinal
      : null
  }

  if (stageKey === 'fifthPlaceSemiFinals') {
    const fifthPlaceMatches = bracket.fifthPlaceSemiFinals || []
    return fifthPlaceMatches.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
  }

  if (stageKey === 'fifthPlace') {
    const fifthPlaceMatches = bracket.fifthPlaceFinal ? [bracket.fifthPlaceFinal] : (bracket.fifthPlaceSemiFinals || [])
    return fifthPlaceMatches.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
  }

  if (!PLAYOFF_SUBMISSION_STAGES.includes(stageKey)) {
    return null
  }

  const stageMatches = Array.isArray(bracket?.[stageKey]) ? bracket[stageKey] : []
  return stageMatches.find((match) => match?.p1?.id === playerId || match?.p2?.id === playerId) || null
}

const resolveCompetitionDivisionIdForPlayer = (state, playerId, preferredDivisionId = null, explicitStageKey = null) => {
  const divisionIds = [
    preferredDivisionId,
    state?.playoffDivision,
    'all',
    'male',
    'female',
  ].filter((value, index, list) => ['all', 'male', 'female'].includes(value) && list.indexOf(value) === index)

  for (const divisionId of divisionIds) {
    const divisionState = normalizeCompetitionState(state?.competitionDivisions?.[divisionId])
    if (findActivePlayoffMatch(divisionState.bracket, divisionState.playoffStage, playerId, explicitStageKey)) {
      return divisionId
    }
  }

  return preferredDivisionId && ['all', 'male', 'female'].includes(preferredDivisionId) ? preferredDivisionId : 'all'
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
const shouldUseShootOffForStandardMatch = (match) =>
  Boolean(
    match &&
      !match.isFinal &&
      Number(match.s1) === Number(match.s2) &&
      ((match.submittedP1 && match.submittedP2) || Number(match.s1) !== 0 || Number(match.s2) !== 0),
  )

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
  const nextBracket = { ...EMPTY_BRACKET, ...bracket }
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

  if (quarterFinalLosers.length === 4) {
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
  } else {
    nextBracket.fifthPlaceSemiFinals = []
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

const syncCompetitionDivisionsFifthPlace = (competitionDivisions, legacyState = {}) => {
  const normalizedDivisions = normalizeCompetitionDivisions(competitionDivisions, legacyState)

  return Object.fromEntries(
    Object.entries(normalizedDivisions).map(([divisionId, divisionState]) => [
      divisionId,
      {
        ...divisionState,
        bracket: syncFifthPlaceBracket(divisionState.bracket),
      },
    ]),
  )
}

const registerPlayer = async (payload) => {
  const currentState = await readState()
  const name = sanitizePlayerName(payload.name)
  const phone = sanitizePhone(payload.phone)
  const password = sanitizePassword(payload.password)
  const gender = payload.gender === 'female' ? 'female' : 'male'

  if (!name || !isValidPlayerName(name)) {
    throw new Error('Аты-жөнү туура эмес.')
  }

  if (phone && !isValidPhone(phone)) {
    throw new Error('Телефон номери туура эмес.')
  }

  if (payload.password !== undefined && payload.password !== null && String(payload.password).trim() !== '' && !isValidPassword(password)) {
    throw new Error('Password must be exactly 4 digits.')
  }

  const normalizedName = normalizePlayerName(name)
  const existsByName = currentState.players.some((player) => normalizePlayerName(player.name || '') === normalizedName)
  const existsByPhone = phone && currentState.players.some((player) => sanitizePhone(player.phone) === phone)
  const hasPassword = isValidPassword(password)

  if (existsByName) {
    throw new Error('Мындай аттагы катышуучу мурун катталган.')
  }

  if (existsByPhone) {
    throw new Error('Мындай телефон номери менен катышуучу мурун катталган.')
  }

  const highestNumber = Math.max(0, ...Object.values(currentState.playerNumberBook || {}).map((value) => Number(value) || 0))
  const entryNumber = highestNumber + 1

  const nextState = {
    ...currentState,
    players: [
      ...currentState.players,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        phone,
        password: hasPassword ? password : '',
        gender,
        entryNumber,
        laneLetter: getLaneLetter(entryNumber),
      },
    ],
    playerNumberBook: {
      ...(currentState.playerNumberBook || {}),
      [normalizedName]: entryNumber,
    },
  }

  return writeState(nextState, currentState)
}

const submitPlayerScore = async (payload) => {
  const currentState = await readState()
  const playerId = String(payload.playerId || '').trim()
  const password = sanitizePassword(payload.password)
  const rawScore = String(payload.score || '').trim()
  const score = Number.parseInt(rawScore, 10)
  const passwordProtectionEnabled = false
  const assistantScoringEnabled = normalizeAssistantScoringEnabled(currentState.assistantScoringEnabled)
  const scoreSubmission = normalizeScoreSubmission(currentState.scoreSubmission)
  const activeRound = scoreSubmission.activeRound

  if (!playerId) {
    throw new Error('Оюнчу тандалган жок.')
  }

  if (passwordProtectionEnabled && (!password || !isValidPassword(password))) {
    throw new Error('Телефон номери туура эмес.')
  }

  if (!isScoreInputDigitsOnly(rawScore) || !isValidScoreValue(score)) {
    throw new Error(`Упай 0дон ${MAX_PLAYER_SCORE}га чейинки сан болушу керек.`)
  }

  const player = currentState.players.find((item) => item.id === playerId)
  if (!player) {
    throw new Error('Оюнчу табылган жок.')
  }

  if (passwordProtectionEnabled && sanitizePassword(player.password) !== password) {
    throw new Error('Телефон номери дал келген жок.')
  }

  if (assistantScoringEnabled && payload.source !== 'assistant') {
    throw new Error('Assistant scoring is enabled. Use the assistant page to submit scores.')
  }

  const existingRoundScore = currentState.scores?.[player.id]?.[activeRound]
  if (existingRoundScore !== undefined && existingRoundScore !== null && existingRoundScore !== '') {
    throw new Error('Бул айлампа үчүн упай мурунтан эле сакталган. Аны эми калыс гана өзгөртө алат.')
  }

  const nextEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playerId: player.id,
    playerName: player.name,
    round: activeRound,
    score,
    submittedAt: new Date().toISOString(),
  }

  const nextState = {
    ...currentState,
    scores: {
      ...currentState.scores,
      [player.id]: {
        ...(currentState.scores[player.id] || {}),
        [activeRound]: score,
      },
    },
    scoreSubmission: {
      ...scoreSubmission,
      entries: [nextEntry, ...scoreSubmission.entries].slice(0, 500),
    },
  }

  return writeState(nextState, currentState)
}

const submitPlayoffPlayerScore = async (payload) => {
  const currentState = await readState()
  const playerId = String(payload.playerId || '').trim()
  const password = sanitizePassword(payload.password)
  const rawScore = String(payload.score || '').trim()
  const score = Number.parseInt(rawScore, 10)
  const passwordProtectionEnabled = false
  const assistantScoringEnabled = normalizeAssistantScoringEnabled(currentState.assistantScoringEnabled)

  if (!playerId) {
    throw new Error('Оюнчу тандалган жок.')
  }

  if (passwordProtectionEnabled && (!password || !isValidPassword(password))) {
    throw new Error('Password must be exactly 4 digits.')
  }

  if (!isScoreInputDigitsOnly(rawScore) || !isValidScoreValue(score)) {
    throw new Error(`Упай 0дон ${MAX_PLAYER_SCORE}га чейинки сан болушу керек.`)
  }

  const player = currentState.players.find((item) => item.id === playerId)
  if (!player) {
    throw new Error('Оюнчу табылган жок.')
  }

  if (passwordProtectionEnabled && sanitizePassword(player.password) !== password) {
    throw new Error('Incorrect 4-digit password.')
  }

  if (assistantScoringEnabled && payload.source !== 'assistant') {
    throw new Error('Assistant scoring is enabled. Use the assistant page to submit scores.')
  }

  const preferredDivisionId = ['all', 'male', 'female'].includes(payload.divisionId) ? payload.divisionId : null
  const explicitStageKey = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final', 'fifthPlace', 'fifthPlaceSemiFinals', 'fifthPlaceFinal'].includes(payload.stageKey)
    ? payload.stageKey
    : null
  const divisionId = resolveCompetitionDivisionIdForPlayer(currentState, playerId, preferredDivisionId, explicitStageKey)
  const divisionState = normalizeCompetitionState(currentState.competitionDivisions?.[divisionId])
  const activeMatch = findActivePlayoffMatch(divisionState.bracket, divisionState.playoffStage, playerId, explicitStageKey)
  if (!activeMatch) {
    throw new Error('Сиз үчүн ачык плей-офф беттеш табылган жок.')
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
  }
  const allowAssistantOverwrite = payload.source === 'assistant'

  if (divisionState.playoffStage === 'final') {
    const finalStageKey = activeMatch.id === 'final34' ? 'final34' : 'final12'
    const activeRound = divisionState.playoffFinalRounds?.[finalStageKey] || 1
    const submittedRoundsKey = isPlayerOne ? 'submittedRoundsP1' : 'submittedRoundsP2'
    const roundsKey = isPlayerOne ? 'roundsP1' : 'roundsP2'

    if (updatedMatch[submittedRoundsKey][activeRound - 1] && !allowAssistantOverwrite) {
      throw new Error('Бул финал айлампасы үчүн упай мурунтан эле жөнөтүлгөн.')
    }

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
    if (allowAssistantOverwrite) {
      updatedMatch[isPlayerOne ? 's1' : 's2'] = score
      updatedMatch[isPlayerOne ? 'submittedP1' : 'submittedP2'] = true
      updatedMatch.shootOffS1 = 0
      updatedMatch.shootOffS2 = 0
      updatedMatch.submittedShootOffP1 = false
      updatedMatch.submittedShootOffP2 = false
    } else {
    const useShootOff = shouldUseShootOffForStandardMatch(updatedMatch)
    const submissionKey = useShootOff
      ? isPlayerOne ? 'submittedShootOffP1' : 'submittedShootOffP2'
      : isPlayerOne ? 'submittedP1' : 'submittedP2'
    if (updatedMatch[submissionKey]) {
      throw new Error('Бул плей-офф беттеш үчүн упай мурунтан эле жөнөтүлгөн.')
    }

    if (useShootOff) {
      updatedMatch[isPlayerOne ? 'shootOffS1' : 'shootOffS2'] = score
    } else {
      updatedMatch[isPlayerOne ? 's1' : 's2'] = score
    }
    updatedMatch[submissionKey] = true
    }
  }

  updatedMatch.winner = resolvePlayoffWinner(updatedMatch)

  const nextBracket = { ...divisionState.bracket }
  if (divisionState.playoffStage === 'final') {
    if (nextBracket.final12?.id === updatedMatch.id) {
      nextBracket.final12 = updatedMatch
    } else if (nextBracket.final34?.id === updatedMatch.id) {
      nextBracket.final34 = updatedMatch
    }
  } else if (divisionState.playoffStage === 'fifthPlace') {
    if (nextBracket.fifthPlaceFinal?.id === updatedMatch.id) {
      updatedMatch.isFinal = false
      nextBracket.fifthPlaceFinal = updatedMatch
    } else {
      nextBracket.fifthPlaceSemiFinals = (nextBracket.fifthPlaceSemiFinals || []).map((match) =>
        match.id === updatedMatch.id ? updatedMatch : match,
      )
    }
    Object.assign(nextBracket, syncFifthPlaceBracket(nextBracket))
  } else {
    nextBracket[divisionState.playoffStage] = (nextBracket[divisionState.playoffStage] || []).map((match) =>
      match.id === updatedMatch.id ? updatedMatch : match,
    )
    Object.assign(nextBracket, syncFifthPlaceBracket(nextBracket))
  }

  const nextState = {
    ...currentState,
    competitionDivisions: {
      ...normalizeCompetitionDivisions(currentState.competitionDivisions, currentState),
      [divisionId]: {
        ...divisionState,
        bracket: nextBracket,
      },
    },
  }

  return writeState(nextState, currentState)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 200, { ok: true })
    return
  }

  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, await readState())
      return
    }

    if (request.method === 'PUT' && url.pathname === '/api/state') {
      const body = await readBody(request)
      const currentState = await readState()
      if (Number.isInteger(body.version) && body.version !== currentState.version) {
        throw createHttpError(409, 'Tournament state was updated in another session. Reload the latest data and try again.', {
          currentState,
          currentVersion: currentState.version,
        })
      }
      const syncedCompetitionDivisions = syncCompetitionDivisionsFifthPlace(body.competitionDivisions, body)
      const nextState = {
        ...DEFAULT_STATE,
        ...body,
        playoffDivision: normalizePlayoffDivision(body.playoffDivision),
        competitionDivisions: syncedCompetitionDivisions,
        players: Array.isArray(body.players) ? body.players : [],
        scores: body.scores || {},
        playerNumberBook: body.playerNumberBook || {},
        scoreSubmission: normalizeScoreSubmission(body.scoreSubmission),
        passwordProtectionEnabled: normalizePasswordProtectionEnabled(body.passwordProtectionEnabled),
        assistantScoringEnabled: normalizeAssistantScoringEnabled(body.assistantScoringEnabled),
        version: currentState.version,
        updatedAt: currentState.updatedAt,
      }
      const savedState = await writeState(nextState, currentState)
      sendJson(response, 200, savedState)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/register-player') {
      const body = await readBody(request)
      sendJson(response, 200, await registerPlayer(body))
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/player-score') {
      const body = await readBody(request)
      sendJson(response, 200, await submitPlayerScore(body))
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/playoff-player-score') {
      const body = await readBody(request)
      sendJson(response, 200, await submitPlayoffPlayerScore(body))
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(response, Number.isInteger(error?.statusCode) ? error.statusCode : 400, {
      error: error.message || 'Unknown error',
      ...(error?.currentState ? { currentState: error.currentState } : {}),
      ...(Number.isInteger(error?.currentVersion) ? { currentVersion: error.currentVersion } : {}),
    })
  }
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the existing process or set a different PORT.`)
    process.exit(1)
  }

  throw error
})

server.listen(PORT, () => {
  console.log(`Tournament backend running on http://localhost:${PORT}`)
})
