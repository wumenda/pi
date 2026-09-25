import dayjs from "dayjs";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";
import enUS from "./en-US";
import { DEFAULT_LANG, type Lang, loadStoredLang, storeLang } from "./lang-storage";
import zhCN from "./zh-CN";

export { Trans, useTranslation } from "react-i18next";
export { i18next as i18n };

const resources = {
	"zh-CN": { translation: zhCN },
	"en-US": { translation: enUS },
};

/**
 * 同步 init（内联资源、无 backend）：渲染前即就绪。
 * 默认语言 zh-CN——既有测试断言中文文案，依赖首帧 t() 输出与原硬编码一致；
 * escapeValue: false（React 已防 XSS）；useSuspense: false（避免测试异步水合）。
 */
void i18next.use(initReactI18next).init({
	lng: loadStoredLang(),
	fallbackLng: DEFAULT_LANG,
	resources,
	interpolation: { escapeValue: false },
	react: { useSuspense: false },
});

const DAYJS_LOCALES: Record<Lang, string> = { "zh-CN": "zh-cn", "en-US": "en" };

/** dayjs locale 跟随当前语言（相对时间"5 分钟前"/"5 minutes ago"） */
function syncDayjsLocale(lang: Lang): void {
	dayjs.locale(DAYJS_LOCALES[lang]);
}

/**
 * 切换语言：i18next + dayjs 同步跟随并持久化 localStorage。
 * i18next.changeLanguage 异步生效；连续 fire-and-forget 调用可能乱序结算
 * （陈旧 promise 后到覆盖新值），串行排队保证「最后一次调用生效」的确定性语义。
 */
let switchQueue: Promise<void> = Promise.resolve();

export function changeLanguage(lang: Lang): void {
	switchQueue = switchQueue.then(() => i18next.changeLanguage(lang)).then(() => undefined);
	storeLang(lang);
	syncDayjsLocale(lang);
}

/** 等待排队中的语言切换全部结算（断言 i18next.language 前使用） */
export function languageSwitched(): Promise<void> {
	return switchQueue;
}

syncDayjsLocale((i18next.language as Lang) ?? DEFAULT_LANG);
