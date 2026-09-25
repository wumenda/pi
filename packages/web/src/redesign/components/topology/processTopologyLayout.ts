export interface TopologyPoint {
	x: number;
	y: number;
}

export interface ProcessZone {
	id: string;
	index: number;
	title: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export type ProcessNodeType =
	| "feed"
	| "product"
	| "byproduct"
	| "wastewater"
	| "purge"
	| "mixer"
	| "reactor"
	| "tower"
	| "vessel";

export interface ProcessNode {
	id: string;
	type: ProcessNodeType;
	code: string;
	name: string;
	subtitle?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	zoneId: string;
}

export interface SchemeNodeLayout {
	type: string;
	code: string;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	zoneId: string;
}

export type ProcessStreamType =
	| "main"
	| "methanolMakeup"
	| "methanolRecycle"
	| "waterWaste"
	| "byproduct"
	| "purge"
	| "product"
	| "scheme";

export interface ProcessStream {
	id: string;
	source: string;
	target: string;
	type: ProcessStreamType;
	label: string;
	points: TopologyPoint[];
	arrow: boolean;
	dashed?: boolean;
}

export interface SchemeStreamLayout {
	type: string;
	label: string;
	points: TopologyPoint[];
	arrow: boolean;
	dashed?: boolean;
	schemeChange: string;
}

export const processZones: ProcessZone[] = [
	{ id: "feed", index: 1, title: "原料预处理区", x: 176, y: 74, width: 150, height: 182 },
	{ id: "reaction", index: 2, title: "醚化与催化蒸馏区", x: 350, y: 60, width: 220, height: 214 },
	{ id: "methanol", index: 3, title: "甲醇水洗与回收区", x: 594, y: 72, width: 190, height: 190 },
	{ id: "product", index: 4, title: "产品分离区", x: 812, y: 64, width: 206, height: 202 },
	{ id: "tame", index: 5, title: "TAME 精制区", x: 352, y: 310, width: 170, height: 142 },
	{ id: "waterwash", index: 6, title: "反应物水洗区", x: 552, y: 310, width: 164, height: 142 },
	{ id: "isomer", index: 7, title: "异构化区", x: 748, y: 310, width: 146, height: 142 },
	{ id: "refine", index: 8, title: "异戊烯精制区", x: 922, y: 310, width: 176, height: 142 },
];

export const processNodes: ProcessNode[] = [
	{
		id: "FEED-001",
		type: "feed",
		code: "C5 原料",
		name: "原料输入",
		x: 198,
		y: 142,
		width: 86,
		height: 34,
		zoneId: "feed",
	},
	{
		id: "MEOH-001",
		type: "feed",
		code: "MOH",
		name: "甲醇补充",
		x: 200,
		y: 206,
		width: 86,
		height: 34,
		zoneId: "feed",
	},
	{
		id: "M-001",
		type: "mixer",
		code: "M-001",
		name: "混合器",
		subtitle: "原料/甲醇",
		x: 296,
		y: 154,
		width: 54,
		height: 78,
		zoneId: "feed",
	},
	{
		id: "R-101",
		type: "reactor",
		code: "R-101",
		name: "醚化反应器",
		x: 392,
		y: 126,
		width: 68,
		height: 120,
		zoneId: "reaction",
	},
	{
		id: "T-201",
		type: "tower",
		code: "T-201",
		name: "催化蒸馏塔",
		subtitle: "反应-分离",
		x: 500,
		y: 106,
		width: 62,
		height: 150,
		zoneId: "reaction",
	},
	{
		id: "T-301",
		type: "tower",
		code: "T-301",
		name: "解吸塔",
		x: 636,
		y: 110,
		width: 58,
		height: 138,
		zoneId: "methanol",
	},
	{
		id: "W-301",
		type: "vessel",
		code: "W-301",
		name: "甲醇水洗",
		x: 724,
		y: 164,
		width: 54,
		height: 62,
		zoneId: "methanol",
	},
	{
		id: "T-302",
		type: "tower",
		code: "T-302",
		name: "产品分离塔",
		x: 848,
		y: 96,
		width: 62,
		height: 158,
		zoneId: "product",
	},
	{
		id: "P-001",
		type: "product",
		code: "产品",
		name: "异戊烯产品",
		x: 946,
		y: 128,
		width: 94,
		height: 38,
		zoneId: "product",
	},
	{
		id: "TAME-001",
		type: "byproduct",
		code: "TAME",
		name: "TAME/重组分",
		x: 388,
		y: 372,
		width: 102,
		height: 38,
		zoneId: "tame",
	},
	{
		id: "W-401",
		type: "vessel",
		code: "W-401",
		name: "反应物水洗",
		x: 602,
		y: 370,
		width: 58,
		height: 58,
		zoneId: "waterwash",
	},
	{
		id: "R-401",
		type: "reactor",
		code: "R-401",
		name: "异构化反应器",
		x: 788,
		y: 358,
		width: 64,
		height: 84,
		zoneId: "isomer",
	},
	{
		id: "T-401",
		type: "tower",
		code: "T-401",
		name: "异戊烯精制塔",
		x: 974,
		y: 324,
		width: 58,
		height: 136,
		zoneId: "refine",
	},
	{
		id: "WW-001",
		type: "wastewater",
		code: "水相",
		name: "污水/水相",
		x: 646,
		y: 468,
		width: 90,
		height: 34,
		zoneId: "waterwash",
	},
	{
		id: "PURGE-001",
		type: "purge",
		code: "放空",
		name: "轻组分放空",
		x: 1048,
		y: 218,
		width: 78,
		height: 32,
		zoneId: "product",
	},
];

export const schemeNodeLayout: Record<string, SchemeNodeLayout> = {
	"R-102": {
		type: "reactor",
		code: "R-102",
		name: "并联反应器",
		x: 430,
		y: 316,
		width: 64,
		height: 92,
		zoneId: "tame",
	},
	"R-17": { type: "reactor", code: "R-17", name: "利旧反应器", x: 430, y: 316, width: 64, height: 92, zoneId: "tame" },
	"R-New": {
		type: "reactor",
		code: "R-New",
		name: "专用醚化反应器",
		x: 430,
		y: 316,
		width: 70,
		height: 96,
		zoneId: "tame",
	},
	"S-New": {
		type: "tower",
		code: "S-New",
		name: "快速分离塔",
		x: 690,
		y: 326,
		width: 58,
		height: 124,
		zoneId: "waterwash",
	},
};

export const processStreams: ProcessStream[] = [
	{
		id: "E-001",
		source: "FEED-001",
		target: "M-001",
		type: "main",
		label: "C5 原料",
		points: [
			{ x: 284, y: 159 },
			{ x: 296, y: 159 },
		],
		arrow: true,
	},
	{
		id: "E-MEOH",
		source: "MEOH-001",
		target: "M-001",
		type: "methanolMakeup",
		label: "甲醇补充",
		points: [
			{ x: 286, y: 223 },
			{ x: 296, y: 223 },
		],
		arrow: true,
	},
	{
		id: "E-002",
		source: "M-001",
		target: "R-101",
		type: "main",
		label: "混合进料",
		points: [
			{ x: 350, y: 180 },
			{ x: 392, y: 180 },
		],
		arrow: true,
	},
	{
		id: "E-003",
		source: "R-101",
		target: "T-201",
		type: "main",
		label: "反应产物",
		points: [
			{ x: 460, y: 178 },
			{ x: 500, y: 178 },
		],
		arrow: true,
	},
	{
		id: "E-004",
		source: "T-201",
		target: "T-301",
		type: "main",
		label: "塔顶轻组分",
		points: [
			{ x: 562, y: 146 },
			{ x: 636, y: 146 },
		],
		arrow: true,
	},
	{
		id: "E-006",
		source: "T-301",
		target: "T-302",
		type: "main",
		label: "目标组分流",
		points: [
			{ x: 694, y: 166 },
			{ x: 848, y: 166 },
		],
		arrow: true,
	},
	{
		id: "E-007",
		source: "T-302",
		target: "P-001",
		type: "product",
		label: "异戊烯产品",
		points: [
			{ x: 910, y: 146 },
			{ x: 946, y: 146 },
		],
		arrow: true,
	},
	{
		id: "E-008",
		source: "T-301",
		target: "M-001",
		type: "methanolRecycle",
		label: "甲醇循环",
		points: [
			{ x: 666, y: 110 },
			{ x: 666, y: 38 },
			{ x: 322, y: 38 },
			{ x: 322, y: 154 },
		],
		arrow: true,
		dashed: true,
	},
	{
		id: "E-005",
		source: "T-201",
		target: "TAME-001",
		type: "byproduct",
		label: "TAME/重组分",
		points: [
			{ x: 530, y: 256 },
			{ x: 530, y: 384 },
			{ x: 490, y: 384 },
		],
		arrow: true,
	},
	{
		id: "E-WASH",
		source: "T-201",
		target: "W-401",
		type: "main",
		label: "未反应物流",
		points: [
			{ x: 562, y: 226 },
			{ x: 582, y: 226 },
			{ x: 582, y: 398 },
			{ x: 602, y: 398 },
		],
		arrow: true,
	},
	{
		id: "E-ISO",
		source: "W-401",
		target: "R-401",
		type: "main",
		label: "水洗后物流",
		points: [
			{ x: 660, y: 398 },
			{ x: 788, y: 398 },
		],
		arrow: true,
	},
	{
		id: "E-REFINE",
		source: "R-401",
		target: "T-401",
		type: "main",
		label: "异构化产物",
		points: [
			{ x: 852, y: 398 },
			{ x: 974, y: 398 },
		],
		arrow: true,
	},
	{
		id: "E-WATER",
		source: "W-401",
		target: "WW-001",
		type: "waterWaste",
		label: "水相/污水",
		points: [
			{ x: 632, y: 428 },
			{ x: 632, y: 484 },
			{ x: 646, y: 484 },
		],
		arrow: true,
	},
	{
		id: "E-PURGE",
		source: "T-302",
		target: "PURGE-001",
		type: "purge",
		label: "轻组分",
		points: [
			{ x: 910, y: 226 },
			{ x: 1048, y: 226 },
		],
		arrow: true,
		dashed: true,
	},
];

export const schemeStreamLayout: Record<string, SchemeStreamLayout> = {
	"E-RECYCLE-OPT": {
		type: "methanolRecycle",
		label: "短程回流",
		points: [
			{ x: 910, y: 218 },
			{ x: 936, y: 218 },
			{ x: 936, y: 286 },
			{ x: 666, y: 286 },
			{ x: 666, y: 248 },
		],
		arrow: true,
		dashed: true,
		schemeChange: "added",
	},
	"E-R102-IN": {
		type: "scheme",
		label: "新增进料",
		points: [
			{ x: 350, y: 210 },
			{ x: 374, y: 210 },
			{ x: 374, y: 362 },
			{ x: 430, y: 362 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-R102-OUT": {
		type: "scheme",
		label: "新增出料",
		points: [
			{ x: 494, y: 362 },
			{ x: 520, y: 362 },
			{ x: 520, y: 256 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-R17-IN": {
		type: "scheme",
		label: "利旧进料",
		points: [
			{ x: 350, y: 210 },
			{ x: 374, y: 210 },
			{ x: 374, y: 362 },
			{ x: 430, y: 362 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-R17-OUT": {
		type: "scheme",
		label: "利旧出料",
		points: [
			{ x: 494, y: 362 },
			{ x: 520, y: 362 },
			{ x: 520, y: 256 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-RNEW-IN": {
		type: "scheme",
		label: "新增进料",
		points: [
			{ x: 350, y: 210 },
			{ x: 374, y: 210 },
			{ x: 374, y: 362 },
			{ x: 430, y: 362 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-RNEW-OUT": {
		type: "scheme",
		label: "新增出料",
		points: [
			{ x: 500, y: 362 },
			{ x: 520, y: 362 },
			{ x: 520, y: 256 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-SNEW-IN": {
		type: "scheme",
		label: "塔釜出料",
		points: [
			{ x: 530, y: 256 },
			{ x: 530, y: 286 },
			{ x: 690, y: 286 },
			{ x: 690, y: 388 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-SNEW-TAME": {
		type: "byproduct",
		label: "TAME 快速移出",
		points: [
			{ x: 690, y: 418 },
			{ x: 690, y: 454 },
			{ x: 490, y: 454 },
			{ x: 490, y: 391 },
		],
		arrow: true,
		schemeChange: "added",
	},
	"E-SNEW-C5": {
		type: "scheme",
		label: "未反应碳五回流",
		points: [
			{ x: 748, y: 358 },
			{ x: 770, y: 358 },
			{ x: 770, y: 286 },
			{ x: 562, y: 286 },
			{ x: 562, y: 226 },
		],
		arrow: true,
		dashed: true,
		schemeChange: "added",
	},
};
