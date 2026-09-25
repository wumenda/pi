import { Input, Modal } from "antd"
import { useEffect, useState } from "react"
import { useTranslation } from "../../i18n"

/**
 * 上传语义输入框（语义资产登记移植）：
 * 服务端 POST /sessions/:id/files 要求必填 semantic（写入 .assets-uploads.md，
 * 供 Agent 按语义匹配文件路径），选择文件后弹出本框收集语义。
 * 默认值 = 首个文件名去扩展名；一批多个文件共享同一语义（同批通常同源，
 * 需要不同语义请分批上传）。
 */
export function AssetSemanticModal({
  open,
  fileNames,
  confirmLoading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  fileNames: string[]
  confirmLoading?: boolean
  onCancel: () => void
  onConfirm: (semantic: string) => void
}) {
  const [semantic, setSemantic] = useState("")
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()

  // 每次打开重置：默认语义取首个文件名去扩展名
  useEffect(() => {
    if (open) {
      const first = fileNames[0]
      setSemantic(first ? first.replace(/\.[^.]+$/, "") : "")
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = () => {
    const trimmed = semantic.trim()
    if (!trimmed) {
      setError(t("chat.assetRequired"))
      return
    }
    if (trimmed.length > 500) {
      setError(t("chat.assetTooLong"))
      return
    }
    onConfirm(trimmed)
  }

  return (
    <Modal
      title={
        fileNames.length > 1
          ? t("chat.assetTitleMulti", { n: fileNames.length })
          : t("chat.assetTitle")
      }
      open={open}
      onOk={submit}
      onCancel={onCancel}
      okText={t("chat.assetOk")}
      cancelText={t("common.cancel")}
      okButtonProps={{ autoInsertSpace: false }}
      confirmLoading={confirmLoading}
      maskClosable={false}
    >
      <p>{t("chat.assetFilesLabel")}{fileNames.join("、")}</p>
      <Input
        aria-label={t("chat.assetInputAria")}
        value={semantic}
        onChange={(e) => {
          setSemantic(e.target.value)
          setError(null)
        }}
        onPressEnter={submit}
        placeholder={t("chat.assetPlaceholder")}
        maxLength={500}
        status={error ? "error" : undefined}
      />
      {error && <div style={{ color: "#ff4d4f", marginTop: 8 }}>{error}</div>}
    </Modal>
  )
}
