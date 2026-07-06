// skill.ts — load the Custodian Agent Skill (mcp/SKILL.md) as the agent's system
// prompt. This is the point of the AI-Toolkit story: the SAME SKILL.md the MCP
// server advertises is what drives the agent's reasoning. We strip the YAML
// frontmatter and return the markdown body.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./config.js";

/** Strip a leading `---`...`---` YAML frontmatter block, if present. */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md.trim();
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md.trim();
  const after = md.indexOf("\n", end + 1);
  return (after === -1 ? "" : md.slice(after + 1)).trim();
}

/** Read mcp/SKILL.md and return its body (no frontmatter). */
export function loadSkill(): string {
  const path = resolve(REPO_ROOT, "mcp", "SKILL.md");
  return stripFrontmatter(readFileSync(path, "utf8"));
}
