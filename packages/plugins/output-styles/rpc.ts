import { Schema } from "effect"
import { Rpc } from "@opencode/schema/rpc"

// The promise plugin API and client take Standard Schema definitions.
const standard = Schema.toStandardSchemaV1

const Style = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  source: Schema.Literals(["builtin", "user", "project"]),
})

export const OutputStylesRpc = Rpc.define({
  id: "cheyenne.output-styles",
  methods: {
    list: {
      input: standard(Schema.Struct({})),
      output: standard(Schema.Struct({ current: Schema.String, styles: Schema.Array(Style) })),
    },
    set: {
      input: standard(Schema.Struct({ name: Schema.String })),
      output: standard(Schema.Struct({ current: Schema.String })),
    },
  },
  events: {},
})
