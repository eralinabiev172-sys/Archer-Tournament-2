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
}

const normalizePlayerName = (name) => name.trim().toLocaleLowerCase()
const sanitizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10)
const sanitizePassword = (value) => String(value || '').replace(/\D/g, '').slice(0, 4)
const sanitizePlayerName = (value) => String(value || '').replace(/[^\p{L}\s'-]/gu, '').replace(/\s{2,}/g, ' ').trim()
const LETTER_SEQUENCE = ['A', 'B', 'C', 'D']
const getLaneLetter = (entryNumber) => LETTER_SEQUENCE[(Math.max(Number(entryNumber) || 1, 1) - 1) % LETTER_SEQUENCE.length]

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
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

const writeState = async (state) => {
  await ensureStorage()
  writeQueue = writeQueue.then(() => writeFile(dataFile, JSON.stringify(state, null, 2), 'utf8'))
  await writeQueue
  return state
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
const PLAYOFF_SUBMISSION_STAGES = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'final']
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

  await writeState(nextState)
  return nextState
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

  await writeState(nextState)
  return nextState
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
    throw new Error('РћСЋРЅС‡Сѓ С‚Р°РЅРґР°Р»РіР°РЅ Р¶РѕРє.')
  }

  if (passwordProtectionEnabled && (!password || !isValidPassword(password))) {
    throw new Error('Password must be exactly 4 digits.')
  }

  if (!isScoreInputDigitsOnly(rawScore) || !isValidScoreValue(score)) {
    throw new Error(`РЈРїР°Р№ 0РґРѕРЅ ${MAX_PLAYER_SCORE}РіР° С‡РµР№РёРЅРєРё СЃР°РЅ Р±РѕР»СѓС€Сѓ РєРµСЂРµРє.`)
  }

  const player = currentState.players.find((item) => item.id === playerId)
  if (!player) {
    throw new Error('РћСЋРЅС‡Сѓ С‚Р°Р±С‹Р»РіР°РЅ Р¶РѕРє.')
  }

  if (passwordProtectionEnabled && sanitizePassword(player.password) !== password) {
    throw new Error('Incorrect 4-digit password.')
  }

  if (assistantScoringEnabled && payload.source !== 'assistant') {
    throw new Error('Assistant scoring is enabled. Use the assistant page to submit scores.')
  }

  const divisionId = player.gender === 'female' ? 'female' : 'male'
  const divisionState = normalizeCompetitionState(currentState.competitionDivisions?.[divisionId])
  const activeMatch = findActivePlayoffMatch(divisionState.bracket, divisionState.playoffStage, playerId)
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

  if (divisionState.playoffStage === 'final') {
    const finalStageKey = activeMatch.id === 'final34' ? 'final34' : 'final12'
    const activeRound = divisionState.playoffFinalRounds?.[finalStageKey] || 1
    const submittedRoundsKey = isPlayerOne ? 'submittedRoundsP1' : 'submittedRoundsP2'
    const roundsKey = isPlayerOne ? 'roundsP1' : 'roundsP2'

    if (updatedMatch[submittedRoundsKey][activeRound - 1]) {
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

  updatedMatch.winner = resolvePlayoffWinner(updatedMatch)

  const nextBracket = { ...divisionState.bracket }
  if (divisionState.playoffStage === 'final') {
    if (nextBracket.final12?.id === updatedMatch.id) {
      nextBracket.final12 = updatedMatch
    } else if (nextBracket.final34?.id === updatedMatch.id) {
      nextBracket.final34 = updatedMatch
    }
  } else {
    nextBracket[divisionState.playoffStage] = (nextBracket[divisionState.playoffStage] || []).map((match) =>
      match.id === updatedMatch.id ? updatedMatch : match,
    )
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

  await writeState(nextState)
  return nextState
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
      const nextState = {
        ...DEFAULT_STATE,
        ...body,
        playoffDivision: normalizePlayoffDivision(body.playoffDivision),
        competitionDivisions: normalizeCompetitionDivisions(body.competitionDivisions, body),
        players: Array.isArray(body.players) ? body.players : [],
        scores: body.scores || {},
        playerNumberBook: body.playerNumberBook || {},
        scoreSubmission: normalizeScoreSubmission(body.scoreSubmission),
        passwordProtectionEnabled: normalizePasswordProtectionEnabled(body.passwordProtectionEnabled),
        assistantScoringEnabled: normalizeAssistantScoringEnabled(body.assistantScoringEnabled),
      }
      await writeState(nextState)
      sendJson(response, 200, nextState)
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
    sendJson(response, 400, { error: error.message || 'Unknown error' })
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
