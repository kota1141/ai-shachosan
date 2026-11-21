// Cloudflare Turnstileのサーバー側検証。
// 秘密鍵がない・検証APIに届かない・結果が不一致の場合は、すべて通過させない。

export const TURNSTILE_ACTION = "contact";
const MOCK_PASS_TOKEN = "mock-pass";

export type TurnstileResult =
	| { ok: true }
	| { ok: false; code: "turnstile_missing" | "turnstile_failed" | "turnstile_unavailable" | "turnstile_mismatch" };

export async function verifyTurnstile(opts: {
	token: string;
	secret: string | undefined;
	remoteIp: string | null;
	hosts: string[];
	devMock: boolean;
}): Promise<TurnstileResult> {
	if (!opts.token) return { ok: false, code: "turnstile_missing" };
	if (opts.devMock) {
		// 開発用モック：決まったトークンだけ通す（本番では devMock は常に false）
		return opts.token === MOCK_PASS_TOKEN ? { ok: true } : { ok: false, code: "turnstile_failed" };
	}
	const secret = (opts.secret ?? "").trim();
	if (!secret) return { ok: false, code: "turnstile_unavailable" };

	const form = new FormData();
	form.append("secret", secret);
	form.append("response", opts.token);
	if (opts.remoteIp) form.append("remoteip", opts.remoteIp);

	let data: { success?: boolean; hostname?: string; action?: string };
	try {
		const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
			method: "POST",
			body: form,
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) return { ok: false, code: "turnstile_unavailable" };
		data = await res.json();
	} catch {
		return { ok: false, code: "turnstile_unavailable" };
	}
	if (data.success !== true) return { ok: false, code: "turnstile_failed" };
	if (data.action !== TURNSTILE_ACTION) return { ok: false, code: "turnstile_mismatch" };
	if (opts.hosts.length > 0 && !opts.hosts.includes(String(data.hostname ?? "").toLowerCase())) {
		return { ok: false, code: "turnstile_mismatch" };
	}
	return { ok: true };
}
