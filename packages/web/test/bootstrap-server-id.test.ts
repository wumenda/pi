import { describe, expect, it } from "vitest";
import { withDiscoveredServerId } from "../src/pi/pi-app";

const VALID = "00000000-0000-4000-8000-000000000000";

function prefs(serverId: string) {
	return { url: "ws://127.0.0.1:8790", serverId };
}

describe("withDiscoveredServerId", () => {
	it("a valid discovered id always wins (server identity, heals stale archives)", () => {
		expect(withDiscoveredServerId(prefs(""), VALID)).toEqual(prefs(VALID));
		expect(withDiscoveredServerId(prefs("  "), VALID)).toEqual(prefs(VALID));
		const saved = prefs("11111111-1111-4111-8111-111111111111");
		expect(withDiscoveredServerId(saved, VALID)).toEqual(prefs(VALID));
	});

	it("falls back to the saved id when discovery is missing or not canonical UUIDv4", () => {
		const saved = prefs("11111111-1111-4111-8111-111111111111");
		expect(withDiscoveredServerId(saved, "not-a-uuid")).toBe(saved);
		expect(withDiscoveredServerId(saved, undefined)).toBe(saved);
	});
});
