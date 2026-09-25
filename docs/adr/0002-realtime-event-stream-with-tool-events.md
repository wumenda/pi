# 工具执行采用实时事件流驱动，并以 tool-events 落盘

pi 现有实现是终态重放型：iframe 只能收到工具最终结果，无法呈现执行中进度；而示例服务器的进度推送、审核阻塞、增量 Tab 三种模式全部依赖 progress 通知。决定：打通 MCP progress 通知（含 uiEvent 扩展字段）从 agent 到 iframe 的实时推送链路，并按会话落盘 tool-events JSONL（input / progress / result）；会话重进时与消息流投影合并恢复——冷启动先补 tool-input 再推 tool-result，progress 按「数值 + uiEvent JSON」指纹去重。

## Considered Options

- 仅在线推送、不落盘：被拒——刷新/重进丢失执行中状态，review 阻塞等挂起交互无法跨会话完成。

## Consequences

app-server 需增加 progress 转发通道与 tool-events 存储；消息流仍是唯一事实源，tool-events 只补充执行细节，投影可丢弃可重建。
