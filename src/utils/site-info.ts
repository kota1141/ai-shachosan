// Operator and contact details, kept in one place so pages never invent them.
// Leave a contact value empty until the real address is confirmed: pages then
// show "準備中" instead of a link.

export const OPERATOR = {
	name: "川村鴻太",
	role: "TAiWĀ代表／薬剤師",
	display: "川村鴻太｜TAiWĀ代表／薬剤師",
} as const;

export const CONTACT = {
	/** LINE公式アカウントの友だち追加URL（例: https://lin.ee/xxxx）。未確定なら空。 */
	lineUrl: "",
	/** 相談受付用のメールアドレス。未確定なら空。 */
	email: "",
} as const;

export const hasContact = Boolean(CONTACT.lineUrl || CONTACT.email);
