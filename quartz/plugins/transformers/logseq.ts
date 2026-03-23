import { QuartzTransformerPlugin } from "../types"
import { Root, List, ListItem, Parent } from "mdast"
import { toString } from "mdast-util-to-string"

export interface Options {
  /** Remove Logseq properties like `id::`, `private::`, etc. */
  removeProperties: boolean
  /** Remove first list item if it matches the title */
  removeDuplicateTitle: boolean
  /** Minimum similarity ratio for fuzzy matching (0-1) */
  titleMatchThreshold: number
}

const defaultOptions: Options = {
  removeProperties: true,
  removeDuplicateTitle: true,
  titleMatchThreshold: 0.7,
}

// Matches Logseq properties: word:: value (entire line)
const propertyLineRegex = /^[ \t]*[a-zA-Z_-]+::[ \t]*.*$/gm

// Matches empty list items (just a dash with optional whitespace, nothing else)
const emptyListItemRegex = /^[ \t]*-[ \t]*$/gm

// Check for private:: true
const privateRegex = /^\s*private::\s*true\s*$/m

// Strip wikilinks and HTML tags
function stripMarkup(text: string): string {
  return text
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // wikilinks
    .replace(/<[^>]+>/g, "") // HTML tags
    .trim()
}

// Simple fuzzy match - normalize and compare
function similarity(a: string, b: string): number {
  // Normalize: lowercase, remove accents, remove non-alphanumeric
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9]/g, "")

  const s1 = normalize(a)
  const s2 = normalize(b)

  if (s1 === s2) return 1
  if (s1.length === 0 || s2.length === 0) return 0

  // Check if one contains the other
  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1

  if (longer.includes(shorter)) {
    return shorter.length / longer.length
  }

  // Simple character overlap ratio
  let matches = 0
  for (const char of shorter) {
    if (longer.includes(char)) matches++
  }
  return matches / longer.length
}

// Extract all text from a list item (excluding child lists)
function getListItemText(item: ListItem): string {
  let text = ""
  for (const child of item.children) {
    if (child.type !== "list") {
      text += toString(child)
    }
  }
  return stripMarkup(text)
}

// Check if a list item has child lists
function hasChildList(item: ListItem): boolean {
  return item.children.some((child) => child.type === "list")
}

// Get the child list from a list item
function getChildList(item: ListItem): List | null {
  for (const child of item.children) {
    if (child.type === "list") {
      return child as List
    }
  }
  return null
}

export const LogseqFlavoredMarkdown: QuartzTransformerPlugin<Partial<Options> | undefined> = (
  userOpts,
) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "LogseqFlavoredMarkdown",
    textTransform(_ctx, src) {
      if (!opts.removeProperties) return src

      let result = src

      // Check for private:: true and add to frontmatter
      const isPrivate = privateRegex.test(src)
      if (isPrivate) {
        // Check if frontmatter exists
        if (result.startsWith("---\n")) {
          // Insert private tag into existing frontmatter
          const endOfFrontmatter = result.indexOf("\n---", 4)
          if (endOfFrontmatter !== -1) {
            const frontmatter = result.slice(4, endOfFrontmatter)
            // Check if tags already exist
            if (frontmatter.includes("tags:")) {
              // Add to existing tags
              result = result.replace(/^(tags:\s*\n?)/m, "$1  - private\n")
            } else {
              // Add tags field
              result =
                result.slice(0, endOfFrontmatter) +
                "\ntags:\n  - private" +
                result.slice(endOfFrontmatter)
            }
          }
        } else {
          // Add frontmatter with private tag
          result = "---\ntags:\n  - private\n---\n" + result
        }
      }

      // Remove property lines
      result = result.replace(propertyLineRegex, "")

      // Remove empty list items
      result = result.replace(emptyListItemRegex, "")

      // Clean up multiple consecutive blank lines
      result = result.replace(/\n{3,}/g, "\n\n")

      return result
    },
    markdownPlugins() {
      if (!opts.removeDuplicateTitle) return []

      return [
        () => {
          return (tree: Root, file) => {
            const title = file.data.frontmatter?.title || file.stem || ""

            // Find first list that's a direct child of root
            for (let i = 0; i < tree.children.length; i++) {
              const node = tree.children[i]
              if (node.type !== "list") continue

              const list = node as List
              if (list.children.length === 0) continue

              const firstItem = list.children[0]
              const firstItemText = getListItemText(firstItem)
              const hasChild = hasChildList(firstItem)

              // Check if first item matches title
              const matchRatio = similarity(firstItemText, title)

              if (matchRatio >= opts.titleMatchThreshold && hasChild) {
                const childList = getChildList(firstItem)
                if (childList) {
                  if (list.children.length === 1) {
                    // Replace the entire list with the child list
                    tree.children[i] = childList
                  } else {
                    // Replace first item with its children, keep other items
                    list.children = [...childList.children, ...list.children.slice(1)]
                  }
                }
              }
              break // Only process first list
            }
          }
        },
      ]
    },
  }
}
