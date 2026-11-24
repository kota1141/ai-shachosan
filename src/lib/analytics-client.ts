// GA4（Googleタグ）の読み込みと計測。ブラウザーでだけ使う。
//
// 方針
// - 閲覧者が「許可する」を選ぶまで、Googleタグを読み込まず、何も送らない（基本の同意方式）。
// - page_view は自動計測を止め（send_page_view:false）、表示ごとに1回だけ手動で送る。
// - page_location は「既知のorigin＋path」だけ。クエリ・フラグメントは送らない。
// - 参照元：外部はoriginまで、サイト内は既知の形のパスだけ。
// - UTMは campaign_* に対応させる。source/medium は許可リストの値だけ、
//   campaign/content/term は決まった形（英小文字・数字・_ -、50文字以内）の値だけ採用する。
// - イベントとパラメータは許可リストで絞る。氏名・メール・本文などは扱わない。

import { FORM_ID, PAGE_TYPES, SLUG_PATTERN, isInquiryType, isPlacement } from "../config/inquiry";
import { UTM_ALLOWLIST, UTM_CODE_PATTERN, type UtmAllowlist } from "../config/utm";

export interface AnalyticsConfig {
	measurementId: string;
	pagePath: string;
	pageTitle: string;
	pageType: string;
	articleSlug: string | null;
}

const CONSENT_KEY = "meo-analytics-consent";
/**
 * 同じドメインの別サイト（pharmacist-life.ai-shachosan.com など）とCookieを共有しないよう、
 * このサイト専用の名前（meo__ga…）で、このホストだけに保存する。
 */
const COOKIE_PREFIX = "meo";
const CONSENT_VERSION = 1;
type Choice = "granted" | "denied";

const EVENTS = new Set([
	"contact_click",
	"contact_form_start",
	"question_submit",
	"generate_lead",
	"email_click",
	"email_copy",
]);

type Params = Record<string, string>;
type Gtag = (...args: unknown[]) => void;

interface State {
	cfg: AnalyticsConfig | null;
	active: boolean;
	loaded: boolean;
	pageViewSent: boolean;
	memoryChoice: Choice | null;
}
const state: State = { cfg: null, active: false, loaded: false, pageViewSent: false, memoryChoice: null };

declare global {
	interface Window {
		dataLayer?: unknown[];
		gtag?: Gtag;
		[key: `ga-disable-${string}`]: boolean | undefined;
	}
}

// ---------- 同意の保存 ----------

export function readChoice(): Choice | null {
	try {
		const raw = localStorage.getItem(CONSENT_KEY);
		if (!raw) return state.memoryChoice;
		const v = JSON.parse(raw) as { v?: number; choice?: string };
		if (v.v === CONSENT_VERSION && (v.choice === "granted" || v.choice === "denied")) return v.choice;
	} catch {
		/* localStorageが使えない環境 */
	}
	return state.memoryChoice;
}
function saveChoice(choice: Choice) {
	state.memoryChoice = choice;
	try {
		localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, choice, at: new Date().toISOString().slice(0, 10) }));
	} catch {
		/* 保存できない場合は、このページを開いている間だけ有効 */
	}
}

// ---------- URLの安全化 ----------

const KNOWN_PATHS = [
	/^\/$/,
	/^\/posts\/?$/,
	/^\/posts\/[a-z0-9][a-z0-9-]{0,99}\/?$/,
	/^\/category\/[a-z0-9][a-z0-9-]{0,99}\/?$/,
	/^\/tag\/[a-z0-9][a-z0-9-]{0,99}\/?$/,
	/^\/pages\/[a-z0-9][a-z0-9-]{0,99}\/?$/,
	/^\/(services|contact|privacy|characters|search)\/?$/,
];

export function safeReferrer(referrer: string, here: Location = location): string {
	if (!referrer) return "";
	let u: URL;
	try {
		u = new URL(referrer);
	} catch {
		return "";
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") return "";
	if (u.origin === here.origin) {
		return KNOWN_PATHS.some((re) => re.test(u.pathname)) ? `${u.origin}${u.pathname}` : `${u.origin}/`;
	}
	// 外部の参照元は origin まで（パスやクエリに含まれる情報を送らない）
	return `${u.origin}/`;
}

export function campaignFromSearch(search: string, allow: UtmAllowlist = UTM_ALLOWLIST): Params {
	const q = new URLSearchParams(search);
	const out: Params = {};
	const pick = (name: string, key: string, list?: readonly string[]) => {
		const v = (q.get(name) ?? "").trim().toLowerCase();
		if (!v) return;
		if (list ? list.includes(v) : UTM_CODE_PATTERN.test(v)) out[key] = v;
	};
	pick("utm_source", "campaign_source", allow.sources);
	pick("utm_medium", "campaign_medium", allow.mediums);
	pick("utm_campaign", "campaign_name");
	pick("utm_content", "campaign_content");
	pick("utm_term", "campaign_term");
	return out;
}

/** イベントのパラメータを許可リストで絞る */
export function sanitizeParams(params: Record<string, unknown>): Params {
	const out: Params = {};
	if (isInquiryType(params.inquiry_type)) out.inquiry_type = params.inquiry_type;
	if (isPlacement(params.placement)) out.placement = params.placement;
	const sa = params.source_article;
	if (typeof sa === "string" && (sa === "none" || SLUG_PATTERN.test(sa))) out.source_article = sa;
	if (params.form_id === FORM_ID) out.form_id = FORM_ID;
	if (typeof params.page_type === "string" && (PAGE_TYPES as readonly string[]).includes(params.page_type)) {
		out.page_type = params.page_type;
	}
	return out;
}

// ---------- Googleタグ ----------

// gtag.js は dataLayer に arguments オブジェクトが積まれる形を前提にしている
function gtag(..._args: unknown[]) {
	window.dataLayer = window.dataLayer || [];
	// biome-ignore lint/complexity/noArguments: required by gtag.js
	window.dataLayer.push(arguments);
}

function pageParams(cfg: AnalyticsConfig) {
	return {
		page_location: `${location.origin}${cfg.pagePath}`,
		page_referrer: safeReferrer(document.referrer),
		page_title: cfg.pageTitle,
	};
}

function sendPageView() {
	const cfg = state.cfg;
	if (!cfg || !state.active) return;
	gtag("event", "page_view", { ...pageParams(cfg), page_type: cfg.pageType, send_to: cfg.measurementId });
	state.pageViewSent = true;
}

function startTag() {
	const cfg = state.cfg;
	if (!cfg) return;
	window[`ga-disable-${cfg.measurementId}`] = false;
	state.active = true;
	if (state.loaded) {
		gtag("consent", "update", { analytics_storage: "granted" });
		// 再許可：このページの表示をまだ送っていなければ、現在の表示から再開する
		if (!state.pageViewSent) sendPageView();
		return;
	}
	state.loaded = true;
	window.gtag = gtag;
	gtag("consent", "default", {
		analytics_storage: "granted",
		ad_storage: "denied",
		ad_user_data: "denied",
		ad_personalization: "denied",
	});
	gtag("set", "ads_data_redaction", true);
	gtag("set", "url_passthrough", false);
	const page = pageParams(cfg);
	gtag("set", page);
	gtag("js", new Date());
	gtag("config", cfg.measurementId, {
		...page,
		...campaignFromSearch(location.search),
		send_page_view: false,
		cookie_prefix: COOKIE_PREFIX,
		cookie_domain: "none",
		allow_google_signals: false,
		allow_ad_personalization_signals: false,
	});
	sendPageView();
	const s = document.createElement("script");
	s.async = true;
	s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.measurementId)}`;
	document.head.appendChild(s);
}

function deleteGaCookies() {
	// このサイトのGA4 Cookie（meo__ga…、ホスト限定）だけを消す。別サイトのCookieには触れない
	for (const c of document.cookie.split(";")) {
		const name = c.split("=")[0]?.trim() ?? "";
		if (!name.startsWith(`${COOKIE_PREFIX}__ga`)) continue;
		document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
	}
}

function stopTag() {
	const cfg = state.cfg;
	state.active = false;
	if (!cfg) return;
	// 読み込み済みのタグからも以後は送らない（Googleの送信停止設定）
	window[`ga-disable-${cfg.measurementId}`] = true;
	if (state.loaded) gtag("consent", "update", { analytics_storage: "denied" });
	deleteGaCookies();
}

export function setChoice(choice: Choice) {
	saveChoice(choice);
	if (choice === "granted") startTag();
	else stopTag();
}

/** 許可済みで、タグが動いているときだけ送る。同意前の行動はためない。 */
export function track(name: string, params: Record<string, unknown> = {}) {
	if (!state.active || !state.cfg || !EVENTS.has(name)) return;
	gtag("event", name, { ...sanitizeParams(params), send_to: state.cfg.measurementId });
}

export function currentArticle(): string {
	return state.cfg?.articleSlug ?? "none";
}
export function currentPageType(): string {
	return state.cfg?.pageType ?? "other";
}

export function initAnalytics(cfg: AnalyticsConfig) {
	state.cfg = cfg;
	if (readChoice() === "granted") startTag();
	// 戻る・進む（ページがキャッシュから復元された場合）も1回の表示として数える
	window.addEventListener("pageshow", (e) => {
		if (e.persisted && state.active) sendPageView();
	});
}

// ---------- 入口のクリック ----------

export function placementFor(el: Element): string {
	const explicit = el.closest<HTMLElement>("[data-placement]")?.dataset.placement;
	if (isPlacement(explicit)) return explicit;
	if (el.closest(".site-header")) return "header";
	if (el.closest(".site-footer")) return "footer";
	const type = currentPageType();
	if (type === "article") return "article_end";
	if (type === "home") return "home";
	if (type === "services") return "services";
	if (type === "contact") return "contact";
	return "direct";
}

export function bindClickTracking() {
	document.addEventListener(
		"click",
		(e) => {
			const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
			if (!a) return;
			const href = a.getAttribute("href") ?? "";
			if (href.startsWith("mailto:")) {
				track("email_click", { placement: placementFor(a), source_article: currentArticle() });
				return;
			}
			let u: URL;
			try {
				u = new URL(a.href, location.href);
			} catch {
				return;
			}
			if (u.origin !== location.origin || u.pathname.replace(/\/$/, "") !== "/contact") return;
			const type = u.searchParams.get("type");
			track("contact_click", {
				placement: placementFor(a),
				source_article: currentArticle(),
				...(isInquiryType(type) ? { inquiry_type: type } : {}),
			});
		},
		{ capture: true },
	);
}

