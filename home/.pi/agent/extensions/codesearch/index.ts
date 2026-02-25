import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCodesearchTool } from "./shared.js";

export default function codesearchExtension(pi: ExtensionAPI) {
  registerCodesearchTool(pi);
}
