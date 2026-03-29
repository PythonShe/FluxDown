import type { APIRoute } from "astro";
import { GITHUB_TOKEN, GITHUB_REPO } from "astro:env/server";

export const prerender = false;

// ── Rate limiting ──────────────────────────────────────────────────────────────
const submitRateLimitMap = new Map<
  string,
  { count: number; resetAt: number }
>();
const SUBMIT_RATE_LIMIT_WINDOW = 24 * 60 * 60_000; // 24 hours
const SUBMIT_RATE_LIMIT_MAX = 3;

function isSubmitRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = submitRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    submitRateLimitMap.set(ip, {
      count: 1,
      resetAt: now + SUBMIT_RATE_LIMIT_WINDOW,
    });
    return false;
  }
  entry.count += 1;
  return entry.count > SUBMIT_RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of submitRateLimitMap) {
    if (now > entry.resetAt) submitRateLimitMap.delete(ip);
  }
}, 60 * 60_000);

// ── Constants ──────────────────────────────────────────────────────────────────
const LOGO_ISSUE_TITLE_PREFIX = "[Logo]";
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp"]);
const MAX_SUBMITTER_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 200;

// GitHub Contents API — upload path inside the repo
const UPLOAD_DIR = "website/public/logos";

// ── Helpers ────────────────────────────────────────────────────────────────────
function ghHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

/** Keep only URL-safe characters, truncate to 80 chars. */
function sanitizeFilename(original: string): string {
  const ext = getFileExtension(original);
  const base = original
    .slice(0, original.length - ext.length)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80 - ext.length);
  return base + ext;
}

/** Convert Uint8Array → base64 string without spread (avoids stack overflow). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

/**
 * Upload a file to the GitHub repo via Contents API.
 * Returns the raw URL of the uploaded file, or throws on failure.
 */
async function uploadFileToRepo(params: {
  path: string; // repo-relative path, e.g. "website/public/logos/foo.png"
  base64Content: string;
  commitMessage: string;
}): Promise<{ downloadUrl: string; htmlUrl: string }> {
  const { path, base64Content, commitMessage } = params;

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;

  // Check if file already exists (to get its SHA for update)
  let sha: string | undefined;
  try {
    const checkRes = await fetch(url, { headers: ghHeaders() });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      sha = existing.sha;
    }
  } catch {
    // ignore — file doesn't exist, that's fine
  }

  const body: Record<string, string> = {
    message: commitMessage,
    content: base64Content,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub Contents API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    downloadUrl: data.content?.download_url ?? "",
    htmlUrl: data.content?.html_url ?? "",
  };
}

/** Build GitHub Issue body — only metadata + image URL, no base64. */
function buildIssueBody(params: {
  filename: string;
  mimeType: string;
  repoPath: string;
  imageUrl: string;
  submitterName: string;
  description: string;
  uploadedAt: string;
}): string {
  const {
    filename,
    mimeType,
    repoPath,
    imageUrl,
    submitterName,
    description,
    uploadedAt,
  } = params;

  const metaJson = JSON.stringify(
    {
      filename,
      mimeType,
      repoPath,
      imageUrl,
      submitterName,
      description,
      uploadedAt,
    },
    null,
    2,
  );

  return [
    "### Logo Submission",
    "",
    `**Submitter:** ${submitterName || "Anonymous"}`,
    `**Description:** ${description || "(none)"}`,
    `**Uploaded At:** ${uploadedAt}`,
    `**File:** [${filename}](${imageUrl})`,
    "",
    `![preview](${imageUrl})`,
    "",
    "<!-- logo-data-start -->",
    "```json",
    metaJson,
    "```",
    "<!-- logo-data-end -->",
  ].join("\n");
}

// ── POST /api/logo-submit ──────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientAddress || "unknown";

  if (!GITHUB_TOKEN) {
    return json({ error: "Server misconfigured" }, 500);
  }

  if (isSubmitRateLimited(ip)) {
    return json(
      {
        error:
          "Too many submissions. You can submit at most 3 logos per 24 hours.",
      },
      429,
    );
  }

  // Must be multipart/form-data
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "Expected multipart/form-data" }, 415);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Failed to parse form data" }, 400);
  }

  // ── Validate file ──────────────────────────────────────────────────────────
  const fileEntry = formData.get("file");
  if (!fileEntry || !(fileEntry instanceof File)) {
    return json({ error: "Missing required field: file" }, 400);
  }

  const file = fileEntry as File;

  if (file.size === 0) {
    return json({ error: "File is empty." }, 400);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return json(
      { error: "File too large. Maximum allowed size is 2 MB." },
      413,
    );
  }

  const reportedMime = file.type;
  if (!ALLOWED_MIME_TYPES.has(reportedMime)) {
    return json(
      {
        error: `Unsupported file type "${reportedMime}". Allowed: png, jpg, jpeg, svg, webp.`,
      },
      400,
    );
  }

  const ext = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return json(
      {
        error: `Unsupported file extension "${ext}". Allowed: .png, .jpg, .jpeg, .svg, .webp.`,
      },
      400,
    );
  }

  // ── Validate optional text fields ─────────────────────────────────────────
  const rawSubmitterName =
    (formData.get("submitterName") as string | null) ?? "";
  const rawDescription = (formData.get("description") as string | null) ?? "";

  const submitterName = rawSubmitterName
    .trim()
    .slice(0, MAX_SUBMITTER_NAME_LENGTH);
  const description = rawDescription.trim().slice(0, MAX_DESCRIPTION_LENGTH);

  // ── Convert file to base64 ─────────────────────────────────────────────────
  let base64: string;
  try {
    const arrayBuffer = await file.arrayBuffer();
    base64 = uint8ToBase64(new Uint8Array(arrayBuffer));
  } catch (err) {
    console.error("[logo-submit] base64 conversion failed:", err);
    return json({ error: "Failed to process uploaded file." }, 500);
  }

  // ── Upload image to repo via GitHub Contents API ───────────────────────────
  const uploadedAt = new Date().toISOString();
  // Use timestamp prefix to avoid collisions
  const timestamp = Date.now();
  const safeFilename = sanitizeFilename(file.name);
  const repoFilename = `${timestamp}_${safeFilename}`;
  const repoPath = `${UPLOAD_DIR}/${repoFilename}`;

  let imageUrl: string;
  try {
    const uploaded = await uploadFileToRepo({
      path: repoPath,
      base64Content: base64,
      commitMessage: `feat: add community logo ${repoFilename}`,
    });
    // Prefer raw download URL; fall back to html URL
    imageUrl = uploaded.downloadUrl || uploaded.htmlUrl;
  } catch (err) {
    console.error("[logo-submit] Failed to upload image to repo:", err);
    return json(
      { error: "Failed to upload image. Please try again later." },
      502,
    );
  }

  // ── Create GitHub Issue (metadata only, no base64) ─────────────────────────
  const issueBody = buildIssueBody({
    filename: repoFilename,
    mimeType: reportedMime,
    repoPath,
    imageUrl,
    submitterName: submitterName || "Anonymous",
    description,
    uploadedAt,
  });

  const issueTitle = `${LOGO_ISSUE_TITLE_PREFIX} ${repoFilename} — ${submitterName || "Anonymous"}`;

  try {
    const createRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues`,
      {
        method: "POST",
        headers: ghHeaders(),
        body: JSON.stringify({ title: issueTitle, body: issueBody }),
      },
    );

    if (!createRes.ok) {
      const text = await createRes.text();
      console.error(
        `[logo-submit] Failed to create GitHub issue: ${createRes.status}`,
        text,
      );
      return json(
        { error: "Failed to submit logo. Please try again later." },
        502,
      );
    }

    const created = await createRes.json();
    return json(
      {
        success: true,
        logoId: created.number,
        imageUrl,
        message: "Logo submitted successfully!",
      },
      201,
    );
  } catch (err) {
    console.error("[logo-submit] Unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
};

// ── Tiny helper ───────────────────────────────────────────────────────────────
function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
