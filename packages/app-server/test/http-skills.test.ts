import { describe, expect, it } from "vitest";
import { createHttpServer, type HttpDeps } from "../src/http.ts";
import type { SkillDetailEntry, SkillManifestEntry } from "../src/skills-manifest.ts";

const skills: SkillManifestEntry[] = [
	{
		name: "alpha",
		description: "Alpha skill",
		filePath: "/tmp/skills/alpha/SKILL.md",
		directory: "/tmp/skills/alpha",
		source: "global",
		disableModelInvocation: false,
		title: "Alpha",
		tools: [{ name: "read" }],
	},
];

const detail: SkillDetailEntry = { ...skills[0]!, body: "Alpha body.", metadataUnavailable: false };

function fakeDeps(overrides: Partial<HttpDeps> = {}): HttpDeps {
	return {
		readUiResource: async () => ({ mimeType: "text/html", html: "<html>x</html>", declaredCsp: null }),
		listMcpTools: async () => [],
		listTools: async () => [],
		listSkills: async () => skills,
		getSkillDetail: async () => detail,
		sessionFilesRoot: async () => null,
		dataCenterStore: async () => null,
		...overrides,
	};
}

describe("GET /api/v1/skills", () => {
	it("returns the manifest with cache-control no-store", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/skills" });
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toEqual(skills);
	});
	it("returns an empty array when no skills exist", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps({ listSkills: async () => [] }));
		const response = await http.inject({ method: "GET", url: "/api/v1/skills" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual([]);
	});
});

describe("GET /api/v1/skills/:name", () => {
	it("returns the skill detail with body", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps());
		const response = await http.inject({ method: "GET", url: "/api/v1/skills/alpha" });
		expect(response.statusCode).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.json()).toEqual(detail);
	});
	it("returns 404 for unknown skills", async () => {
		const http = createHttpServer({ httpPort: 0 }, fakeDeps({ getSkillDetail: async () => null }));
		const response = await http.inject({ method: "GET", url: "/api/v1/skills/missing" });
		expect(response.statusCode).toBe(404);
		expect(response.json()).toEqual({ error: "unknown skill: missing" });
	});
});
