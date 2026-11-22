// 受付・通知・計測の設定を環境変数から読み取る。
// 秘密値（TURNSTILE_SECRET_KEY / INQUIRY_HASH_SALT）は wrangler secret で設定し、
// ここでは「設定済みかどうか」以外をクライアントへ渡さない。

export interface InquiryEnv {
	DB?: D1Database;
	INQUIRY_MAIL?: { send(message: unknown): Promise<unknown> };
	INQUIRY_TO?: string;
	INQUIRY_FROM?: string;
	INQUIRY_FROM_NAME?: string;
	INQUIRY_REQUIRE_NOTIFY?: string;
	INQUIRY_LIMIT_PER_IP_HOUR?: string;
	INQUIRY_LIMIT_GLOBAL_HOUR?: string;
	INQUIRY_LIMIT_GLOBAL_DAY?: string;
	INQUIRY_HASH_SALT?: string;
	TURNSTILE_SITE_KEY?: string;
	TURNSTILE_SECRET_KEY?: string;
	/** Turnstileのhostname検証に使う、受け付けるホスト名（カンマ区切り） */
	SITE_HOSTS?: string;
	/** 開発時だけ有効。"mock" でTurnstileと通知をモックにする */
	INQUIRY_DEV_MODE?: string;
	SITE_URL?: string;
}

function intOr(v: string | undefined, fallback: number): number {
	const n = Number.parseInt(String(v ?? ""), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface InquiryConfig {
	/** 開発サーバー上で、明示的にモックを指定した場合だけ true */
	devMock: boolean;
	turnstileSiteKey: string | null;
	turnstileReady: boolean;
	notifyReady: boolean;
	requireNotify: boolean;
	/** フォームを表示して受け付けてよいか */
	formReady: boolean;
	to: string | null;
	from: string | null;
	fromName: string;
	hosts: string[];
	limits: { perIpHour: number; globalHour: number; globalDay: number };
	siteUrl: string;
}

export function readInquiryConfig(env: InquiryEnv, isDev: boolean): InquiryConfig {
	const devMock = isDev && env.INQUIRY_DEV_MODE === "mock";
	const siteKey = (env.TURNSTILE_SITE_KEY ?? "").trim() || null;
	const turnstileReady = devMock || (!!siteKey && !!(env.TURNSTILE_SECRET_KEY ?? "").trim());
	const to = (env.INQUIRY_TO ?? "").trim() || null;
	const from = (env.INQUIRY_FROM ?? "").trim() || null;
	const notifyReady = devMock || (!!env.INQUIRY_MAIL && !!to && !!from);
	const requireNotify = env.INQUIRY_REQUIRE_NOTIFY !== "false";
	const hosts = String(env.SITE_HOSTS ?? "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean);
	return {
		devMock,
		turnstileSiteKey: devMock ? "mock" : siteKey,
		turnstileReady,
		notifyReady,
		requireNotify,
		formReady: !!env.DB && turnstileReady && (notifyReady || !requireNotify),
		to,
		from,
		fromName: (env.INQUIRY_FROM_NAME ?? "").trim() || "薬局MEOの教室 受付フォーム",
		hosts,
		limits: {
			perIpHour: intOr(env.INQUIRY_LIMIT_PER_IP_HOUR, 5),
			globalHour: intOr(env.INQUIRY_LIMIT_GLOBAL_HOUR, 30),
			globalDay: intOr(env.INQUIRY_LIMIT_GLOBAL_DAY, 100),
		},
		siteUrl: (env.SITE_URL ?? "").trim().replace(/\/$/, "") || "https://ai-shachosan.com",
	};
}
