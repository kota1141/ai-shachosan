import characterContent from "../../content/characters.json";

export { characterContent };

// These portraits are public assets, not EmDash media fields. Keep the existing
// Portable Text speaker values so articles already stored in the CMS still work.
const portraits: Record<string, Record<string, string>> = {
	director: {
		neutral: "/assets/characters/director-neutral.png",
		question: "/assets/characters/director-question.png",
		agree: "/assets/characters/director-agree.png",
	},
	aoba: {
		neutral: "/assets/characters/aoba-neutral.png",
		explain: "/assets/characters/aoba-explain.png",
		think: "/assets/characters/aoba-think.png",
	},
};

export function getCharacterForSpeaker(speaker: unknown) {
	const id = speaker === "question" ? "director" : "aoba";
	return characterContent.characters.find((character) => character.id === id)!;
}

// Display sizes: "small" (192px WebP) for speech bubbles shown at 48–64px,
// "large" (512px WebP) for the profile page. The 1254px PNG originals stay in
// /assets/characters/ as the approved masters and are not served in pages.
export function getCharacterPortrait(
	characterId: string,
	expression: unknown = "neutral",
	size: "small" | "large" = "small",
) {
	const choices = portraits[characterId === "director" ? "director" : "aoba"];
	const key =
		typeof expression === "string" && Object.hasOwn(choices, expression)
			? expression
			: "neutral";
	return choices[key].replace(/\.png$/, size === "large" ? "-512.webp" : "-192.webp");
}
