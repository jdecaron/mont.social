import { QuartzFilterPlugin } from "../types"
import fs from "fs"

export interface Options {
  /** Property name to check for private status */
  property: string
}

const defaultOptions: Options = {
  property: "private",
}

export const RemoveLogseqPrivate: QuartzFilterPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "RemoveLogseqPrivate",
    shouldPublish(_ctx, [_tree, vfile]) {
      const filePath = vfile.data.filePath!

      try {
        const content = fs.readFileSync(filePath, "utf-8")
        const privateRegex = new RegExp(`^\\s*${opts.property}::\\s*true\\s*$`, "m")
        return !privateRegex.test(content)
      } catch {
        // If we can't read the file, allow it to be published
        return true
      }
    },
  }
}
