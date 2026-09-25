import { Dropdown } from "antd"
import { GlobalOutlined } from "@ant-design/icons"
import { useLangStore } from "../i18n/lang-store"
import { useTranslation } from "../i18n"

/** 语言选项：自名标签（"中文"/"English"），不随语言翻译（国际惯例） */
const LANG_OPTIONS = [
  { key: "zh-CN", label: "中文" },
  { key: "en-US", label: "English" },
] as const

/**
 * 语言切换（AppLayout 顶栏，主题切换按钮旁的紧凑下拉）：
 * 切换 → lang-store（ConfigProvider locale 跟随）→ changeLanguage
 * （i18next + dayjs + localStorage 持久化）。
 */
export function LanguageSwitcher() {
  const { t } = useTranslation()
  const lang = useLangStore((s) => s.lang)
  const setLang = useLangStore((s) => s.setLang)
  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        selectable: true,
        selectedKeys: [lang],
        items: LANG_OPTIONS.map(({ key, label }) => ({ key, label })),
        onClick: ({ key }) => {
          if (key === "zh-CN" || key === "en-US") setLang(key)
        },
      }}
    >
      <button
        type="button"
        className="top-bar-icon-btn"
        aria-label={t("common.language")}
        title={t("common.language")}
      >
        <GlobalOutlined />
      </button>
    </Dropdown>
  )
}
