// Operator and contact details, defined once and referenced by the contact
// page, footer, about page and privacy policy. Do not fill a value here unless
// the operator has confirmed it.

export const OPERATOR = {
	name: "川村鴻太",
	role: "TAiWĀ代表／薬剤師",
	display: "川村鴻太｜TAiWĀ代表／薬剤師",
} as const;

export const CONTACT_EMAIL = "taiwa.kawamura@gmail.com";

export const CONTACT_SUBJECT = "【薬局MEOの教室】MEOの相談";
export const CONTACT_BODY = "ご相談内容：\r\n\r\n薬局名（任意）：\r\nお名前（任意）：\r\n";

// encodeURIComponent keeps the Japanese subject/body valid UTF-8 in mailto:.
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
	CONTACT_SUBJECT,
)}&body=${encodeURIComponent(CONTACT_BODY)}`;

/** Policy dates. Set when the operator approves the published text. */
export const PRIVACY_POLICY = {
	established: "2026年11月19日",
	updated: "2026年11月21日",
} as const;
