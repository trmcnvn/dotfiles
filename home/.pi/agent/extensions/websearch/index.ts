import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWebsearchTool } from "./shared.js";

export default function websearchExtension(pi: ExtensionAPI) {
  registerWebsearchTool(pi);
}
