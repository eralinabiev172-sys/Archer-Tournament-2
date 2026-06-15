import { spawn } from 'node:child_process'

const children = []
let shuttingDown = false
const mode = process.argv[2] || 'default'

const clientArgsByMode = {
  admin: ['run', 'dev:client', '--', '--host', '0.0.0.0', '--open', '/admin/'],
  assistant: ['run', 'dev:client', '--', '--host', '0.0.0.0', '--open', '/assistant/'],
  user: ['run', 'dev:client', '--', '--host', '0.0.0.0', '--open', '/'],
  default: ['run', 'dev:client', '--', '--host', '0.0.0.0'],
}

const run = (label, command, args) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
  })

  child.on('exit', (code) => {
    if (shuttingDown) {
      return
    }

    shuttingDown = true
    for (const current of children) {
      if (current.pid && current.pid !== child.pid) {
        current.kill()
      }
    }

    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    console.error(`${label} failed:`, error)
  })

  children.push(child)
  return child
}

const cleanup = () => {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  for (const child of children) {
    if (child.pid) {
      child.kill()
    }
  }
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

run('backend', 'npm.cmd', ['run', 'dev:server'])
run('client', 'npm.cmd', clientArgsByMode[mode] || clientArgsByMode.default)
