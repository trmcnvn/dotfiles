import { homedir, platform } from "os";
import { join } from "path";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";

const PEON_BASE_URL =
  "https://raw.githubusercontent.com/tonyyont/peon-ping/main/packs/peon";
const ERROR_IDLE_SUPPRESS_MS = 15_000;
const PEON_CACHE_DIR = join(homedir(), ".cache", "opencode-peon", "peon");
const PEON_SOUNDS_DIR = join(PEON_CACHE_DIR, "sounds");
const PEON_MANIFEST_PATH = join(PEON_CACHE_DIR, "manifest.json");

const FALLBACK_SOUND_PATH =
  platform() === "darwin"
    ? "/System/Library/Sounds/Submarine.aiff"
    : "/usr/share/sounds/freedesktop/stereo/message.oga";

const isSafeFilename = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  return !value.includes("/") && !value.includes("\\") && !value.includes("..");
};

const parsePeonSoundFile = (soundEntry) => {
  if (!soundEntry || typeof soundEntry !== "object") {
    return null;
  }

  const file = soundEntry.file;
  return isSafeFilename(file) ? file : null;
};

const parsePeonCategoryMap = (manifestValue) => {
  if (!manifestValue || typeof manifestValue !== "object") {
    return null;
  }

  const categoriesValue = manifestValue.categories;
  if (!categoriesValue || typeof categoriesValue !== "object") {
    return null;
  }

  const categoryMap = Object.create(null);

  for (const [categoryName, categoryValue] of Object.entries(categoriesValue)) {
    if (!categoryValue || typeof categoryValue !== "object") {
      continue;
    }

    const soundsValue = categoryValue.sounds;
    if (!Array.isArray(soundsValue)) {
      continue;
    }

    const files = soundsValue
      .map(parsePeonSoundFile)
      .filter((file) => file !== null);

    if (files.length > 0) {
      categoryMap[categoryName] = files;
    }
  }

  return Object.keys(categoryMap).length > 0 ? categoryMap : null;
};

const fileExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const writeFileAtomic = async (targetPath, data) => {
  const tmpPath = `${targetPath}.tmp`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, targetPath);
};

const fetchOrThrow = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response;
};

const fetchText = async (url) => {
  const response = await fetchOrThrow(url);
  return response.text();
};

const fetchBinary = async (url) => {
  const response = await fetchOrThrow(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
};

const loadLocalPeonCategoryMap = async () => {
  try {
    const manifestRaw = await readFile(PEON_MANIFEST_PATH, "utf8");
    const manifestValue = JSON.parse(manifestRaw);
    const categoryMap = parsePeonCategoryMap(manifestValue);
    if (!categoryMap) {
      return null;
    }

    const allFiles = new Set(Object.values(categoryMap).flat());
    for (const file of allFiles) {
      if (!(await fileExists(join(PEON_SOUNDS_DIR, file)))) {
        return null;
      }
    }

    return categoryMap;
  } catch {
    return null;
  }
};

const installPeonAssets = async (categoryMap) => {
  await mkdir(PEON_CACHE_DIR, { recursive: true });
  await mkdir(PEON_SOUNDS_DIR, { recursive: true });

  const allFiles = new Set(Object.values(categoryMap).flat());
  for (const file of allFiles) {
    const soundPath = join(PEON_SOUNDS_DIR, file);
    if (await fileExists(soundPath)) {
      continue;
    }

    const soundUrl = `${PEON_BASE_URL}/sounds/${file}`;
    const soundBytes = await fetchBinary(soundUrl);
    await writeFileAtomic(soundPath, soundBytes);
  }
};

const fetchAndInstallPeon = async () => {
  const manifestUrl = `${PEON_BASE_URL}/manifest.json`;
  const manifestText = await fetchText(manifestUrl);
  const manifestValue = JSON.parse(manifestText);
  const categoryMap = parsePeonCategoryMap(manifestValue);
  if (!categoryMap) {
    throw new Error("Invalid peon manifest");
  }

  await mkdir(PEON_CACHE_DIR, { recursive: true });
  await writeFileAtomic(PEON_MANIFEST_PATH, manifestText);
  await installPeonAssets(categoryMap);
  return categoryMap;
};

export const NotificationPlugin = async ({ $, client }) => {
  const lastPlayedByCategory = new Map();
  const recentErrorBySession = new Map();
  let peonCategoryMap = await loadLocalPeonCategoryMap();
  let peonInstallPromise = null;

  const shouldSuppressIdleForRecentError = (sessionID) => {
    const lastErrorAt = recentErrorBySession.get(sessionID);
    recentErrorBySession.delete(sessionID);

    return (
      typeof lastErrorAt === "number" &&
      Date.now() - lastErrorAt < ERROR_IDLE_SUPPRESS_MS
    );
  };

  const ensurePeonInstalled = () => {
    if (peonCategoryMap) {
      return Promise.resolve(peonCategoryMap);
    }

    if (!peonInstallPromise) {
      peonInstallPromise = fetchAndInstallPeon()
        .then((installedCategoryMap) => {
          peonCategoryMap = installedCategoryMap;
          return installedCategoryMap;
        })
        .catch(() => null)
        .finally(() => {
          peonInstallPromise = null;
        });
    }

    return peonInstallPromise;
  };

  if (!peonCategoryMap) {
    void ensurePeonInstalled();
  }

  const pickPeonSoundPath = (categoryName) => {
    if (!peonCategoryMap) {
      return null;
    }

    const files = peonCategoryMap[categoryName];
    if (!Array.isArray(files) || files.length === 0) {
      return null;
    }

    const lastPlayed = lastPlayedByCategory.get(categoryName);
    const choices = files.length > 1 ? files.filter((file) => file !== lastPlayed) : files;
    const selectedFile = choices[Math.floor(Math.random() * choices.length)] ?? files[0];
    lastPlayedByCategory.set(categoryName, selectedFile);
    return join(PEON_SOUNDS_DIR, selectedFile);
  };

  const playSound = async (categoryName) => {
    let soundPath = pickPeonSoundPath(categoryName);
    if (!soundPath) {
      void ensurePeonInstalled();
      soundPath = FALLBACK_SOUND_PATH;
    }

    try {
      await $`ffplay -nodisp -autoexit -loglevel quiet -hide_banner ${soundPath}`;
    } catch { }
  };

  const isMainSession = async (sessionID) => {
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const session = result.data ?? result;
      return !session.parentID;
    } catch {
      return true;
    }
  };

  const shouldNotifyForSession = async (sessionID) => {
    if (!sessionID) {
      return true;
    }
    return isMainSession(sessionID);
  };

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.status": {
          const sessionID = event.properties?.sessionID;
          const statusType = event.properties?.status?.type;
          if (!sessionID) return;

          if (statusType === "idle") {
            if (shouldSuppressIdleForRecentError(sessionID)) return;
            if (await shouldNotifyForSession(sessionID)) {
              await playSound("complete");
            }
          }
          return;
        }

        case "permission.asked": {
          const sessionID = event.properties?.sessionID;
          if (await shouldNotifyForSession(sessionID)) {
            await playSound("permission");
          }
          return;
        }

        default:
          return;
      }
    },
  };
};
