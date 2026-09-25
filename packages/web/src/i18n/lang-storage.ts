/** 语言持久化 key 的唯一权威定义（i18next / dayjs / antd locale 三入口共用） */
export const LANG_STORAGE_KEY = "platform-lang";

export const SUPPORTED_LANGS = ["zh-CN", "en-US"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

export const DEFAULT_LANG: Lang = "zh-CN";

/** 读取持久化语言（存储被禁/值非法回落默认 zh-CN） */
export function loadStoredLang(): Lang {
	try {
		const stored = localStorage.getItem(LANG_STORAGE_KEY);
		return (SUPPORTED_LANGS as readonly string[]).includes(stored ?? "") ? (stored as Lang) : DEFAULT_LANG;
	} catch {
		return DEFAULT_LANG;
	}
}

/** 持久化语言（失败不影响本次会话切换） */
export function storeLang(lang: Lang): void {
	try {
		localStorage.setItem(LANG_STORAGE_KEY, lang);
	} catch {
		// 持久化失败（隐私模式/配额满）不影响本次会话使用
	}
}
