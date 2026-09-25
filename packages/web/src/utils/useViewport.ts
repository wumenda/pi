import { useEffect, useState } from "react";

/** 视口宽度（px），随窗口 resize 实时更新（响应式布局断点依据） */
export function useViewport(): number {
	const [width, setWidth] = useState(() => window.innerWidth);

	useEffect(() => {
		const onResize = () => setWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	return width;
}
