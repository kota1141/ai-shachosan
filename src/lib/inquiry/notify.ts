// 運営者への通知メール。宛先・差出人はサーバー側の設定で固定し、
// ブラウザーから指定できる値はReply-To（検証済みのメール）だけ。
// 送信にはCloudflare Email Routingの send_email バインディングを使う。

import { INQUIRY_SUBJECT, INQUIRY_TYPE_LABEL, isInquiryType } from "../../config/inquiry";
import type { InquiryConfig, InquiryEnv } from "./env";
import { getInquiry, setNotifyResult, type InquiryRow } from "./store";

const PLACEMENT_LABEL: Record<string, string> = {
	header: "ヘッダー",
	article_end: "記事末",
	home: "トップページ",
	services: "支援内容ページ",
	footer: "フッター",
	contact: "お問い合わせページ",
	direct: "直接・その他",
};

function formatJst(iso: string): string {
	const d = new Date(Date.parse(iso) + 9 * 3600_000);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}（日本時間）`;
}

export function buildNotificationText(row: InquiryRow, siteUrl: string): { subject: string; text: string } {
	const type = isInquiryType(row.inquiry_type) ? row.inquiry_type : "question";
	const lines = [
		`用件：${INQUIRY_TYPE_LABEL[type]}`,
		`受付番号：${row.id}`,
		`受付日時：${formatJst(row.created_at)}`,
		`個別返信の希望：${row.wants_reply ? "あり" : "なし"}`,
		`返信先メール：${row.email ?? "（なし）"}`,
		`お名前：${row.name ?? "（未入力）"}`,
		`薬局名：${row.pharmacy ?? "（未入力）"}`,
		`ホームページ（入力値・未確認）：${row.url ?? "（未入力）"}`,
		`対象記事：${
			row.source_article
				? `${row.source_article_title ?? row.source_article}  ${siteUrl}/posts/${row.source_article}`
				: "（なし）"
		}`,
		`設置位置：${PLACEMENT_LABEL[row.placement] ?? row.placement}`,
		"",
		"―――― 質問・相談内容 ――――",
		row.body,
		"――――――――――――――――",
		"",
		row.wants_reply
			? "このメールに返信すると、上の返信先メールあてに届きます。"
			: "個別返信の希望はありません（記事づくりの参考として受け付けました）。",
		`受付一覧（ログインが必要）：${siteUrl}/inquiries`,
	];
	return { subject: INQUIRY_SUBJECT[type], text: lines.join("\n") };
}

// ---- MIME（UTF-8・base64）を組み立てる ----

function b64utf8(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}
function encodeWord(s: string): string {
	return `=?UTF-8?B?${b64utf8(s)}?=`;
}
function wrap76(s: string): string {
	return s.replace(/.{1,76}/g, "$&\r\n");
}
const SAFE_ADDR = /^[^\s<>"\r\n,;]+@[^\s<>"\r\n,;]+$/;

export function buildMime(opts: {
	from: string;
	fromName: string;
	to: string;
	replyTo: string | null;
	subject: string;
	text: string;
	messageId: string;
}): string {
	for (const a of [opts.from, opts.to, opts.replyTo].filter(Boolean) as string[]) {
		if (!SAFE_ADDR.test(a)) throw new Error("invalid_address");
	}
	const headers = [
		`From: ${encodeWord(opts.fromName)} <${opts.from}>`,
		`To: <${opts.to}>`,
		...(opts.replyTo ? [`Reply-To: <${opts.replyTo}>`] : []),
		`Subject: ${encodeWord(opts.subject)}`,
		`Message-ID: <${opts.messageId}>`,
		`Date: ${new Date().toUTCString()}`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
	];
	return `${headers.join("\r\n")}\r\n\r\n${wrap76(b64utf8(opts.text.replace(/\r?\n/g, "\r\n")))}`;
}

/**
 * 1件の受付について通知を送る（呼び出し側で notify_status='sending' に確保済みであること）。
 * 結果をDBへ記録する。例外は外へ出さない（受付の成否には影響させない）。
 */
export async function sendNotification(
	db: D1Database,
	env: InquiryEnv,
	config: InquiryConfig,
	id: number,
): Promise<"sent" | "failed" | "not_configured"> {
	const row = await getInquiry(db, id);
	if (!row) return "failed";

	if (config.devMock) {
		// 開発用：実際には送らない。個人情報はログへ出さない。
		console.info(`[inquiry] mock notification id=${id} type=${row.inquiry_type}`);
		await setNotifyResult(db, id, "sent", "mock");
		return "sent";
	}
	if (!env.INQUIRY_MAIL || !config.to || !config.from) {
		await setNotifyResult(db, id, "not_configured", "notify_not_configured");
		return "not_configured";
	}
	try {
		const { subject, text } = buildNotificationText(row, config.siteUrl);
		const domain = config.from.split("@")[1] ?? "ai-shachosan.com";
		const raw = buildMime({
			from: config.from,
			fromName: config.fromName,
			to: config.to,
			replyTo: row.wants_reply ? row.email : null,
			subject,
			text,
			// 受付ごとに固定のIDにして、再試行でもメールソフトで重複と分かるようにする
			messageId: `inquiry-${row.id}-${row.submission_key.slice(0, 8)}@${domain}`,
		});
		const { EmailMessage } = await import("cloudflare:email");
		await env.INQUIRY_MAIL.send(new EmailMessage(config.from, config.to, raw));
		await setNotifyResult(db, id, "sent", null);
		return "sent";
	} catch (e) {
		const code = e instanceof Error && e.message === "invalid_address" ? "notify_invalid_address" : "notify_send_failed";
		console.warn(`[inquiry] notification failed id=${id} code=${code}`);
		await setNotifyResult(db, id, "failed", code);
		return "failed";
	}
}
