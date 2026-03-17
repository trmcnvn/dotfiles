import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadSkillsFromDir, type Skill } from "@mariozechner/pi-coding-agent";

const PROJECT_SKILLS_DIRNAME = ".pi";
const PROJECT_SKILLS_BASENAME = "skills";
const USER_SKILLS_DIR = join(homedir(), ".pi", "agent", "skills");

export type SkillSelection = readonly string[] | false | undefined;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeSkillName = (value: string): string => value.trim().toLowerCase();

const parseSkillList = (value: unknown): readonly string[] | null => {
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const items: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) {
      return null;
    }
    items.push(item.trim());
  }
  return items;
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

export const findNearestProjectSkillsDir = async (
  cwd: string,
): Promise<string | null> => {
  let currentDir = cwd;

  while (true) {
    const candidate = join(currentDir, PROJECT_SKILLS_DIRNAME, PROJECT_SKILLS_BASENAME);
    if (await isDirectory(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

export const readSkillSelection = (
  value: unknown,
  otherValue: unknown,
  label: string,
): SkillSelection => {
  if (value !== undefined && otherValue !== undefined) {
    throw new Error(`Provide either ${label}.skill or ${label}.skills, not both.`);
  }

  const rawValue = otherValue ?? value;
  if (rawValue === undefined) {
    return undefined;
  }

  if (rawValue === false) {
    return false;
  }

  const parsed = parseSkillList(rawValue);
  if (parsed === null) {
    throw new Error(
      `${label}.skill must be a comma-separated string, an array of strings, or false.`,
    );
  }

  return parsed;
};

export const resolveSelectedSkillNames = (
  defaultSkills: readonly string[],
  override: SkillSelection,
): readonly string[] => {
  if (override === undefined) {
    return defaultSkills;
  }

  if (override === false) {
    return [];
  }

  return override;
};

export const loadAvailableSubagentSkills = async (
  cwd: string,
): Promise<readonly Skill[]> => {
  const projectSkillsDir = await findNearestProjectSkillsDir(cwd);
  const projectSkills =
    projectSkillsDir === null
      ? []
      : loadSkillsFromDir({ dir: projectSkillsDir, source: "project" }).skills;
  const userSkills = loadSkillsFromDir({ dir: USER_SKILLS_DIR, source: "user" }).skills;

  const deduped = new Map<string, Skill>();
  for (const skill of projectSkills) {
    deduped.set(normalizeSkillName(skill.name), skill);
  }
  for (const skill of userSkills) {
    deduped.set(normalizeSkillName(skill.name), skill);
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

export const resolveSkillPaths = async (
  cwd: string,
  skillNames: readonly string[],
): Promise<readonly string[]> => {
  if (skillNames.length === 0) {
    return [];
  }

  const availableSkills = await loadAvailableSubagentSkills(cwd);
  const skillsByName = new Map<string, Skill>();
  for (const skill of availableSkills) {
    skillsByName.set(normalizeSkillName(skill.name), skill);
  }

  const resolvedPaths: string[] = [];
  const missingSkills: string[] = [];
  for (const skillName of skillNames) {
    const normalizedName = normalizeSkillName(skillName);
    const skill = skillsByName.get(normalizedName);
    if (skill === undefined) {
      missingSkills.push(skillName);
      continue;
    }
    resolvedPaths.push(skill.filePath);
  }

  if (missingSkills.length > 0) {
    const availableNames = availableSkills.map((skill) => skill.name).join(", ") || "none";
    throw new Error(
      `Unknown skill${missingSkills.length === 1 ? "" : "s"}: ${missingSkills.join(", ")}. ` +
        `Available skills: ${availableNames}. Add the skill under ~/.pi/agent/skills or the nearest .pi/skills directory, then retry.`,
    );
  }

  return resolvedPaths;
};

