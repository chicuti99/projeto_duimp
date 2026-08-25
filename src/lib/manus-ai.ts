const MANUS_API_BASE_URL = "https://api.manus.ai/v2";
const MANUS_DEFAULT_TIMEOUT_MS = 180_000;
const MANUS_DEFAULT_POLL_INTERVAL_MS = 10_000;

type ManusErrorResponse = {
  ok: false;
  error?: {
    code?: string;
    message?: string;
  };
};

type ManusContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "file";
      file_data: string;
      filename: string;
      mime_type: string;
    };

type ManusTaskCreateResponse =
  | {
      ok: true;
      task_id: string;
    }
  | ManusErrorResponse;

type ManusTaskMessage = {
  type?: string;
  structured_output_result?: {
    success?: boolean;
    value?: unknown;
    error?: string | null;
  };
  status_update?: {
    agent_status?: "running" | "stopped" | "waiting" | "error";
    status_detail?: {
      waiting_for_event_type?: string;
      waiting_description?: string;
    };
    brief?: string;
    description?: string;
  };
  error_message?: {
    content?: string;
    error_type?: string;
  };
};

type ManusListMessagesResponse =
  | {
      ok: true;
      messages?: ManusTaskMessage[];
    }
  | ManusErrorResponse;

type RunManusStructuredOutputOptions = {
  title: string;
  prompt: string;
  schema: Record<string, unknown>;
  attachments?: Array<{
    name: string;
    mimeType: string;
    data: string;
  }>;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

function getManusApiKey() {
  return process.env.MANUS_API_KEY?.trim() || "";
}

export function isManusConfigured() {
  return Boolean(getManusApiKey());
}

export function isRecoverableGeminiError(error: unknown) {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = String(
    typeof error === "object" && error !== null && "message" in error
      ? (error as { message?: unknown }).message
      : (error ?? ""),
  );

  return (
    error instanceof SyntaxError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      ((error as { name?: unknown }).name === "ZodError" ||
        (error as { name?: unknown }).name === "AbortError")) ||
    status === 429 ||
    status === 503 ||
    status === 504 ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(message) ||
    /\b(code|status)["':\s]+(429|503|504)\b/i.test(message) ||
    /quota|rate limit|limite de requisi/i.test(message) ||
    /overload|sobrecarreg|timeout|timed out|deadline|aborted|abortad/i.test(
      message,
    ) ||
    /resposta da ia retornou vazia/i.test(message)
  );
}

export function createManusFallbackError(
  geminiError: unknown,
  manusError: unknown,
) {
  const geminiMessage =
    geminiError instanceof Error ? geminiError.message : String(geminiError);
  const manusMessage =
    manusError instanceof Error ? manusError.message : String(manusError);

  return new Error(
    `Gemini falhou e o fallback Manus tambem nao conseguiu responder. Gemini: ${geminiMessage}. Manus: ${manusMessage}`,
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseManusResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Manus retornou resposta invalida (${response.status}): ${text}`,
    );
  }

  if (!response.ok) {
    const error = body as ManusErrorResponse;
    throw new Error(
      error.error?.message ||
        `Manus retornou erro HTTP ${response.status} na requisicao.`,
    );
  }

  const maybeError = body as ManusErrorResponse;
  if (maybeError.ok === false) {
    throw new Error(
      maybeError.error?.message ||
        maybeError.error?.code ||
        "Manus retornou erro na requisicao.",
    );
  }

  return body as T;
}

async function manusFetch<T>(
  path: string,
  init: RequestInit,
  timeoutMs = 30_000,
) {
  const apiKey = getManusApiKey();
  if (!apiKey) {
    throw new Error("MANUS_API_KEY nao configurada");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${MANUS_API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-manus-api-key": apiKey,
        ...(init.headers ?? {}),
      },
    });

    return await parseManusResponse<T>(response);
  } finally {
    clearTimeout(timeout);
  }
}

function buildContentParts(
  prompt: string,
  attachments: RunManusStructuredOutputOptions["attachments"] = [],
) {
  const parts: ManusContentPart[] = [{ type: "text", text: prompt }];

  for (const attachment of attachments) {
    parts.push({
      type: "file",
      file_data: `data:${attachment.mimeType};base64,${attachment.data}`,
      filename: attachment.name,
      mime_type: attachment.mimeType,
    });
  }

  return parts.length === 1 ? prompt : parts;
}

function getLatestStatus(messages: ManusTaskMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.type === "status_update")?.status_update;
}

function getLatestError(messages: ManusTaskMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.type === "error_message")?.error_message;
}

function getStructuredOutput(messages: ManusTaskMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.type === "structured_output_result")
    ?.structured_output_result;
}

export async function runManusStructuredOutput<T>({
  title,
  prompt,
  schema,
  attachments = [],
  timeoutMs = MANUS_DEFAULT_TIMEOUT_MS,
  pollIntervalMs = MANUS_DEFAULT_POLL_INTERVAL_MS,
}: RunManusStructuredOutputOptions): Promise<T> {
  const createResponse = await manusFetch<ManusTaskCreateResponse>(
    "/task.create",
    {
      method: "POST",
      body: JSON.stringify({
        message: {
          content: buildContentParts(prompt, attachments),
        },
        structured_output_schema: schema,
        title,
        locale: "pt-BR",
        interactive_mode: false,
        hide_in_task_list: true,
        share_visibility: "private",
        agent_profile: "manus-1.6-lite",
      }),
    },
  );

  if (!createResponse.ok || !createResponse.task_id) {
    throw new Error("Manus nao retornou task_id para o fallback.");
  }

  const deadline = Date.now() + timeoutMs;
  let sawStoppedAt: number | null = null;

  while (Date.now() < deadline) {
    const params = new URLSearchParams({
      task_id: createResponse.task_id,
      order: "asc",
      limit: "200",
    });

    const listResponse = await manusFetch<ManusListMessagesResponse>(
      `/task.listMessages?${params.toString()}`,
      { method: "GET" },
    );

    if (!listResponse.ok) {
      throw new Error("Manus nao retornou as mensagens do fallback.");
    }

    const messages = listResponse.messages ?? [];
    const structuredOutput = getStructuredOutput(messages);

    if (structuredOutput) {
      if (structuredOutput.success && structuredOutput.value) {
        return structuredOutput.value as T;
      }

      throw new Error(
        structuredOutput.error ||
          "Manus nao conseguiu extrair a saida estruturada.",
      );
    }

    const latestError = getLatestError(messages);
    if (latestError) {
      throw new Error(
        latestError.content ||
          latestError.error_type ||
          "Task Manus falhou durante o fallback.",
      );
    }

    const latestStatus = getLatestStatus(messages);
    if (latestStatus?.agent_status === "error") {
      throw new Error(
        latestStatus.description ||
          latestStatus.brief ||
          "Task Manus terminou com erro.",
      );
    }

    if (latestStatus?.agent_status === "waiting") {
      throw new Error(
        latestStatus.status_detail?.waiting_description ||
          `Task Manus aguardando acao (${latestStatus.status_detail?.waiting_for_event_type || "desconhecida"}).`,
      );
    }

    if (latestStatus?.agent_status === "stopped") {
      sawStoppedAt ??= Date.now();
      if (Date.now() - sawStoppedAt > 15_000) {
        throw new Error(
          "Task Manus terminou sem retornar structured_output_result.",
        );
      }
    }

    await delay(pollIntervalMs);
  }

  throw new Error("Timeout aguardando resposta do Manus.");
}
