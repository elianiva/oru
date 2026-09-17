/**
 * The seam, against a host that is actually running.
 *
 * The host process is started the way the browser suite starts it, and the
 * assertions run the app's own commands through the layer `entry.ts` builds,
 * so every answer is what the started host recorded — never a fixture.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Option, Predicate, Schema } from 'effect'
import { Url } from 'foldkit'
import * as Scene from 'foldkit/scene'
import { describe, expect, it } from 'vitest'
import { ProjectClient, ThreadClient, clientsFor } from '@oru/rpc'
import * as ProjectPicker from '../src/project-picker.ts'
import * as Projects from '../src/projects.ts'
import {
  ListProjects,
  LoadThreadOptions,
  CreateProject,
  UpdateProject,
  Message,
  init,
  update,
  view,
} from '../src/root.ts'

const hostMain = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'host', 'src', 'main.ts')

const homeUrl: Url.Url = {
  protocol: 'http:',
  host: 'localhost',
  port: Option.none(),
  pathname: '/',
  search: Option.none(),
  hash: Option.none(),
}

const sessionFile = (): string => join(mkdtempSync(join(tmpdir(), 'oru-seam-')), 'session.db')

type StartedHost = Readonly<{ url: string; output: string; stop: () => void }>

/** A real host process, with a journal and a home of its own, on a port the kernel picks. */
const startHost = async (): Promise<StartedHost> => {
  const home = mkdtempSync(join(tmpdir(), 'oru-seam-home-'))
  const child = spawn(process.execPath, [hostMain, '--port', '0', '--journal', sessionFile()], {
    env: { ...process.env, ORU_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stderr.on('data', (chunk: Buffer) => {
    output += String(chunk)
  })
  let url = ''
  for await (const chunk of child.stdout) {
    output += String(chunk)
    const listening = /listening on (\S+)/u.exec(output)
    if (listening?.[1] !== undefined) {
      url = listening[1]
      break
    }
  }
  return { url, output, stop: () => child.kill('SIGTERM') }
}

/** A port nothing listens on, so a call to it fails the way a stopped host does. */
const closedPort = async (): Promise<string> => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || Predicate.isString(address)) expect.fail('the probe server has no port')
  const { port } = address
  server.close()
  await once(server, 'close')
  return `http://127.0.0.1:${String(port)}`
}

const runEffect = <A, E>(
  hostUrl: string,
  effect: Effect.Effect<A, E, ProjectClient | ThreadClient>,
): Promise<A> => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(clientsFor(hostUrl)))))

const listProjects = (hostUrl: string) => runEffect(hostUrl, ListProjects().effect)

const withHost = async (use: (hostUrl: string) => Promise<void>): Promise<void> => {
  const host = await startHost()
  try {
    if (host.url === '') expect.fail(`the host never listened:\n${host.output}`)
    await use(host.url)
  } finally {
    host.stop()
  }
}

describe('the app’s seam to a running host', () => {
  it('asks the host for its projects as it loads', () => {
    expect(init(homeUrl).commands?.map((command) => command.name)).toEqual(['ListProjects'])
  })

  it('renders the host’s answer: no projects renders nothing', async () => {
    await withHost(async (hostUrl) => {
      const message = await listProjects(hostUrl)

      expect(message).toEqual(
        Message.GotProjects({
          message: Projects.Message.ProjectsArrived({ projects: [] }),
        }),
      )

      const model = update(init(homeUrl).model, message).model
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.expect(Scene.selector('[data-projects]')).toExist(),
        Scene.expect(Scene.selector('[data-projects-list]')).not.toExist(),
        Scene.expect(Scene.text('No projects yet')).not.toExist(),
      )
    })
  })

  it('renders the projects a started host recorded', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oru-seam-project-'))

    await withHost(async (hostUrl) => {
      const created = await runEffect(
        hostUrl,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          return yield* projects.create('oru', cwd)
        }),
      )
      const message = await listProjects(hostUrl)

      expect(message).toEqual(
        Message.GotProjects({
          message: Projects.Message.ProjectsArrived({ projects: [created] }),
        }),
      )

      const model = update(init(homeUrl).model, message).model
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.expect(Scene.selector(`[data-project="${created.id}"]`)).toContainText('oru'),
        Scene.expect(Scene.selector(`[data-project="${created.id}"]`)).toContainText(cwd),
      )
    })
  })

  it('reloads the model a thread was created with', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oru-seam-project-'))

    await withHost(async (hostUrl) => {
      const created = await runEffect(
        hostUrl,
        Effect.gen(function* () {
          const projects = yield* ProjectClient
          const threads = yield* ThreadClient
          const project = yield* projects.create('oru', cwd)
          return yield* threads.create(project.id, { harness: 'oru', model: 'claude-sonnet-4' })
        }),
      )

      const command = LoadThreadOptions({ threadId: created.threadId, refresh: false })
      const message = await runEffect(hostUrl, command.effect)
      const model = update(init(homeUrl).model, message).model

      expect(model.picker.selection).toEqual({
        harness: 'oru',
        model: 'claude-sonnet-4',
        reasoning: undefined,
      })
    })
  })

  it('renders a host that does not answer as a named state, and retries back into the app', async () => {
    const dead = await closedPort()

    await withHost(async (live) => {
      const message = await listProjects(dead)
      expect(Predicate.isTagged(message, 'GotProjects')).toBe(true)

      const unreachable = update(init(homeUrl).model, message).model
      expect(Predicate.isTagged(unreachable.projects.host, 'Unreachable')).toBe(true)
      Scene.scene(
        { update, view },
        Scene.given(unreachable),
        Scene.expect(Scene.selector('[data-host-unreachable]')).toExist(),
        Scene.expect(Scene.text('Host unreachable')).toExist(),
        Scene.expect(Scene.selector('[data-host-retry]')).toExist(),
        Scene.expect(Scene.selector('[data-main]')).not.toExist(),
      )

      const retried = update(
        unreachable,
        Message.GotProjects({ message: Projects.Message.ClickedRetry() }),
      )
      expect(Predicate.isTagged(retried.model.projects.host, 'Loading')).toBe(true)
      expect(retried.commands?.map((command) => command.name)).toEqual(['ListProjects'])

      const command = retried.commands?.[0]
      if (command === undefined) expect.fail('the retry dispatched no command')
      const recovered = update(retried.model, await runEffect(live, command.effect)).model

      Scene.scene(
        { update, view },
        Scene.given(recovered),
        Scene.expect(Scene.selector('[data-host-unreachable]')).not.toExist(),
        Scene.expect(Scene.selector('[data-main]')).toExist(),
        Scene.expect(Scene.selector('[data-projects-list]')).not.toExist(),
      )
    })
  })

  it('creates a project through the app’s own command and renders the host’s row', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oru-seam-create-'))

    await withHost(async (hostUrl) => {
      const listed = await runEffect(hostUrl, ListProjects().effect)
      const loaded = update(init(homeUrl).model, listed).model
      const message = await runEffect(hostUrl, CreateProject({ name: 'oru', cwd }).effect)
      if (!Predicate.isTagged(message, 'GotProjects')) expect.fail('the create produced no answer')
      const created = message.message
      if (!Schema.is(Projects.Message.ProjectCreated)(created)) {
        expect.fail(`the host refused a create it should have accepted: ${created._tag}`)
      }

      const model = update(loaded, message).model
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.expect(Scene.selector(`[data-project="${created.project.id}"]`)).toContainText('oru'),
        Scene.expect(Scene.selector(`[data-project="${created.project.id}"]`)).toContainText(cwd),
        Scene.expect(Scene.selector('[data-project-picker-trigger]')).toContainText('oru'),
      )
    })
  })

  it('renames a project through the app’s own command and renders the host’s new name', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oru-seam-rename-'))

    await withHost(async (hostUrl) => {
      const listed = await runEffect(hostUrl, ListProjects().effect)
      const created = await runEffect(hostUrl, CreateProject({ name: 'before', cwd }).effect)
      if (!Predicate.isTagged(created, 'GotProjects')) expect.fail('the create produced no answer')
      if (!Schema.is(Projects.Message.ProjectCreated)(created.message)) {
        expect.fail('the host refused a create it should have accepted')
      }
      const project = created.message.project

      const updated = await runEffect(
        hostUrl,
        UpdateProject({ project: project.id, name: 'after', cwd }).effect,
      )
      expect(updated).toEqual(
        Message.GotProjects({
          message: Projects.Message.ProjectUpdated({
            project: { id: project.id, name: 'after', cwd },
          }),
        }),
      )

      const model = update(update(init(homeUrl).model, listed).model, updated).model
      Scene.scene(
        { update, view },
        Scene.given(model),
        Scene.expect(Scene.selector(`[data-project="${project.id}"]`)).toContainText('after'),
        Scene.expect(Scene.selector('[data-project-picker-trigger]')).toContainText('after'),
      )
    })
  })

  it('carries the host’s own refusal for a relative cwd, for both write paths', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oru-seam-refused-'))

    await withHost(async (hostUrl) => {
      const refusedCreate = await runEffect(
        hostUrl,
        CreateProject({ name: 'oru', cwd: 'relative/place' }).effect,
      )
      expect(refusedCreate).toEqual(
        Message.GotProjectPicker({
          message: ProjectPicker.Message.CreateRefused({
            refusal: Projects.RelativeCwd.make({ cwd: 'relative/place' }),
          }),
        }),
      )

      const created = await runEffect(hostUrl, CreateProject({ name: 'oru', cwd }).effect)
      if (!Predicate.isTagged(created, 'GotProjects')) expect.fail('the create produced no answer')
      if (!Schema.is(Projects.Message.ProjectCreated)(created.message)) {
        expect.fail('the host refused a create it should have accepted')
      }

      const refusedUpdate = await runEffect(
        hostUrl,
        UpdateProject({ project: created.message.project.id, name: 'oru', cwd: 'relative/place' })
          .effect,
      )
      expect(refusedUpdate).toEqual(
        Message.GotProjects({
          message: Projects.Message.UpdateRefused({
            refusal: Projects.RelativeCwd.make({ cwd: 'relative/place' }),
          }),
        }),
      )

      // The host wrote nothing, so neither refusal changed the list it answers.
      const listed = await runEffect(hostUrl, ListProjects().effect)
      if (!Predicate.isTagged(listed, 'GotProjects')) expect.fail('the list produced no answer')
      expect(listed.message).toEqual(
        Projects.Message.ProjectsArrived({ projects: [created.message.project] }),
      )
    })
  })
})
