import { describe, expect, it } from "vitest";
import { withDiscoveredServerId } from "../src/pi/pi-app";

const VALID = "00000000-0000-4000-8000-000000000000";

function prefs(serverId: string) {
	return { url: "ws://127.0.0.1:8790", serverId };
}

describe("withDiscoveredServerId", () => {
	it("adopts the discovered id only when the saved one is empty", () => {
		expect(withDiscoveredServerId(prefs(""), VALID)).toEqual(prefs(VALID));
		expect(withDiscoveredServerId(prefs("  "), VALID)).toEqual(prefs(VALID));
	});

	it("never overwrites a non-empty saved id (it may target another server on purpose)", () => {
		const saved = prefs("11111111-1111-4111-8111-111111111111");
		expect(withDiscoveredServerId(saved, VALID)).toBe(saved);
	});

	it("ignores discovered values that are not canonical UUIDv4", () => {
		const empty = prefs("");
		expect(withDiscoveredServerId(empty, "not-a-uuid")).toBe(empty);
		expect(withDiscoveredServerId(empty, undefined)).toBe(empty);
	});
});
