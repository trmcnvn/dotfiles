import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const PEON_PACK_BASE_URL =
  "https://raw.githubusercontent.com/PeonPing/og-packs/main/peon";
const PEON_MANIFEST_URL = `${PEON_PACK_BASE_URL}/openpeon.json`;
const PRIMARY_CACHE_DIR = join(homedir(), ".cache", "pi-peon", "peon");
const COMPLETE_CATEGORY = "task.complete";
const FALLBACK_SOUND_PATH =
  platform() === "darwin"
    ? "/System/Library/Sounds/Submarine.aiff"
    : "/usr/share/sounds/freedesktop/stereo/message.oga";
const FETCH_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;
type CategoryMap = Readonly<Record<string, readonly string[]>>;
type InstalledPack = {
  readonly categoryMap: CategoryMap;
  readonly soundsDir: string;
};
type CachePaths = {
  readonly cacheDir: string;
  readonly soundsDir: string;
  readonly manifestPath: string;
};
type AgentEndContext = {
  readonly hasUI: boolean;
  hasPendingMessages(): boolean;
};

let installedPack: InstalledPack | null = null;
let installPromise: Promise<InstalledPack | null> | null = null;
const lastPlayedByCategory = new Map<string, string>();

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeRelativePath = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
};

const parsePeonSoundFile = (soundEntry: unknown): string | null => {
  if (!isRecord(soundEntry)) {
    return null;
  }

  const file = soundEntry.file;
  return isSafeRelativePath(file) ? file : null;
};

const parsePeonCategoryMap = (manifestValue: unknown): CategoryMap | null => {
  if (!isRecord(manifestValue)) {
    return null;
  }

  const categoriesValue = manifestValue.categories;
  if (!isRecord(categoriesValue)) {
    return null;
  }

  const categoryMap: Record<string, readonly string[]> = {};

  for (const [categoryName, categoryValue] of Object.entries(categoriesValue)) {
    if (!isRecord(categoryValue)) {
      continue;
    }

    const soundsValue = categoryValue.sounds;
    if (!Array.isArray(soundsValue)) {
      continue;
    }

    const files = soundsValue
      .map(parsePeonSoundFile)
      .filter((file): file is string => file !== null);

    if (files.length > 0) {
      categoryMap[categoryName] = files;
    }
  }

  return Object.keys(categoryMap).length > 0 ? categoryMap : null;
};

const parseManifestText = (manifestText: string): CategoryMap | null => {
  const manifestValue: unknown = JSON.parse(manifestText);
  return parsePeonCategoryMap(manifestValue);
};

const getPackFiles = (categoryMap: CategoryMap): Set<string> =>
  new Set(Object.values(categoryMap).flat());

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const hasInstalledSoundFiles = async (
  categoryMap: CategoryMap,
  soundsDir: string,
): Promise<boolean> => {
  for (const file of getPackFiles(categoryMap)) {
    if (!(await fileExists(join(soundsDir, file)))) {
      return false;
    }
  }

  return true;
};

const getCachePaths = (cacheDir: string): CachePaths => ({
  cacheDir,
  soundsDir: cacheDir,
  manifestPath: join(cacheDir, "manifest.json"),
});

const writeFileAtomic = async (
  targetPath: string,
  data: string | Uint8Array,
): Promise<void> => {
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, targetPath);
};

const createFetchTimeoutSignal = (): {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
} => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timeout.unref?.();

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

const fetchOrThrow = async (url: string, signal: AbortSignal): Promise<Response> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response;
};

const withFetchTimeout = async <T>(
  url: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const { signal, cleanup } = createFetchTimeoutSignal();

  try {
    return await operation(signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)}s fetching ${url}`);
    }
    throw error;
  } finally {
    cleanup();
  }
};

const fetchText = async (url: string): Promise<string> =>
  await withFetchTimeout(url, async (signal) => {
    const response = await fetchOrThrow(url, signal);
    return await response.text();
  });

const fetchBinary = async (url: string): Promise<Buffer> =>
  await withFetchTimeout(url, async (signal) => {
    const response = await fetchOrThrow(url, signal);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  });

const encodePathForUrl = (relativePath: string): string =>
  relativePath.split("/").map(encodeURIComponent).join("/");

const loadLocalPack = async (cacheDir: string): Promise<InstalledPack | null> => {
  const cachePaths = getCachePaths(cacheDir);

  try {
    const manifestRaw = await readFile(cachePaths.manifestPath, "utf8");
    const categoryMap = parseManifestText(manifestRaw);
    if (categoryMap === null) {
      return null;
    }

    if (!(await hasInstalledSoundFiles(categoryMap, cachePaths.soundsDir))) {
      return null;
    }

    return {
      categoryMap,
      soundsDir: cachePaths.soundsDir,
    };
  } catch {
    return null;
  }
};

const loadLocalInstalledPack = async (): Promise<InstalledPack | null> =>
  loadLocalPack(PRIMARY_CACHE_DIR);

const installSoundFiles = async (
  categoryMap: CategoryMap,
  soundsDir: string,
): Promise<void> => {
  for (const file of getPackFiles(categoryMap)) {
    const soundPath = join(soundsDir, file);
    if (await fileExists(soundPath)) {
      continue;
    }

    await mkdir(dirname(soundPath), { recursive: true });
    const soundUrl = `${PEON_PACK_BASE_URL}/${encodePathForUrl(file)}`;
    const soundBytes = await fetchBinary(soundUrl);
    await writeFileAtomic(soundPath, soundBytes);
  }
};

const installPack = async (categoryMap: CategoryMap): Promise<InstalledPack> => {
  const cachePaths = getCachePaths(PRIMARY_CACHE_DIR);
  await mkdir(cachePaths.cacheDir, { recursive: true });
  await mkdir(cachePaths.soundsDir, { recursive: true });
  await installSoundFiles(categoryMap, cachePaths.soundsDir);

  return {
    categoryMap,
    soundsDir: cachePaths.soundsDir,
  };
};

const fetchAndInstallPack = async (): Promise<InstalledPack> => {
  const manifestText = await fetchText(PEON_MANIFEST_URL);
  const categoryMap = parseManifestText(manifestText);
  if (categoryMap === null) {
    throw new Error("Invalid peon manifest");
  }

  const pack = await installPack(categoryMap);
  const cachePaths = getCachePaths(PRIMARY_CACHE_DIR);
  await writeFileAtomic(cachePaths.manifestPath, manifestText);
  return pack;
};

const ensurePackLoaded = (): Promise<InstalledPack | null> => {
  if (installedPack !== null) {
    return Promise.resolve(installedPack);
  }

  if (installPromise === null) {
    installPromise = loadLocalInstalledPack()
      .then((localPack) => localPack ?? fetchAndInstallPack())
      .then((pack) => {
        installedPack = pack;
        return pack;
      })
      .catch(() => null)
      .finally(() => {
        installPromise = null;
      });
  }

  return installPromise;
};

const pickRandomFile = (
  files: readonly string[],
  lastPlayed: string | undefined,
): string => {
  const choices =
    files.length > 1 ? files.filter((file) => file !== lastPlayed) : files;
  return choices[Math.floor(Math.random() * choices.length)] ?? files[0];
};

const pickSoundPath = (categoryName: string): string | null => {
  if (installedPack === null) {
    return null;
  }

  const files = installedPack.categoryMap[categoryName];
  if (files === undefined || files.length === 0) {
    return null;
  }

  const selectedFile = pickRandomFile(
    files,
    lastPlayedByCategory.get(categoryName),
  );

  lastPlayedByCategory.set(categoryName, selectedFile);
  return join(installedPack.soundsDir, selectedFile);
};

const playSound = (categoryName: string): void => {
  let soundPath = pickSoundPath(categoryName);
  if (soundPath === null) {
    void ensurePackLoaded();
    soundPath = FALLBACK_SOUND_PATH;
  }

  const child = spawn(
    "ffplay",
    ["-nodisp", "-autoexit", "-loglevel", "quiet", "-hide_banner", soundPath],
    { stdio: "ignore" },
  );

  child.on("error", () => {
    // Best-effort notification only.
  });
  child.unref();
};

const shouldPlayCompletionSound = (ctx: AgentEndContext): boolean =>
  ctx.hasUI && process.stdout.isTTY && !ctx.hasPendingMessages();

export default function notificationExtension(pi: ExtensionAPI) {
  void ensurePackLoaded();

  pi.on("agent_end", (_event, ctx) => {
    if (!shouldPlayCompletionSound(ctx)) {
      return;
    }

    playSound(COMPLETE_CATEGORY);
  });
}
