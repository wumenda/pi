import { describe, expect, it } from "vitest";
import { isValidSessionId } from "../src/session-id.ts";

describe("isValidSessionId", () => {
	it("accepts generated UUID ids and safe custom ids", () => {
		// UUIDv7（缺省生成）与 UUIDv4 都必须通过
		expect(isValidSessionId("0192f0a1-7b3a-7abc-9def-0123456789ab")).toBe(true);
		expect(isValidSessionId("00000000-0000-4000-8000-000000000000")).toBe(true);
		// 合法自定义 id：字母数字、连字符、下划线
		expect(isValidSessionId("my-session-1")).toBe(true);
		expect(isValidSessionId("a")).toBe(true);
		expect(isValidSessionId("A_b-C_0123456789")).toBe(true);
		// 上限 128 字符
		expect(isValidSessionId("a".repeat(128))).toBe(true);
	});

	it("rejects path traversal and separator ids", () => {
		expect(isValidSessionId("../../evil")).toBe(false);
		expect(isValidSessionId("..\\..\\evil")).toBe(false);
		expect(isValidSessionId("../x")).toBe(false);
		expect(isValidSessionId("a/b")).toBe(false);
		expect(isValidSessionId("a\\b")).toBe(false);
		expect(isValidSessionId("..")).toBe(false);
		expect(isValidSessionId(".hidden")).toBe(false);
	});

	it("rejects ids that could escape via scheme, drive, or percent-encoding", () => {
		expect(isValidSessionId("file:///etc/passwd")).toBe(false);
		expect(isValidSessionId("C:\\x")).toBe(false);
		expect(isValidSessionId("c:/x")).toBe(false);
		expect(isValidSessionId("..%2F..%2Fevil")).toBe(false);
	});

	it("rejects empty, control-character, and oversized ids", () => {
		expect(isValidSessionId("")).toBe(false);
		expect(isValidSessionId("id\n")).toBe(false);
		expect(isValidSessionId("\u0000")).toBe(false);
		expect(isValidSessionId(" ".repeat(4))).toBe(false);
		expect(isValidSessionId("中文会话")).toBe(false);
		expect(isValidSessionId("a".repeat(129))).toBe(false);
		expect(isValidSessionId("-leading")).toBe(false);
	});
});
