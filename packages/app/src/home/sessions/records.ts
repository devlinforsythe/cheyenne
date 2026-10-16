import type { SessionInfo } from "@opencode/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { displayName } from "@opencode/ui/project-avatar"
import { compareSessionTime } from "@/shell/layout/helpers"
import { pathKey } from "@/workspaces/path-key"
import { getFilename } from "@opencode/util/path"

export type HomeSessionRecord = {
  session: SessionInfo
  project: LocalProject
  projectName: string
}

export function homeSessionLocation(directory: string, branch?: string) {
  return { worktree: getFilename(directory) || directory, branch }
}

export function buildHomeSessionRecords(input: {
  sessions: () => SessionInfo[]
  projectDirectories: () => string[] | undefined
  projects: () => LocalProject[]
  resolveProject?: (session: SessionInfo) => LocalProject | undefined
}) {
  const selected = input.projectDirectories()
  const directories = selected ? new Set(selected.map(pathKey)) : undefined

  const sessions = directories
    ? input.sessions().filter((session) => directories.has(pathKey(session.location.directory)))
    : input.sessions()

  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .map((session) => {
      const project = input.resolveProject?.(session) ??
        homeProjectForSession(session, input.projects()) ?? {
          id: session.projectID,
          worktree: session.location.directory,
          expanded: false,
        }

      return { session, project, projectName: displayName(project) }
    })
}

// Worktree inventories load on demand, so a worktree session may not match any directory yet;
// the session's project ID still identifies its added project.
export function homeProjectForSession<T extends { id?: string; worktree: string; sandboxes?: readonly string[] }>(
  session: SessionInfo,
  projects: readonly T[],
) {
  const directory = pathKey(session.location.directory)

  return (
    projects.find(
      (item) =>
        pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
    ) ?? projects.find((item) => item.id === session.projectID)
  )
}

// cheyenne 6.0a: project/folder, model and agent group by a key; groups keep the most recent session first.
export function groupByKey(records: HomeSessionRecord[], key: (record: HomeSessionRecord) => string) {
  const groups = new Map<string, HomeSessionRecord[]>()
  for (const record of records) {
    const name = key(record)
    groups.set(name, [...(groups.get(name) ?? []), record])
  }
  return Array.from(groups, ([title, sessions]) => ({ id: title, title, sessions }))
}
