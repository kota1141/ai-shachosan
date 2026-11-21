// SNSなどで発行するUTMの許可リスト。
// ここに登録した値だけをGA4のキャンペーン情報として採用します。
// 新しい企画・投稿のリンクを作るときは、下の配列に1行追加してから投稿してください。
// 手順は docs/contact-ga4.md の「UTMの運用」を参照。

export const UTM_ALLOWLIST = {
	/** utm_source：媒体名。表記を統一する */
	sources: ["x", "threads", "instagram", "note", "substack"],
	/** utm_medium：SNS=social、noteなどからの記事紹介=referral、定期メール=email */
	mediums: ["social", "referral", "email"],
	/** utm_campaign：企画単位（例：launch_202611） */
	campaigns: ["launch_202611"],
	/** utm_content：投稿単位（例：checklist_post_01） */
	contents: ["checklist_post_01"],
} as const;

export type UtmAllowlist = {
	sources: readonly string[];
	mediums: readonly string[];
	campaigns: readonly string[];
	contents: readonly string[];
};
