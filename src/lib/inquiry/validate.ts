// 受付APIの入力検証（画面を経由しない送信にも同じ規則を適用する）。
// エラーは固定コードだけを返し、入力値そのものはログやレスポンスに含めない。

import {
	FORM_ID,
	LIMITS,
	SLUG_PATTERN,
	isInquiryType,
	isPlacement,
	type InquiryType,
	type Placement,
} from "../../config/inquiry";

export type FieldError =
	| "type_required"
	| "body_required"
	| "body_too_long"
	| "email_required"
	| "email_invalid"
	| "name_too_long"
	| "pharmacy_too_long"
	| "url_invalid"
	| "url_too_long";

export interface CleanInquiry {
	type: InquiryType;
	body: string;
	wantsReply: boolean;
	/** wantsReply=false のときは必ず null（送られてきても使わない） */
	email: string | null;
	name: string | null;
	pharmacy: string | null;
	url: string | null;
	/** 形だけ確認したslug。公開記事との照合は呼び出し側で行う */
	sourceArticle: string | null;
	placement: Placement;
	submissionKey: string;
	turnstileToken: string;
}

export type ValidationResult =
	| { ok: true; value: CleanInquiry }
	| { ok: false; errors: Partial<Record<string, FieldError>>; fatal?: "bad_request" };

// 1行の制御文字・改行を含まない、ごく一般的な形だけを受け付ける。
// （Reply-Toヘッダーに使うため、厳しめに判定する）
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** NULや制御文字（改行・タブ以外）を除き、改行をLFにそろえる */
function cleanMultiline(v: unknown): string {
	if (typeof v !== "string") return "";
	return v
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
		.trim();
}
/** 1行の項目：改行や制御文字は空白にする */
function cleanLine(v: unknown): string {
	if (typeof v !== "string") return "";
	return v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}
/** 文字数はコードポイント単位で数える（絵文字1つを2文字と数えない） */
export function charLength(s: string): number {
	return [...s].length;
}

export function validateInquiry(input: unknown): ValidationResult {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return { ok: false, errors: {}, fatal: "bad_request" };
	}
	const raw = input as Record<string, unknown>;
	const errors: Partial<Record<string, FieldError>> = {};

	if (raw.form_id !== FORM_ID) return { ok: false, errors: {}, fatal: "bad_request" };
	const submissionKey = typeof raw.submission_key === "string" ? raw.submission_key : "";
	if (!UUID_PATTERN.test(submissionKey)) return { ok: false, errors: {}, fatal: "bad_request" };

	const type = raw.type;
	if (!isInquiryType(type)) errors.type = "type_required";

	const body = cleanMultiline(raw.body);
	if (!body) errors.body = "body_required";
	else if (charLength(body) > LIMITS.body) errors.body = "body_too_long";

	// consultation は常に個別返信あり。question は申告どおり（既定は返信なし）。
	const wantsReply = type === "consultation" ? true : raw.wants_reply === true;

	let email: string | null = null;
	if (wantsReply) {
		const e = cleanLine(raw.email);
		if (!e) errors.email = "email_required";
		else if (e.length > LIMITS.email || !EMAIL_PATTERN.test(e)) errors.email = "email_invalid";
		else email = e;
	}

	const name = cleanLine(raw.name) || null;
	if (name && charLength(name) > LIMITS.name) errors.name = "name_too_long";

	const pharmacy = cleanLine(raw.pharmacy) || null;
	if (pharmacy && charLength(pharmacy) > LIMITS.pharmacy) errors.pharmacy = "pharmacy_too_long";

	let url: string | null = null;
	const rawUrl = cleanLine(raw.url);
	if (rawUrl) {
		if (rawUrl.length > LIMITS.url) errors.url = "url_too_long";
		else {
			try {
				const u = new URL(rawUrl);
				if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".")) {
					url = u.toString();
				} else errors.url = "url_invalid";
			} catch {
				errors.url = "url_invalid";
			}
		}
	}

	const sa = typeof raw.source_article === "string" ? raw.source_article : "";
	const sourceArticle = SLUG_PATTERN.test(sa) ? sa : null;
	const placement: Placement = isPlacement(raw.placement) ? raw.placement : "direct";

	const turnstileToken = typeof raw.turnstile_token === "string" ? raw.turnstile_token : "";
	if (turnstileToken.length > 4096) return { ok: false, errors: {}, fatal: "bad_request" };

	if (Object.keys(errors).length > 0 || !isInquiryType(type)) return { ok: false, errors };

	return {
		ok: true,
		value: {
			type,
			body,
			wantsReply,
			email,
			name,
			pharmacy,
			url,
			sourceArticle,
			placement,
			submissionKey: submissionKey.toLowerCase(),
			turnstileToken,
		},
	};
}
