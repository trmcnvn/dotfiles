import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWebfetchTool } from "./shared.js";

export default function webfetchExtension(pi: ExtensionAPI) {
  registerWebfetchTool(pi);
}
