#!/usr/bin/env node
/**
 * Vendor TanStack's official agent skills into the workspace.
 *
 * TanStack ships SKILL.md files inside the npm packages (for example
 * `@tanstack/react-start/skills/react-start/SKILL.md`). They are the authoritative, version-matched
 * instructions for the libraries this app actually has installed, so we copy them into
 * `.agents/skills/<package>/...` where an agent can find them without knowing the package layout.
 *
 * The copy is generated: run `npm run skills:sync` after `npm install` to refresh it. Nothing here
 * is hand-edited; MANIFEST.json records which package version each file came from.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, '.agents', 'skills')

async function tanstackPackages() {
  const scope = path.join(root, 'node_modules', '@tanstack')
  const entries = await readdir(scope, { withFileTypes: true })
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(scope, entry.name)
    const skills = path.join(dir, 'skills')
    try {
      if (!(await stat(skills)).isDirectory()) continue
    } catch {
      continue
    }
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    found.push({ name: pkg.name, version: pkg.version, skills })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

async function main() {
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  const manifest = { generatedBy: 'scripts/sync-tanstack-skills.mjs', packages: [], skills: [] }

  for (const pkg of await tanstackPackages()) {
    const dest = path.join(target, pkg.name.replace('@tanstack/', ''))
    await cp(pkg.skills, dest, { recursive: true })
    const files = []
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else files.push(path.relative(target, full))
      }
    }
    await walk(dest)
    manifest.packages.push({ name: pkg.name, version: pkg.version, files: files.length })
    manifest.skills.push(...files.filter((f) => f.endsWith('SKILL.md')))
    console.log(`${pkg.name}@${pkg.version}: ${files.length} files`)
  }

  await writeFile(path.join(target, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`\n${manifest.skills.length} SKILL.md files written to ${path.relative(root, target)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
