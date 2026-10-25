import { describe, expect, test } from "bun:test"
import { codeOnlyFiles, rewindPlan } from "./rewind-mode"

describe("rewind modes", () => {
  test("each mode restores files, hides the conversation, or both", () => {
    expect(rewindPlan("both")).toEqual({ files: true, conversation: true })
    expect(rewindPlan("conversation")).toEqual({ files: false, conversation: true })
    expect(rewindPlan("code")).toEqual({ files: true, conversation: false })
  })

  test("code only writes back modified and recreated files and keeps files created later", () => {
    expect(
      codeOnlyFiles([
        { file: "a.txt", status: "modified" },
        { file: "gone.txt", status: "added" },
        { file: "new.txt", status: "deleted" },
      ]),
    ).toEqual({ write: ["a.txt", "gone.txt"], kept: ["new.txt"] })
  })
})
