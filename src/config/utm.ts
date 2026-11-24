// SNSなどで発行するUTMの採用ルール。
// - utm_source / utm_medium：下の許可リストにある値だけ採用する（媒体名の表記ゆれを防ぐ）。
// - utm_campaign / utm_content / utm_term：登録は不要。UTM_CODE_PATTERN に合う値だけ採用する
//   （英小文字・数字・「_」「-」で50文字以内。氏名・メールなどが紛れ込んでも送らないため）。
// 手順は docs/contact-ga4.md の「UTMの運用」を参照。

export const UTM_ALLOWLIST = {
	/** utm_source：媒体名。表記を統一する。新しい媒体を使うときはここに追加 */
	sources: ["x", "threads", "instagram", "note", "substack"],
	/** utm_medium：SNS=social、noteなどからの記事紹介=referral、定期メール=email */
	mediums: ["social", "referral", "email"],
} as const;

/** utm_campaign / utm_content / utm_term として採用する値の形 */
export const UTM_CODE_PATTERN = /^[a-z0-9_-]{1,50}$/;

export type UtmAllowlist = {
	sources: readonly string[];
	mediums: readonly string[];
};
