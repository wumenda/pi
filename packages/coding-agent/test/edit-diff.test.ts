import { describe, expect, it } from "vitest";
import {
	applyEditsToNormalizedContent,
	fuzzyFindText,
	fuzzyNormalizeWithMap,
	normalizeForFuzzyMatch,
} from "../src/core/tools/edit-diff.ts";

// fuzzy 路径字节级回归：
// 修复前，任一 edit 需要 fuzzy 匹配时，被触及行会从 NFKC 规范化后的 base 整行
// 重写——oldText 未覆盖的行内字符（NBSP、全角、行尾空白、smart quote）被静默改写。
// 修复后，fuzzy 命中经簇级映射换算回原始坐标，只替换命中区间，区间外字节全保留。

describe("fuzzyNormalizeWithMap", () => {
	it("produces the same normalized text as normalizeForFuzzyMatch", () => {
		const samples = [
			"plain text\n",
			"trailing   \nlines\u00A0here\n",
			"smart ‘quotes’ and “doubles” — dash\n",
			"ligature ﬁle and ① circled\n",
			"e\u0301 combining accent\n",
			"",
		];
		for (const sample of samples) {
			expect(fuzzyNormalizeWithMap(sample).normalized).toBe(normalizeForFuzzyMatch(sample));
		}
	});

	it("maps expanded clusters back to their origin range", () => {
		// （U+FB01）NFKC 展开为 "fi"：两个规范化字符都映射回同一原始簇
		const { normalized, map } = fuzzyNormalizeWithMap("aﬁle");
		expect(normalized).toBe("afile");
		expect(map[1]).toEqual({ origin: 1, end: 2 });
		expect(map[2]).toEqual({ origin: 1, end: 2 });
	});

	it("drops only trailing whitespace clusters per line", () => {
		// "keep   mid\u00A0word   \nnext"：k0 e1 e2 p3 ␠4-6 m7 i8 d9 NBSP10 w11 o12 r13 d14 ␠15-17 \n18
		const { map } = fuzzyNormalizeWithMap("keep   mid\u00A0word   \nnext");
		// 行首/行中空白保留（"keep   mid"、NBSP），行尾三个空格（15-17）被删除
		expect(map.some((entry) => entry.origin === 4)).toBe(true);
		expect(map.some((entry) => entry.origin === 10)).toBe(true);
		expect(map.filter((entry) => entry.origin >= 15 && entry.origin <= 17).length).toBe(0);
		expect(map.some((entry) => entry.origin === 19)).toBe(true);
	});
});

describe("applyEditsToNormalizedContent（fuzzy 字节级保护）", () => {
	it("keeps out-of-range bytes on a fuzzy-matched line (NBSP)", () => {
		const content = "y\u00A0= 2 and keep\u00A0me\n";
		const { newContent } = applyEditsToNormalizedContent(content, [{ oldText: "y = 2", newText: "z = 3" }], "f");
		// 命中区间 "y\u00A0= 2" 被替换；区间外 "keep\u00A0me" 的 NBSP 保持原字节
		expect(newContent).toBe("z = 3 and keep\u00A0me\n");
	});

	it("keeps trailing whitespace when oldText does not reach the line end", () => {
		const content = "first target   \nnext\n";
		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "first target", newText: "FIRST" }],
			"f",
		);
		// 旧行为：整行从规范化 base 重写，行尾空格丢失
		expect(newContent).toBe("FIRST   \nnext\n");
	});

	it("replaces the whole line when oldText extends to the newline (#5899 semantics)", () => {
		const content = "replace me   \nafter   \n\n";
		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "replace me\n", newText: "after\n" }],
			"f",
		);
		// oldText 以 \n 结尾：\n 的簇终点越过行尾空白，整行被替换（与既有行为一致）
		expect(newContent).toBe("after\nafter   \n\n");
	});

	it("maps ligature expansions onto the original cluster", () => {
		const content = "ﬁle.txt\n";
		const { newContent } = applyEditsToNormalizedContent(content, [{ oldText: "file", newText: "FILE" }], "f");
		// "file" fuzzy 命中 "ﬁle"（ﬁ → fi），区间覆盖 ﬁ 簇
		expect(newContent).toBe("FILE.txt\n");
	});

	it("does not misreport exact-unique text as duplicated by fuzzy variants", () => {
		const content = "it's here\nand it’s there\n";
		// oldText 精确唯一；旧行为在 fuzzy 空间计数（' 与 ' 归一后相同）误报 2 次
		const { newContent } = applyEditsToNormalizedContent(
			content,
			[{ oldText: "it's here", newText: "IT IS HERE" }],
			"f",
		);
		expect(newContent).toBe("IT IS HERE\nand it’s there\n");
	});

	it("still rejects genuinely duplicated fuzzy matches", () => {
		// 两行都因 NBSP 精确 miss，fuzzy 空间命中 2 次 → 拒绝
		const content = "x\u00A0one\nx\u00A0one\n";
		expect(() => applyEditsToNormalizedContent(content, [{ oldText: "x one", newText: "X" }], "f")).toThrow(
			/occurrences/,
		);
	});

	it("keeps exact matches on original coordinates even when another edit is fuzzy", () => {
		const content = "exact line   \nsmart\u00A0line\n";
		const { newContent } = applyEditsToNormalizedContent(
			content,
			[
				{ oldText: "exact line", newText: "EXACT" }, // 精确命中
				{ oldText: "smart line", newText: "SMART" }, // fuzzy 命中（NBSP）
			],
			"f",
		);
		expect(newContent).toBe("EXACT   \nSMART\n");
	});

	it("rejects overlapping edits in original coordinates", () => {
		const content = "one\u00A0two\u00A0three\n";
		expect(() =>
			applyEditsToNormalizedContent(
				content,
				[
					{ oldText: "one two", newText: "A" },
					{ oldText: "two three", newText: "B" },
				],
				"f",
			),
		).toThrow(/overlap/);
	});
});

describe("fuzzyFindText（原始坐标契约）", () => {
	it("returns original coordinates for fuzzy matches", () => {
		const content = "aﬁle\n";
		const result = fuzzyFindText(content, "file");
		expect(result.found).toBe(true);
		expect(result.usedFuzzyMatch).toBe(true);
		expect(result.contentForReplacement).toBe(content);
		// "ﬁle" 是 3 个 code unit（ﬁ 1 个 + l + e），区间覆盖整个词
		expect(result.index).toBe(1);
		expect(result.matchLength).toBe(3);
		expect(content.slice(result.index, result.index + result.matchLength)).toBe("ﬁle");
	});

	it("reports not-found without fuzzy hits", () => {
		const result = fuzzyFindText("abc\n", "xyz");
		expect(result.found).toBe(false);
		expect(result.index).toBe(-1);
		expect(result.contentForReplacement).toBe("abc\n");
	});
});
