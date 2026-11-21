// 受付記録の保存先（既存D1の専用テーブル）。EmDashのテーブルには触れない。
// 受付の成立点は meo_inquiries への INSERT 成功。通知は別の状態として管理する。

import type { CleanInquiry } from "./validate";

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS meo_inquiries (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		submission_key TEXT NOT NULL UNIQUE,
		created_at TEXT NOT NULL,
		inquiry_type TEXT NOT NULL,
		body TEXT NOT NULL,
		wants_reply INTEGER NOT NULL,
		email TEXT,
		name TEXT,
		pharmacy TEXT,
		url TEXT,
		source_article TEXT,
		source_article_title TEXT,
		placement TEXT NOT NULL,
		notify_status TEXT NOT NULL DEFAULT 'pending',
		notify_attempts INTEGER NOT NULL DEFAULT 0,
		notify_error TEXT,
		notify_claimed_at TEXT,
		notified_at TEXT
	)`,
	`CREATE INDEX IF NOT EXISTS meo_inquiries_notify ON meo_inquiries (notify_status, notify_claimed_at)`,
	`CREATE TABLE IF NOT EXISTS meo_inquiry_rate (
		bucket TEXT NOT NULL,
		window_start INTEGER NOT NULL,
		count INTEGER NOT NULL,
		PRIMARY KEY (bucket, window_start)
	)`,
];

let schemaReady: Promise<void> | null = null;
export function ensureSchema(db: D1Database): Promise<void> {
	if (!schemaReady) {
		schemaReady = db
			.batch(SCHEMA.map((sql) => db.prepare(sql)))
			.then(() => undefined)
			.catch((e) => {
				schemaReady = null;
				throw e;
			});
	}
	return schemaReady;
}

export type NotifyStatus = "pending" | "sending" | "sent" | "failed" | "not_configured";

export interface InquiryRow {
	id: number;
	submission_key: string;
	created_at: string;
	inquiry_type: string;
	body: string;
	wants_reply: number;
	email: string | null;
	name: string | null;
	pharmacy: string | null;
	url: string | null;
	source_article: string | null;
	source_article_title: string | null;
	placement: string;
	notify_status: NotifyStatus;
	notify_attempts: number;
	notify_error: string | null;
	notify_claimed_at: string | null;
	notified_at: string | null;
}

export async function findBySubmissionKey(db: D1Database, key: string) {
	return db
		.prepare("SELECT id, inquiry_type FROM meo_inquiries WHERE submission_key = ?")
		.bind(key)
		.first<{ id: number; inquiry_type: string }>();
}

/**
 * 受付記録を保存する。同じ submission_key は1件だけ（再試行・連打で増やさない）。
 * 通知はこの時点で「送信中」として確保し、cronと二重に送らないようにする。
 */
export async function insertInquiry(
	db: D1Database,
	v: CleanInquiry,
	articleTitle: string | null,
): Promise<{ id: number; duplicate: boolean }> {
	const now = new Date().toISOString();
	const res = await db
		.prepare(
			`INSERT INTO meo_inquiries
			(submission_key, created_at, inquiry_type, body, wants_reply, email, name, pharmacy, url,
			 source_article, source_article_title, placement, notify_status, notify_claimed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', ?)
			ON CONFLICT(submission_key) DO NOTHING
			RETURNING id`,
		)
		.bind(
			v.submissionKey,
			now,
			v.type,
			v.body,
			v.wantsReply ? 1 : 0,
			v.email,
			v.name,
			v.pharmacy,
			v.url,
			v.sourceArticle,
			articleTitle,
			v.placement,
			now,
		)
		.first<{ id: number }>();
	if (res?.id) return { id: res.id, duplicate: false };
	const existing = await findBySubmissionKey(db, v.submissionKey);
	if (!existing) throw new Error("insert_failed");
	return { id: existing.id, duplicate: true };
}

export async function getInquiry(db: D1Database, id: number) {
	return db.prepare("SELECT * FROM meo_inquiries WHERE id = ?").bind(id).first<InquiryRow>();
}

export async function setNotifyResult(
	db: D1Database,
	id: number,
	status: Exclude<NotifyStatus, "sending" | "pending">,
	errorCode: string | null,
) {
	const now = new Date().toISOString();
	await db
		.prepare(
			`UPDATE meo_inquiries
			 SET notify_status = ?, notify_error = ?, notify_attempts = notify_attempts + 1,
			     notified_at = CASE WHEN ? = 'sent' THEN ? ELSE notified_at END
			 WHERE id = ?`,
		)
		.bind(status, errorCode, status, now, id)
		.run();
}

/**
 * cron用：通知が済んでいない受付を1件ずつ確保する。
 * 送信中のまま5分以上たったもの（処理が途中で止まったもの）も対象にする。
 */
export async function claimForRetry(db: D1Database, maxAttempts = 6): Promise<number | null> {
	const now = new Date();
	const stale = new Date(now.getTime() - 5 * 60_000).toISOString();
	// 失敗回数に応じて間隔をあける（1, 2, 4, 8, 16分…）
	const candidates = await db
		.prepare(
			`SELECT id, notify_attempts, notify_status, notify_claimed_at, created_at FROM meo_inquiries
			 WHERE notify_attempts < ?
			   AND (notify_status IN ('pending','failed','not_configured')
			        OR (notify_status = 'sending' AND notify_claimed_at < ?))
			 ORDER BY id LIMIT 10`,
		)
		.bind(maxAttempts, stale)
		.all<{ id: number; notify_attempts: number; notify_status: string; notify_claimed_at: string | null; created_at: string }>();
	for (const c of candidates.results ?? []) {
		const last = c.notify_claimed_at ?? c.created_at;
		const waitMs = Math.min(2 ** c.notify_attempts, 60) * 60_000;
		if (c.notify_status !== "sending" && now.getTime() - Date.parse(last) < waitMs && c.notify_attempts > 0) continue;
		const claimed = await db
			.prepare(
				`UPDATE meo_inquiries SET notify_status = 'sending', notify_claimed_at = ?
				 WHERE id = ? AND notify_status = ?`,
			)
			.bind(now.toISOString(), c.id, c.notify_status)
			.run();
		if (claimed.meta.changes === 1) return c.id;
	}
	return null;
}

export async function listInquiries(db: D1Database, limit = 100) {
	const r = await db
		.prepare("SELECT * FROM meo_inquiries ORDER BY id DESC LIMIT ?")
		.bind(limit)
		.all<InquiryRow>();
	return r.results ?? [];
}

export async function deleteInquiry(db: D1Database, id: number) {
	await db.prepare("DELETE FROM meo_inquiries WHERE id = ?").bind(id).run();
}

export async function requeueInquiry(db: D1Database, id: number) {
	await db
		.prepare(
			`UPDATE meo_inquiries SET notify_status = 'pending', notify_attempts = 0, notify_claimed_at = NULL
			 WHERE id = ? AND notify_status != 'sent' AND notify_status != 'sending'`,
		)
		.bind(id)
		.run();
}

/**
 * 回数制限。D1は全インスタンスで共有されるため、サイト全体の上限にも使える。
 * 窓を超えたらfalse。カウンターは窓ごとの行で、古い行はcronで削除する。
 */
export async function hitRateLimit(
	db: D1Database,
	bucket: string,
	windowSeconds: number,
	limit: number,
): Promise<boolean> {
	const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
	const row = await db
		.prepare(
			`INSERT INTO meo_inquiry_rate (bucket, window_start, count) VALUES (?, ?, 1)
			 ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
			 RETURNING count`,
		)
		.bind(bucket, windowStart)
		.first<{ count: number }>();
	return (row?.count ?? 0) <= limit;
}

export async function pruneRateLimit(db: D1Database) {
	const cutoff = Math.floor(Date.now() / 1000) - 2 * 86_400;
	await db.prepare("DELETE FROM meo_inquiry_rate WHERE window_start < ?").bind(cutoff).run();
}
