import handler, {
	createScheduledHandler,
	EmDashRoom,
	EmDashRoomSite,
	PluginBridge,
} from "@emdash-cms/cloudflare/worker";

import { readInquiryConfig, type InquiryEnv } from "./lib/inquiry/env";
import { sendNotification } from "./lib/inquiry/notify";
import { claimForRetry, ensureSchema, pruneRateLimit } from "./lib/inquiry/store";

export { EmDashRoom, EmDashRoomSite, PluginBridge };

const emdashScheduled = createScheduledHandler();

/** www付きで来たアクセスは、本来のアドレス（www なし）へ恒久的に転送する */
const CANONICAL_HOST = "ai-shachosan.com";
const WWW_HOST = `www.${CANONICAL_HOST}`;

/** 受付済みで通知が済んでいない問い合わせを、毎分の定期処理で少しずつ再送する */
async function retryInquiryNotifications(env: InquiryEnv) {
	if (!env.DB) return;
	const config = readInquiryConfig(env, false);
	try {
		await ensureSchema(env.DB);
		if (config.notifyReady) {
			for (let i = 0; i < 5; i++) {
				const id = await claimForRetry(env.DB);
				if (id === null) break;
				await sendNotification(env.DB, env, config, id);
			}
		}
		// 古い回数制限の記録を整理（1時間に1回程度）
		if (new Date().getUTCMinutes() === 7) await pruneRateLimit(env.DB);
	} catch (e) {
		console.error(`[inquiry] retry failed code=${e instanceof Error ? e.name : "unknown"}`);
	}
}

export default {
	...handler,
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.hostname === WWW_HOST) {
			url.hostname = CANONICAL_HOST;
			url.protocol = "https:";
			url.port = "";
			return Response.redirect(url.toString(), 301);
		}
		return handler.fetch!(request, env, ctx);
	},
	async scheduled(controller, env, ctx) {
		ctx.waitUntil(retryInquiryNotifications(env as InquiryEnv));
		return emdashScheduled(controller, env, ctx);
	},
} satisfies ExportedHandler<Record<string, unknown>>;
