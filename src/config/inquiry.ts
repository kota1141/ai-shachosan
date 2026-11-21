// 質問・相談フォームとGA4計測で共有する固定値。
// クライアントとサーバーの両方から読み込むため、秘密情報は置かない。

export const INQUIRY_TYPES = ["question", "consultation"] as const;
export type InquiryType = (typeof INQUIRY_TYPES)[number];

export const INQUIRY_TYPE_LABEL: Record<InquiryType, string> = {
	question: "記事への質問・記事リクエスト",
	consultation: "自分の薬局のMEO・ホームページについて相談",
};

/** 通知メールの件名（固定形式） */
export const INQUIRY_SUBJECT: Record<InquiryType, string> = {
	question: "薬局MEOの教室｜記事への質問",
	consultation: "薬局MEOの教室｜自局の相談",
};

/** 入口（設置位置）。GA4のplacementと受付記録で共通。 */
export const PLACEMENTS = [
	"header",
	"article_end",
	"home",
	"services",
	"footer",
	"contact",
	"direct",
] as const;
export type Placement = (typeof PLACEMENTS)[number];

export const PAGE_TYPES = [
	"home",
	"article",
	"article_list",
	"services",
	"contact",
	"about",
	"privacy",
	"other",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const FORM_ID = "contact_main";

/** この実装の運用上の上限（法定値ではない） */
export const LIMITS = {
	body: 2000,
	email: 254,
	name: 100,
	pharmacy: 150,
	url: 2048,
	/** リクエスト全体（バイト） */
	requestBytes: 32_768,
} as const;

/** 記事slugとして受け付ける形（公開記事との照合は別に行う） */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function isInquiryType(v: unknown): v is InquiryType {
	return typeof v === "string" && (INQUIRY_TYPES as readonly string[]).includes(v);
}
export function isPlacement(v: unknown): v is Placement {
	return typeof v === "string" && (PLACEMENTS as readonly string[]).includes(v);
}
