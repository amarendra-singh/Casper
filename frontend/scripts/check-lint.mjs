import { ESLint } from 'eslint'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const baseline = JSON.parse(await readFile(new URL('../eslint-baseline.json', import.meta.url), 'utf8'))
const eslint = new ESLint()
const results = await eslint.lintFiles(['src'])
let warningCount = 0
let failed = false
for (const result of results) {
  const file = path.relative(process.cwd(), result.filePath).split(path.sep).join('/')
  const counts = {}
  for (const message of result.messages) {
    if (message.severity === 2) {
      failed = true
      console.error(`${file}:${message.line} ${message.ruleId}: ${message.message}`)
    } else {
      warningCount++
      counts[message.ruleId] = (counts[message.ruleId] || 0) + 1
    }
  }
  for (const [rule, count] of Object.entries(counts)) {
    const allowed = baseline.counts[file]?.[rule] || 0
    if (count > allowed) {
      failed = true
      console.error(`${file}: ${rule} increased from ${allowed} to ${count}; fix the new warnings.`)
    }
  }
}
if (failed) process.exitCode = 1
else console.log(`Lint passed: 0 errors, ${warningCount} tracked warnings, no increases. Use npm run lint:report for details.`)
