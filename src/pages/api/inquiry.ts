// 質問・相談フォームの受付API。
// 成功応答を返すのは、入力検証・回数制限・Turnstile検証を通り、D1への保存が成功した後だけ。
// 通知メールの失敗は受付の失敗にしない（cronで再試行する）。

import type { APIRoute } from "astro";
import { env as rawEnv } from "cloudflare:workers";
import { getEmDashEntry } from "emdash";

import { LIMITS } from "../../config/inquiry";
import { readInquiryConfig, type InquiryEnv } from "../../lib/inquiry/env";
import { sendNotification } from "../../lib/inquiry/notify";
import { ensureSchema, findBySubmissionKey, hitRateLimit, insertInquiry } from "../../lib/inquiry/store";
import { verifyTurnstile } from "../../lib/inquiry/turnstile";
import { validateInquiry } from "../../lib/inquiry/validate";

export const prerender = false;

function json(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...extra,
		},
	});
}

async function hashIp(ip: string, salt: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
	return [...new Uint8Array(sig).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readLimited(request: Request, maxBytes: number): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const all = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		all.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder().decode(all);
}

export const POST: APIRoute = async ({ request, url }) => {
	const env = rawEnv as unknown as InquiryEnv;
	const config = readInquiryConfig(env, import.meta.env.DEV);

	// 同じサイトの画面からの送信だけを受け付ける
	const origin = request.headers.get("origin");
	if (!origin || origin !== url.origin) return json(403, { ok: false, error: "forbidden" });
	if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
		return json(415, { ok: false, error: "bad_request" });
	}
	if (!config.formReady || !env.DB) return json(503, { ok: false, error: "not_configured" });
	const db = env.DB;

	// リクエスト全体の上限
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > LIMITS.requestBytes) return json(413, { ok: false, error: "too_large" });
	// 申告がない・偽りの場合も、上限を超えた時点で読み込みをやめる
	let text: string;
	try {
		const read = await readLimited(request, LIMITS.requestBytes);
		if (read === null) return json(413, { ok: false, error: "too_large" });
		text = read;
	} catch {
		return json(400, { ok: false, error: "bad_request" });
	}

	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		return json(400, { ok: false, error: "bad_request" });
	}

	const result = validateInquiry(payload);
	if (!result.ok) {
		if (result.fatal) return json(400, { ok: false, error: "bad_request" });
		return json(422, { ok: false, error: "invalid", fields: result.errors });
	}
	const v = result.value;

	try {
		await ensureSchema(db);

		// 同じ送信の再試行（応答を受け取れなかった場合など）は、保存済みならそのまま成功を返す
		const existing = await findBySubmissionKey(db, v.submissionKey);
		if (existing) {
			return json(200, { ok: true, duplicate: true, inquiry_type: existing.inquiry_type });
		}

		// 回数制限①：送信元（IPのハッシュ）ごと。Turnstile検証APIへの過剰な問い合わせも防ぐ
		const ip = request.headers.get("cf-connecting-ip") ?? (config.devMock ? "127.0.0.1" : "");
		const salt = env.INQUIRY_HASH_SALT || env.TURNSTILE_SECRET_KEY || "dev-only";
		const ipKey = ip ? await hashIp(ip, salt) : "noip";
		if (!(await hitRateLimit(db, `ip:${ipKey}`, 3600, config.limits.perIpHour))) {
			return json(429, { ok: false, error: "rate_limited" }, { "retry-after": "3600" });
		}

		const ts = await verifyTurnstile({
			token: v.turnstileToken,
			secret: env.TURNSTILE_SECRET_KEY,
			remoteIp: ip || null,
			hosts: config.hosts,
			devMock: config.devMock,
		});
		if (!ts.ok) {
			const status = ts.code === "turnstile_unavailable" ? 503 : 403;
			return json(status, { ok: false, error: ts.code });
		}

		// 回数制限②：サイト全体（1時間・1日）。Turnstileを通過した送信だけを数え、
		// でたらめな送信で全体の上限を使い切られないようにする
		const globalOk =
			(await hitRateLimit(db, "global:h", 3600, config.limits.globalHour)) &&
			(await hitRateLimit(db, "global:d", 86_400, config.limits.globalDay));
		if (!globalOk) return json(429, { ok: false, error: "rate_limited" }, { "retry-after": "3600" });

		// 対象記事は公開記事と照合できたものだけを残す
		let articleTitle: string | null = null;
		if (v.sourceArticle) {
			try {
				const { entry } = await getEmDashEntry("posts", v.sourceArticle);
				const status = (entry?.data as { status?: string } | undefined)?.status;
				if (entry && (!status || status === "published")) articleTitle = String(entry.data.title ?? "");
				else v.sourceArticle = null;
			} catch {
				v.sourceArticle = null;
			}
		}

		const saved = await insertInquiry(db, v, articleTitle);
		if (!saved.duplicate) {
			// 通知の失敗は受付の失敗にしない
			await sendNotification(db, env, config, saved.id);
		}
		return json(200, { ok: true, duplicate: saved.duplicate, inquiry_type: v.type });
	} catch (e) {
		console.error(`[inquiry] accept failed stage=storage code=${e instanceof Error ? e.name : "unknown"}`);
		return json(500, { ok: false, error: "server_error" });
	}
};

export const ALL: APIRoute = () => json(405, { ok: false, error: "method_not_allowed" }, { allow: "POST" });
