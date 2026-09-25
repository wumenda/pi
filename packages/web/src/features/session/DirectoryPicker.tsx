import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button, Empty, Modal, Spin } from "antd"
import { ArrowUpOutlined, FolderOutlined } from "@ant-design/icons"
import { fetchDirectories } from "../../api/fs"

/**
 * 服务器目录选择器（新建对话弹窗「浏览」入口）：
 * 从服务端默认根逐级浏览子目录，「选择当前目录」回填路径。
 * 路径拼接统一用 "/"，由服务端 resolve 归一化（Windows 兼容正反斜杠）。
 */
export function DirectoryPicker({
  open,
  onCancel,
  onSelect,
}: {
  open: boolean
  onCancel: () => void
  onSelect: (directory: string) => void
}) {
  // undefined = 服务端默认根目录
  const [path, setPath] = useState<string | undefined>(undefined)

  const { data, isLoading } = useQuery({
    queryKey: ["fs-directories", path],
    queryFn: () => fetchDirectories(path),
    enabled: open,
    staleTime: 0,
    retry: false,
  })

  const current = data?.path ?? path
  const join = (name: string) =>
    `${(current ?? "").replace(/[\\/]+$/, "")}/${name}`

  return (
    <Modal
      title="选择服务器目录"
      open={open}
      zIndex={1100}
      width={480}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="select"
          type="primary"
          disabled={!current}
          onClick={() => current && onSelect(current)}
        >
          选择当前目录
        </Button>,
      ]}
    >
      <div className="dir-picker-bar">
        <Button
          size="small"
          icon={<ArrowUpOutlined />}
          aria-label="上一级目录"
          disabled={!data?.parent}
          onClick={() => setPath(data?.parent ?? undefined)}
        />
        <span className="dir-picker-path" title={current}>
          {current ?? "..."}
        </span>
      </div>
      <div className="dir-picker-list">
        {isLoading ? (
          <div className="dir-picker-loading">
            <Spin size="small" />
          </div>
        ) : (data?.directories.length ?? 0) === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="无子目录"
          />
        ) : (
          data!.directories.map((name) => (
            <button
              key={name}
              type="button"
              className="dir-picker-entry"
              onClick={() => setPath(join(name))}
            >
              <FolderOutlined />
              <span className="dir-picker-entry-name">{name}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
