import type { FileDiffInfo } from "@opencode/client/promise"

// cheyenne: the three choices of the rewind screen (Claude Code's /rewind) on top of the session revert.
export type RewindMode = "both" | "conversation" | "code"

/** What a rewind to a checkpoint changes: `files` restores the files, `conversation` hides the later messages. */
export function rewindPlan(mode: RewindMode) {
  return { files: mode !== "conversation", conversation: mode !== "code" }
}

/**
 * Code only stages a revert with files, reads the restored files, clears the revert and writes them back.
 * A file the checkpoint did not have shows as "deleted" in the staged diff; fs has no delete, so it is kept.
 */
export function codeOnlyFiles(diffs: readonly Pick<FileDiffInfo, "file" | "status">[]) {
  return {
    write: diffs.filter((diff) => diff.status !== "deleted").map((diff) => diff.file),
    kept: diffs.filter((diff) => diff.status === "deleted").map((diff) => diff.file),
  }
}
