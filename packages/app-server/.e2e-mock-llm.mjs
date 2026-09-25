/**
 * Mock OpenAI completions server（端到端联调用，验证 pi-web 转译器）。
 * 状态机（按最后一条消息角色）：
 * - 最后是 tool 结果 → 返回 text 总结（引用 tool 输出）
 * - 最后是 user 且文本含 "问题"/"ask" → ask_user_question 工具调用
 * - 其余 user → bash 工具调用（echo 标记串）
 */
import http from "node:http";

const PORT = 8795;

function sse(res, payload) {
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function endStream(res) {
	res.write("data: [DONE]\n\n");
	res.end();
}

function chunkBase(model) {
	return { id: `chatcmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
}

const server = http.createServer((req, res) => {
	if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { message: "not found" } }));
		return;
	}
	let body = "";
	req.on("data", (d) => (body += d));
	req.on("end", () => {
		let parsed = {};
		try {
			parsed = JSON.parse(body);
		} catch {
			// ignore
		}
		const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
		const last = messages[messages.length - 1] ?? {};
		const lastUserText = [...messages].reverse().find((m) => m.role === "user");
		const userText =
			typeof lastUserText?.content === "string"
				? lastUserText.content
				: Array.isArray(lastUserText?.content)
					? lastUserText.content.map((p) => p?.text ?? "").join("")
					: "";
		console.log(`[mock-llm] req lastRole=${last.role} userText=${userText.slice(0, 60).replace(/\n/g, " ")}`);

		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});

		if (last.role === "tool") {
			// 工具结果已回 → text 总结
			const toolContent = typeof last.content === "string" ? last.content : JSON.stringify(last.content ?? "");
			const text = `收到工具结果：${toolContent.slice(0, 80)}。本轮检查完成，转译链路工作正常。`;
			sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
			sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
			sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
			endStream(res);
			return;
		}

		if (/问题|ask/i.test(userText)) {
			// ask_user_question 工具调用（前端 AskUserCard 渲染 → 用户作答 → answerAskUser）
			const args = JSON.stringify({
				title: "确认改造方向",
				question: "请选择本轮改造的重点方向",
				allowCustom: false,
				pages: [
					{
						type: "list-single",
						id: "focus",
						title: "改造重点",
						question: "优先推进哪个方向？",
						fields: [
							{
								id: "choice",
								label: "重点方向",
								valueType: "enum",
								widget: "radio",
								required: true,
								options: [
									{ id: "energy", label: "节能降碳", description: "降低蒸汽单耗" },
									{ id: "quality", label: "提升质量", description: "稳定产品纯度" },
								],
							},
						],
					},
				],
			});
			sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
			sse(res, {
				...chunkBase(parsed.model),
				choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_ask_${Date.now()}`, type: "function", function: { name: "ask_user_question", arguments: "" } }] }, finish_reason: null }],
			});
			sse(res, {
				...chunkBase(parsed.model),
				choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }],
			});
			sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
			endStream(res);
			return;
		}

		// 默认：bash 工具调用
		const args = JSON.stringify({ command: "echo pi-web-e2e-ok" });
		sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
		sse(res, {
			...chunkBase(parsed.model),
			choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_bash_${Date.now()}`, type: "function", function: { name: "bash", arguments: "" } }] }, finish_reason: null }],
		});
		sse(res, {
			...chunkBase(parsed.model),
			choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }],
		});
		sse(res, { ...chunkBase(parsed.model), choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
		endStream(res);
	});
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`[mock-llm] listening http://127.0.0.1:${PORT}/v1/chat/completions`);
});
