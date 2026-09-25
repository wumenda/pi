import { create } from "zustand";
import { changeLanguage } from "./index";
import { type Lang, loadStoredLang } from "./lang-storage";

interface LangState {
	lang: Lang;
	setLang: (lang: Lang) => void;
}

/**
 * 语言状态小 store（三入口 ConfigProvider locale / dayjs locale / i18next 一致跟随）。
 * 刻意独立于 app-store：i18n 模块被测试与组件广泛引用，
 * 此处仅依赖 zustand + i18n 模块，避免拖带 app-store 的 mcp-iframe 管线依赖。
 */
export const useLangStore = create<LangState>()((set) => ({
	lang: loadStoredLang(),
	setLang: (lang) => {
		changeLanguage(lang);
		set({ lang });
	},
}));
