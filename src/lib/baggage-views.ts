export type BaggageView = "front" | "back" | "top" | "side";

export const VIEWS: { key: BaggageView; title: string; hint: string }[] = [
  { key: "front", title: "Front", hint: "Face the bag towards you, full body in frame" },
  { key: "back", title: "Back", hint: "Show straps, back panel and pockets" },
  { key: "top", title: "Top", hint: "Look down at handles and zippers" },
  { key: "side", title: "Side", hint: "Profile view - shows depth and wheels" },
];
