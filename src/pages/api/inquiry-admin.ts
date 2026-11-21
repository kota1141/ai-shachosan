// 受付一覧の操作（削除・通知の再試行）。管理者のみ。
// フォーム送信のため、Astroの同一オリジン検査に加えて Origin も確認する。

import type { APIRoute } from "astro";
import { env as rawEnv } from "cloudflare:workers";

import type { InquiryEnv } from "../../lib/inquiry/env";
import { deleteInquiry, ensureSchema, requeueInquiry } from "../../lib/inquiry/store";

export const prerender = false;
const ADMIN_LEVEL = 50;

export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
	const user = locals.user;
	if (!user || (user.role ?? 0) < ADMIN_LEVEL) return new Response("Not found", { status: 404 });
	if (request.headers.get("origin") !== url.origin) return new Response("Forbidden", { status: 403 });

	const env = rawEnv as unknown as InquiryEnv;
	if (!env.DB) return new Response("Unavailable", { status: 503 });

	const form = await request.formData();
	const id = Number.parseInt(String(form.get("id") ?? ""), 10);
	const action = String(form.get("action") ?? "");
	if (!Number.isSafeInteger(id) || id <= 0) return new Response("Bad request", { status: 400 });

	await ensureSchema(env.DB);
	if (action === "delete") {
		await deleteInquiry(env.DB, id);
		return redirect("/inquiries?done=deleted", 303);
	}
	if (action === "requeue") {
		await requeueInquiry(env.DB, id);
		return redirect("/inquiries?done=requeued", 303);
	}
	return new Response("Bad request", { status: 400 });
};
