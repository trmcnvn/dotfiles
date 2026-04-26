import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const messages: readonly [string, ...string[]] = [
  "Schlepping...",
  "Combobulating...",
  "Channelling...",
  "Vibing...",
  "Concocting...",
  "Spelunking...",
  "Transmuting...",
  "Imagining...",
  "Pontificating...",
  "Whirring...",
  "Cogitating...",
  "Noodling...",
  "Percolating...",
  "Ruminating...",
  "Simmering...",
  "Marinating...",
  "Fermenting...",
  "Contemplating...",
  "Musing...",
  "Pondering...",
  "Tinkering...",
  "Finagling...",
  "Kerfuffling...",
  "Discombobulating...",
  "Recombobulating...",
  "Confabulating...",
  "Flummoxing...",
  "Pirouetting...",
  "Schmoozing...",
  "Kibbitzing...",
  "Swashbuckling...",
  "Effervescing...",
  "Mesmerizing...",
  "Synthesizing...",
  "Improvising...",
  "Freestyling...",
  "Frolicking...",
  "Doodling...",
  "Shimmering...",
  "Tumbling...",
  "Consulting the void...",
  "Asking the electrons...",
  "Bribing the compiler...",
  "Negotiating with entropy...",
  "Whispering to the bits...",
  "Tickling the stack...",
  "Massaging the heap...",
  "Appeasing the garbage collector...",
  "Summoning semicolons...",
  "Herding pointers...",
  "Untangling spaghetti...",
  "Polishing the algorithms...",
  "Shaking the magic 8-ball...",
  "Sacrificing to the demo gods...",
  "Having a little think...",
  "Stroking chin thoughtfully...",
  "Staring into the abyss...",
  "Communing with the machine spirit...",
  "Performing arcane rituals...",
  "Invoking elder functions...",
  "Consulting the oracle...",
  "Scrying the codebase...",
  "Dowsing for bugs...",
  "Reticulating splines...",
  "Reversing the polarity...",
  "Calibrating the flux capacitor...",
  "Manifesting solutions...",
  "Sweet-talking the API...",
  "Having words with the cache...",
  "Consulting the rubber duck...",
  "Interrogating the stack trace...",
  "Cross-examining the debugger...",
  "Giving the code a pep talk...",
  "Shaking loose the cobwebs...",
  "Herding cats in memory...",
  "Teaching old code new tricks...",
  "Whispering sweet nothings to the compiler...",
  "Dancing with dependencies...",
  "Tangoing with type errors...",
  "Unearthing buried bugs...",
];

const WAVE_INTERVAL_MS = 140;
const CHARACTER_HUE_STEP = 0.045;
const FRAME_HUE_STEP = 0.03;
const SATURATION = 0.45;
const VALUE = 0.82;

type Rgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

const pickRandomMessage = (lastMessage: string | undefined): string => {
  const candidates =
    lastMessage !== undefined && messages.length > 1
      ? messages.filter((message) => message !== lastMessage)
      : messages;

  return candidates[Math.floor(Math.random() * candidates.length)] ?? messages[0];
};

const normalizeHue = (value: number): number => {
  const normalized = value % 1;
  return normalized < 0 ? normalized + 1 : normalized;
};

const hsvToRgb = (hue: number, saturation: number, value: number): Rgb => {
  const scaledHue = normalizeHue(hue) * 6;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((scaledHue % 2) - 1));
  const match = value - chroma;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (scaledHue < 1) {
    red = chroma;
    green = x;
  } else if (scaledHue < 2) {
    red = x;
    green = chroma;
  } else if (scaledHue < 3) {
    green = chroma;
    blue = x;
  } else if (scaledHue < 4) {
    green = x;
    blue = chroma;
  } else if (scaledHue < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
};

const colorize = (rgb: Rgb, text: string): string =>
  `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[39m`;

const renderRainbowWave = (message: string, phase: number): string =>
  Array.from(message)
    .map((char, index) => {
      const rgb = hsvToRgb(phase + index * CHARACTER_HUE_STEP, SATURATION, VALUE);
      return colorize(rgb, char);
    })
    .join("");

const supportsAnimation = (ctx: ExtensionContext): boolean =>
  ctx.hasUI && process.stdout.isTTY;

export default function whimsicalExtension(pi: ExtensionAPI) {
  let lastMessage: string | undefined;
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let wavePhase = 0;

  const stopRainbowWave = (): void => {
    if (animationTimer === undefined) {
      return;
    }

    clearInterval(animationTimer);
    animationTimer = undefined;
  };

  const startRainbowWave = (ctx: ExtensionContext, message: string): void => {
    stopRainbowWave();

    if (!supportsAnimation(ctx)) {
      ctx.ui.setWorkingMessage(message);
      return;
    }

    wavePhase = Math.random();

    const update = () => {
      ctx.ui.setWorkingMessage(renderRainbowWave(message, wavePhase));
    };

    update();

    animationTimer = setInterval(() => {
      wavePhase = normalizeHue(wavePhase - FRAME_HUE_STEP);
      update();
    }, WAVE_INTERVAL_MS);
  };

  const resetWorkingMessage = (ctx: ExtensionContext): void => {
    stopRainbowWave();
    ctx.ui.setWorkingMessage();
  };

  pi.on("turn_start", (_event, ctx) => {
    const message = pickRandomMessage(lastMessage);
    lastMessage = message;
    startRainbowWave(ctx, message);
  });

  pi.on("turn_end", (_event, ctx) => {
    resetWorkingMessage(ctx);
  });

  pi.on("session_start", (_event, ctx) => {
    resetWorkingMessage(ctx);
  });

  pi.on("session_shutdown", () => {
    stopRainbowWave();
  });
}
