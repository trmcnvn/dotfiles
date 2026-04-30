import { createServer } from "node:http";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAUTH_CALLBACK_BASE_URL } from "./constants.js";
import type { McpRuntime, OAuthCallbackCaptureResult } from "./types.js";
import { escapeHtml, isNonEmptyString } from "./utils.js";

export const createOAuthProvider = (
  runtime: McpRuntime,
  onStateChange: (runtime: McpRuntime) => void,
): OAuthClientProvider | null => {
  if (runtime.definition.type !== "remote" || runtime.oauthState === null) {
    return null;
  }

  const oauthState = runtime.oauthState;
  const clientMetadata: OAuthClientMetadata = {
    client_name: `Pi MCP (${runtime.definition.key})`,
    redirect_uris: [oauthState.redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };

  return {
    get redirectUrl() {
      return oauthState.redirectUrl;
    },

    get clientMetadata() {
      return clientMetadata;
    },

    clientInformation() {
      return oauthState.clientInformation;
    },

    saveClientInformation(clientInformation) {
      oauthState.clientInformation = clientInformation;
      onStateChange(runtime);
    },

    tokens() {
      return oauthState.tokens;
    },

    saveTokens(tokens) {
      oauthState.tokens = tokens;
      onStateChange(runtime);
    },

    redirectToAuthorization(authorizationUrl) {
      oauthState.pendingAuthorizationUrl = authorizationUrl;
    },

    saveCodeVerifier(codeVerifier) {
      oauthState.codeVerifier = codeVerifier;
    },

    codeVerifier() {
      if (!isNonEmptyString(oauthState.codeVerifier)) {
        throw new Error("OAuth code verifier is missing for this session.");
      }
      return oauthState.codeVerifier;
    },

    saveDiscoveryState(discoveryState) {
      oauthState.discoveryState = discoveryState;
      onStateChange(runtime);
    },

    discoveryState() {
      return oauthState.discoveryState;
    },

    invalidateCredentials(scope) {
      if (scope === "all" || scope === "client") {
        oauthState.clientInformation = undefined;
      }

      if (scope === "all" || scope === "tokens") {
        oauthState.tokens = undefined;
      }

      if (scope === "all" || scope === "verifier") {
        oauthState.codeVerifier = undefined;
      }

      if (scope === "all" || scope === "discovery") {
        oauthState.discoveryState = undefined;
      }

      onStateChange(runtime);
    },
  };
};

export const renderCallbackHtml = (title: string, message: string): string => {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return [
    "<!doctype html>",
    "<html>",
    "  <head><meta charset=\"utf-8\"><title>Pi MCP OAuth</title></head>",
    "  <body style=\"font-family: sans-serif; padding: 24px;\">",
    `    <h2>${safeTitle}</h2>`,
    `    <p>${safeMessage}</p>`,
    "    <p>You can close this tab and return to Pi.</p>",
    "  </body>",
    "</html>",
  ].join("\n");
};

export const waitForOAuthCallbackCode = async (
  serverKey: string,
  timeoutMs: number,
): Promise<OAuthCallbackCaptureResult> => {
  const callbackUrl = new URL(`${OAUTH_CALLBACK_BASE_URL}/${encodeURIComponent(serverKey)}`);
  const expectedPath = callbackUrl.pathname;
  const host = callbackUrl.hostname;
  const port =
    callbackUrl.port.length > 0
      ? Number(callbackUrl.port)
      : callbackUrl.protocol === "https:"
        ? 443
        : 80;

  if (!Number.isFinite(port) || port <= 0) {
    return {
      status: "unavailable",
      message: `Invalid OAuth callback port in redirect URL: ${callbackUrl.toString()}`,
    };
  }

  return await new Promise<OAuthCallbackCaptureResult>((resolve) => {
    let settled = false;

    const server = createServer((request, response) => {
      const writeHtml = (statusCode: number, title: string, message: string) => {
        response.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
        response.end(renderCallbackHtml(title, message));
      };

      const rawUrl = request.url;
      if (!isNonEmptyString(rawUrl)) {
        writeHtml(400, "Invalid callback", "The callback request URL was empty.");
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl, `http://${host}:${port}`);
      } catch {
        writeHtml(400, "Invalid callback", "Could not parse callback URL.");
        return;
      }

      if (parsedUrl.pathname !== expectedPath) {
        writeHtml(404, "Unexpected callback", `Expected path: ${expectedPath}`);
        return;
      }

      const oauthError = parsedUrl.searchParams.get("error");
      if (isNonEmptyString(oauthError)) {
        const oauthErrorDescription = parsedUrl.searchParams.get("error_description");
        const message = isNonEmptyString(oauthErrorDescription)
          ? `${oauthError}: ${oauthErrorDescription}`
          : oauthError;

        writeHtml(400, "Authorization failed", message);
        settle({
          status: "error",
          message: `OAuth server returned an error for ${serverKey}: ${message}`,
        });
        return;
      }

      const code = parsedUrl.searchParams.get("code");
      if (isNonEmptyString(code)) {
        writeHtml(200, "Authorization received", "Pi captured your OAuth callback successfully.");
        settle({ status: "code", code });
        return;
      }

      writeHtml(
        400,
        "Authorization code missing",
        "The callback did not include a code query parameter.",
      );
      settle({
        status: "error",
        message: `OAuth callback for ${serverKey} did not include a code parameter.`,
      });
    });

    const timeoutId = setTimeout(() => {
      settle({ status: "timeout" });
    }, timeoutMs);

    const settle = (result: OAuthCallbackCaptureResult) => {
      if (settled) {
        return;
      }
      settled = true;

      clearTimeout(timeoutId);
      server.close(() => {
        resolve(result);
      });
    };

    server.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      settle({ status: "unavailable", message });
    });

    server.listen(port, host);
  });
};
