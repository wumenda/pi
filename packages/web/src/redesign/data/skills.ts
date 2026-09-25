// @ts-nocheck
// TODO(复刻): 原型 JS 数据文件直接转置，随页面复刻逐步补齐类型后移除上一行
// 技能库 Mock 数据
// 统一 Skill 数据模型，后续新增 Skill 只需在此补充配置

export const skillCategories = [
	"全部",
	"认知解析",
	"诊断分析",
	"方案设计",
	"模拟验证",
	"设备工程",
	"工程交付",
	"通用能力",
];

export const scopeOptions = ["全部", "全厂级", "系统级", "装置级", "设备级", "通用"];

// Skill 图标映射 key（组件中映射到 lucide 图标）
export const skillIconMap = {
	plant_cognition: "Network",
	process_diagnosis: "Gauge",
	scheme_generator: "Lightbulb",
	scheme_simulation: "FlaskConical",
	scheme_optimizer: "RefreshCw",
	pfd_parser: "FileImage",
	data_processing_and_analysis: "Table2",
	investment_estimation: "BadgeDollarSign",
	feasibility_report_generation: "FileText",
};

export const skills = [
	// ==================== 1. 装置认知 ====================
	{
		id: "plant_cognition",
		name: "装置认知",
		icon: "Network",
		scope: "装置级",
		category: "认知解析",
		description:
			"整合装置图纸、设计资料及已有解析结果，建立设备、流股、工艺关系及关键参数之间的结构化关联，为后续诊断、方案设计和验证提供统一的装置认知基础。",
		scenarios: [
			{
				title: "新装置资料梳理",
				desc: "面对大量设计资料时，快速形成对装置结构和工艺流程的整体认知。",
				icon: "Boxes",
			},
			{
				title: "改造项目前期",
				desc: "开展诊断和改造设计前，需要先建立现有装置的结构化基础模型。",
				icon: "ClipboardCheck",
			},
			{ title: "图纸及资料更新", desc: "设计资料更新后，需要同步更新装置认知结果。", icon: "RefreshCw" },
			{ title: "工艺问题追溯", desc: "需要快速查询某个设备、流股及其上下游关联关系。", icon: "Search" },
		],
		capabilities: [
			{ title: "多源资料理解", desc: "整合 PFD、工艺说明、设备资料等不同来源的装置信息。" },
			{ title: "工艺对象归并", desc: "对设备、流股及相关工艺对象进行整理、关联和统一表达。" },
			{ title: "流程关系构建", desc: "建立设备、流股及上下游工艺关系，形成装置流程结构。" },
			{ title: "装置认知成果生成", desc: "形成能够被后续诊断和改造 Skill 直接使用的结构化装置认知结果。" },
		],
		requiredMaterials: ["PFD 图纸或 PFD 解析结果", "装置基础信息"],
		recommendedMaterials: ["工艺设计说明", "设备台账", "设计参数", "运行数据"],
		tools: [],
		toolEmptyText: "当前专业工具配置待补充。",
		outputs: [
			{ id: "o1", name: "装置认知流程图", desc: "展示设备、流股及主要工艺关系。", preview: "flow" },
			{ id: "o2", name: "设备清单", desc: "形成主要设备及关键属性的结构化清单。", preview: "table" },
			{ id: "o3", name: "流股清单", desc: "形成主要物流及相关工艺参数清单。", preview: "table" },
			{
				id: "o4",
				name: "装置认知结果",
				desc: "形成供后续诊断、方案生成和模拟验证使用的结构化认知成果。",
				preview: "report",
			},
		],
		sampleTask: {
			title: "异戊烯装置认知",
			description:
				"基于异戊烯装置 PFD、设计资料及基础工艺信息，完成设备、流股及流程关系整理，形成结构化装置认知成果。",
			preparedMaterials: ["PFD 图纸", "工艺设计资料", "设备基础资料"],
		},
		relatedSkills: ["pfd_parser", "data_processing_and_analysis", "process_diagnosis"],
		useMode: "agent",
	},

	// ==================== 2. 工艺诊断 ====================
	{
		id: "process_diagnosis",
		name: "工艺诊断",
		icon: "Gauge",
		scope: "装置级",
		category: "诊断分析",
		description:
			"结合装置认知结果、设计工况和运行数据，对收率、反应转化、产品质量等关键指标进行分析，识别影响改造目标实现的主要工艺问题及瓶颈。",
		scenarios: [
			{ title: "收率偏低", desc: "装置收率低于设计或预期目标，需要寻找主要损失环节。", icon: "LineChart" },
			{ title: "产品质量波动", desc: "产品纯度、回收率等指标存在异常。", icon: "FlaskConical" },
			{ title: "扩产瓶颈诊断", desc: "装置计划扩产，需要判断现有流程中可能限制产能提升的环节。", icon: "Zap" },
			{ title: "不知道问题在哪里", desc: "装置存在经营或运行问题，但尚无法明确主要原因。", icon: "Search" },
		],
		capabilities: [
			{ title: "收率分析", desc: "核算关键反应过程及装置收率表现，识别异常损失。" },
			{ title: "反应与转化分析", desc: "分析反应网络、转化率及副反应情况，识别影响目标实现的关键反应因素。" },
			{ title: "分离质量分析", desc: "评估分离单元回收率、纯度及产品质量表现。" },
			{ title: "瓶颈定位", desc: "综合各项分析结果，定位主要瓶颈设备、工艺环节及约束因素。" },
			{ title: "诊断结论生成", desc: "形成结构化诊断结果，为后续改造方案生成提供依据。" },
		],
		requiredMaterials: ["装置认知结果", "主要设计工艺参数", "关键运行数据"],
		recommendedMaterials: ["产品质量数据", "设备设计数据", "历史运行数据"],
		tools: [
			{ id: "calculate_yield", name: "收率核算", description: "基于设计及运行流股数据核算反应器及相关过程收率。" },
			{
				id: "reaction_and_analyze_conversion",
				name: "反应与转化分析",
				description: "识别副反应、整合反应网络并分析运行转化率。",
			},
			{
				id: "evaluate_separator_quality",
				name: "分离质量评估",
				description: "分析塔设备回收率、纯度及相关产品质量表现。",
			},
			{
				id: "assemble_diagnosis_outputs",
				name: "诊断结果汇总",
				description: "汇总各项专业分析结果，形成结构化工艺诊断成果。",
			},
		],
		outputs: [
			{ id: "o1", name: "收率分析结果", desc: "展示关键反应及装置收率情况。", preview: "chart" },
			{ id: "o2", name: "反应与转化分析", desc: "展示主要反应、转化率及异常影响因素。", preview: "chart" },
			{ id: "o3", name: "分离质量评价", desc: "展示回收率、纯度等关键质量指标。", preview: "chart" },
			{ id: "o4", name: "瓶颈与问题清单", desc: "列出主要问题、瓶颈位置及影响程度。", preview: "table" },
			{ id: "o5", name: "工艺诊断结论", desc: "形成后续改造方案设计使用的正式诊断结果。", preview: "report" },
		],
		sampleTask: {
			title: "异戊烯装置收率偏低诊断",
			description: "针对异戊烯装置收率偏低问题，对反应、分离及关键工艺环节进行分析，识别影响收率提升的主要瓶颈。",
			preparedMaterials: ["装置认知结果", "设计工况", "运行数据", "产品质量数据"],
		},
		relatedSkills: ["plant_cognition", "scheme_generator", "data_processing_and_analysis"],
		useMode: "agent",
	},

	// ==================== 3. 改造方案生成 ====================
	{
		id: "scheme_generator",
		name: "改造方案生成",
		icon: "Lightbulb",
		scope: "装置级",
		category: "方案设计",
		description:
			"根据改造目标、工艺诊断结果及工程约束，形成候选改造方案，并支持将用户提出的自定义改造思路转化为结构化方案。",
		scenarios: [
			{ title: "扩能改造", desc: "针对产能目标生成候选流程和设备改造方案。", icon: "Zap" },
			{ title: "节能改造", desc: "针对能耗问题形成对应的优化与改造方案。", icon: "Leaf" },
			{ title: "方案比选", desc: "针对同一目标生成多个候选方向进行后续比较。", icon: "GitCompare" },
			{ title: "自定义方案整理", desc: "用户已有改造想法，需要形成结构化、可验证的方案。", icon: "Edit3" },
		],
		capabilities: [
			{ title: "改造目标对齐", desc: "将扩产、提质、节能等业务目标转化为方案设计约束。" },
			{ title: "诊断结果转化", desc: "根据瓶颈及问题原因识别对应的改造方向。" },
			{ title: "候选方案生成", desc: "形成一个或多个具备明确改造点的候选方案。" },
			{ title: "用户方案结构化", desc: "将用户自行提出的改造思路整理成统一方案结构。" },
			{ title: "改造 Case 构建", desc: "将确认后的方案形成后续模拟验证可以直接使用的改造工况。" },
		],
		requiredMaterials: ["改造目标", "工艺诊断结果", "装置认知结果"],
		recommendedMaterials: ["工程约束条件", "用户改造偏好", "投资限制", "已有改造设想"],
		tools: [
			{
				id: "align_retrofit_target",
				name: "改造目标对齐",
				description: "将改造目标与装置基础信息进行匹配，形成明确的方案设计目标。",
			},
			{
				id: "generate_retrofit_candidates",
				name: "候选方案生成",
				description: "基于诊断结果和改造目标形成候选改造方案。",
			},
			{
				id: "materialize_retrofit_case",
				name: "改造方案实例化",
				description: "将确认后的方案转化为可用于后续模拟验证的 retrofit case。",
			},
		],
		outputs: [
			{ id: "o1", name: "候选方案列表", desc: "展示各候选方案及核心改造思路。", preview: "card" },
			{ id: "o2", name: "改造点清单", desc: "明确需要调整、新增或替换的主要工艺环节。", preview: "table" },
			{ id: "o3", name: "方案说明", desc: "解释方案针对的问题、核心思路及预期影响。", preview: "report" },
			{ id: "o4", name: "改造 Case", desc: "形成可直接进入模拟验证阶段的结构化方案数据。", preview: "code" },
		],
		sampleTask: {
			title: "异戊烯装置扩产 20% 改造方案生成",
			description: "针对装置扩产 20%、少改动和低投资的目标，根据诊断结果形成多个候选改造方案。",
			preparedMaterials: ["改造目标", "工艺诊断结果", "装置认知结果"],
		},
		relatedSkills: ["process_diagnosis", "scheme_simulation", "investment_estimation"],
		useMode: "agent",
	},

	// ==================== 4. 工况模拟 ====================
	{
		id: "scheme_simulation",
		name: "工况模拟",
		icon: "FlaskConical",
		scope: "装置级",
		category: "模拟验证",
		description:
			"对确认后的改造方案建立对应工况并执行流程模拟，通过模拟结果评估方案实施后的产能、产品质量和关键运行指标。",
		scenarios: [
			{ title: "改造方案验证", desc: "需要验证候选方案在工艺上是否可行。", icon: "CheckCircle" },
			{ title: "扩产目标校核", desc: "判断方案能否达到预期产量。", icon: "Zap" },
			{ title: "产品质量校核", desc: "判断改造后质量指标能否达标。", icon: "FlaskConical" },
			{ title: "工况预测", desc: "预测实施改造后的主要工艺状态。", icon: "LineChart" },
		],
		capabilities: [
			{ title: "改造工况构建", desc: "根据 retrofit case 建立对应模拟工况。" },
			{ title: "流程模拟", desc: "计算改造方案实施后的流程状态及关键工艺参数。" },
			{ title: "改造前后对比", desc: "对比原工况与改造工况的关键指标变化。" },
			{ title: "产能校核", desc: "判断改造方案能否实现目标产能。" },
			{ title: "产品质量校核", desc: "判断产品质量指标是否满足目标要求。" },
		],
		requiredMaterials: ["已确认改造方案", "retrofit case", "装置模拟基础数据"],
		recommendedMaterials: ["设计工况", "运行工况", "产品质量目标"],
		tools: [
			{
				id: "run_case_simulation",
				name: "改造工况模拟",
				description: "根据方案 case 生成模拟参数并运行对应流程模拟。",
			},
			{
				id: "evaluate_capacity_and_quality",
				name: "产能与质量评价",
				description: "根据模拟结果评价产能与产品质量是否达到目标。",
			},
		],
		outputs: [
			{ id: "o1", name: "改造工况模拟结果", desc: "展示改造后的主要工艺参数。", preview: "chart" },
			{ id: "o2", name: "改造前后工况对比", desc: "展示关键指标变化。", preview: "chart" },
			{ id: "o3", name: "产能校核结果", desc: "明确目标产能是否达标。", preview: "table" },
			{ id: "o4", name: "产品质量校核结果", desc: "明确主要质量指标是否达标。", preview: "table" },
			{ id: "o5", name: "方案验证结论", desc: "形成方案通过或需要继续优化的判断。", preview: "report" },
		],
		sampleTask: {
			title: "异戊烯扩产方案工况验证",
			description: "对已确认的异戊烯扩产方案进行流程模拟，验证扩产后的产能和产品质量指标是否满足目标要求。",
			preparedMaterials: ["改造方案", "retrofit case", "模拟基础数据"],
		},
		relatedSkills: ["scheme_generator", "scheme_optimizer", "investment_estimation"],
		useMode: "agent",
	},

	// ==================== 5. 方案优化 ====================
	{
		id: "scheme_optimizer",
		name: "方案优化",
		icon: "RefreshCw",
		scope: "装置级",
		category: "方案设计",
		description: "针对方案验证中未达到目标的指标，分析不达标原因并调整改造方案，形成下一轮可继续验证的优化方案。",
		scenarios: [
			{ title: "产能未达标", desc: "方案实施后预测产量未满足目标。", icon: "Zap" },
			{ title: "产品质量未达标", desc: "方案满足产量要求，但质量指标存在问题。", icon: "FlaskConical" },
			{ title: "多轮方案迭代", desc: "需要在多个约束条件之间寻找更优方案。", icon: "RefreshCw" },
			{ title: "改造程度调整", desc: "现有方案改造过大或效果不足，需要重新平衡。", icon: "SlidersHorizontal" },
		],
		capabilities: [
			{ title: "未达标结果分析", desc: "识别当前方案未满足的目标及主要差距。" },
			{ title: "调整方向判断", desc: "根据验证结果判断需要调整的工艺环节。" },
			{ title: "方案参数优化", desc: "调整相关工艺参数及改造配置。" },
			{ title: "下一轮方案生成", desc: "形成新的 retrofit case，进入下一轮方案验证。" },
		],
		requiredMaterials: ["当前改造方案", "工况模拟结果", "未达标指标"],
		recommendedMaterials: ["用户改造偏好", "工程限制", "投资约束"],
		tools: [
			{
				id: "optimize_retrofit_scheme",
				name: "改造方案优化",
				description: "根据未达标反馈调整 retrofit case，形成下一轮优化方案。",
			},
		],
		outputs: [
			{ id: "o1", name: "未达标原因分析", desc: "说明当前方案存在的问题。", preview: "report" },
			{ id: "o2", name: "方案优化建议", desc: "给出需要调整的主要方向。", preview: "card" },
			{ id: "o3", name: "优化后改造方案", desc: "形成新的候选改造配置。", preview: "card" },
			{ id: "o4", name: "下一轮 retrofit case", desc: "供工况模拟继续验证。", preview: "code" },
		],
		sampleTask: {
			title: "异戊烯扩产方案二次优化",
			description: "针对首轮模拟中产品质量未达标的问题，对当前扩产方案进行调整并生成下一轮验证方案。",
			preparedMaterials: ["当前改造方案", "首轮模拟结果", "指标校核结果"],
		},
		relatedSkills: ["scheme_simulation", "scheme_generator", "investment_estimation"],
		useMode: "agent",
	},

	// ==================== 6. PFD 图纸解析 ====================
	{
		id: "pfd_parser",
		name: "PFD 图纸解析",
		icon: "FileImage",
		scope: "通用",
		category: "认知解析",
		description:
			"解析 PFD 图纸中的设备、流股、工艺连接及相关标识信息，将非结构化工程图纸转换为可供后续业务使用的结构化数据。",
		scenarios: [
			{ title: "老图纸数字化", desc: "已有大量历史 PFD，需要转换成结构化数据。", icon: "FileImage" },
			{ title: "装置认知准备", desc: "进行装置认知前，需要先解析 PFD。", icon: "Network" },
			{ title: "图纸版本更新", desc: "新版本 PFD 需要重新解析并更新已有认知。", icon: "RefreshCw" },
			{ title: "流程梳理", desc: "希望快速了解图纸中的设备、流股和流程结构。", icon: "Search" },
		],
		capabilities: [
			{ title: "设备识别", desc: "识别 PFD 中的主要设备及设备标识。" },
			{ title: "流股识别", desc: "识别主要工艺流股及相关编号。" },
			{ title: "流程关系提取", desc: "识别设备和流股之间的连接关系。" },
			{ title: "跨页关系整理", desc: "对多页 PFD 中存在的跨页流股关系进行关联。" },
			{ title: "结构化结果生成", desc: "形成能够直接进入装置认知 Skill 的解析成果。" },
		],
		requiredMaterials: ["PFD 图纸"],
		recommendedMaterials: ["完整 PFD 图纸集", "图例及设备编号规则", "已有设备或流股清单"],
		tools: [],
		toolEmptyText: "当前专业工具配置待补充。",
		outputs: [
			{ id: "o1", name: "PFD 解析结果", desc: "展示图纸识别及标注结果。", preview: "image" },
			{ id: "o2", name: "设备识别清单", desc: "列出识别出的设备及基本信息。", preview: "table" },
			{ id: "o3", name: "流股识别清单", desc: "列出识别出的主要流股。", preview: "table" },
			{ id: "o4", name: "流程关系数据", desc: "形成设备和流股之间的结构化连接关系。", preview: "code" },
			{ id: "o5", name: "跨页关系结果", desc: "整理多页图纸之间的关联。", preview: "table" },
		],
		sampleTask: {
			title: "异戊烯装置 PFD 图纸解析",
			description: "解析异戊烯装置 PFD 图纸，识别设备、流股以及主要流程关系，为后续装置认知提供基础数据。",
			preparedMaterials: ["PFD 图纸"],
		},
		relatedSkills: ["plant_cognition", "data_processing_and_analysis"],
		useMode: "direct",
	},

	// ==================== 7. 数据处理与分析 ====================
	{
		id: "data_processing_and_analysis",
		name: "数据处理与分析",
		icon: "Table2",
		scope: "通用",
		category: "通用能力",
		description:
			"对设计、运行及工程数据进行清洗、标准化、统计分析和基础可视化，为诊断、模拟、经济评价等专业任务提供可靠数据基础。",
		scenarios: [
			{ title: "原始运行数据整理", desc: "历史数据较乱，需要先清洗后才能使用。", icon: "Table2" },
			{ title: "多来源数据合并", desc: "需要统一设计、运行及设备数据。", icon: "Layers" },
			{ title: "异常数据检查", desc: "判断数据中是否存在异常点或缺失问题。", icon: "AlertTriangle" },
			{ title: "运行趋势分析", desc: "分析关键变量的长期变化及异常波动。", icon: "LineChart" },
		],
		capabilities: [
			{ title: "数据清洗", desc: "处理缺失值、重复值及明显异常数据。" },
			{ title: "数据标准化", desc: "统一字段、单位、时间格式等数据表达。" },
			{ title: "数据质量检查", desc: "识别数据完整性及一致性问题。" },
			{ title: "统计分析", desc: "进行基础统计、分布及对比分析。" },
			{ title: "趋势分析", desc: "分析主要运行参数随时间的变化趋势。" },
		],
		requiredMaterials: ["待处理数据文件或数据表"],
		recommendedMaterials: ["字段说明", "数据单位说明", "数据时间范围", "业务规则说明"],
		tools: [],
		toolEmptyText: "当前专业工具配置待补充。",
		outputs: [
			{ id: "o1", name: "清洗后数据集", desc: "形成可供后续算法直接使用的数据。", preview: "table" },
			{ id: "o2", name: "数据质量报告", desc: "说明缺失、异常及数据完整性情况。", preview: "report" },
			{ id: "o3", name: "统计分析结果", desc: "形成主要统计指标和数据特征。", preview: "chart" },
			{ id: "o4", name: "趋势分析图表", desc: "展示关键变量的时间变化趋势。", preview: "chart" },
		],
		sampleTask: {
			title: "装置历史运行数据整理与分析",
			description: "对装置历史运行数据进行清洗、异常检查和趋势分析，形成可供后续工艺诊断使用的数据集。",
			preparedMaterials: ["历史运行数据"],
		},
		relatedSkills: ["plant_cognition", "process_diagnosis", "scheme_simulation"],
		useMode: "direct",
	},

	// ==================== 8. 投资估算 ====================
	{
		id: "investment_estimation",
		name: "投资估算",
		icon: "BadgeDollarSign",
		scope: "通用",
		category: "通用能力",
		description:
			"根据改造方案、设备变化和工程信息，对项目建设投资进行快速估算，并形成方案经济比较所需的基础投资数据。",
		scenarios: [
			{ title: "改造方案投资估算", desc: "方案基本确定后，需要判断大致投资规模。", icon: "BadgeDollarSign" },
			{ title: "多方案经济比选", desc: "多个方案技术上均可行，需要比较投资差异。", icon: "GitCompare" },
			{ title: "可研资料准备", desc: "编制可研报告前，需要形成投资估算基础数据。", icon: "FileText" },
			{ title: "项目决策支持", desc: "需要快速判断不同改造程度对应的投资水平。", icon: "ClipboardCheck" },
		],
		capabilities: [
			{ title: "改造内容识别", desc: "整理方案涉及的新增、替换及改造项目。" },
			{ title: "投资项目拆分", desc: "按照主要设备、材料、安装及相关费用进行分类。" },
			{ title: "投资费用估算", desc: "估算主要改造项目及项目整体投资。" },
			{ title: "投资结构分析", desc: "展示不同费用类别在总投资中的构成。" },
			{ title: "方案投资对比", desc: "对多个候选方案进行投资维度比较。" },
		],
		requiredMaterials: ["改造方案", "主要设备及改造内容清单"],
		recommendedMaterials: ["设备价格信息", "工程费用参数", "安装及材料费用依据", "企业历史项目数据"],
		tools: [],
		toolEmptyText: "当前专业工具配置待补充。",
		outputs: [
			{ id: "o1", name: "投资估算汇总表", desc: "展示项目整体投资规模。", preview: "table" },
			{ id: "o2", name: "分项投资明细", desc: "展示主要设备及工程费用组成。", preview: "table" },
			{ id: "o3", name: "投资构成分析", desc: "展示各类费用占比。", preview: "chart" },
			{ id: "o4", name: "方案投资对比", desc: "对不同候选方案进行投资比较。", preview: "chart" },
		],
		sampleTask: {
			title: "异戊烯扩产改造投资估算",
			description: "根据已确定的异戊烯扩产改造方案及设备改造清单，估算项目建设投资并形成费用明细。",
			preparedMaterials: ["改造方案", "设备改造清单", "基础价格信息"],
		},
		relatedSkills: ["scheme_generator", "scheme_simulation", "feasibility_report_generation"],
		useMode: "direct",
	},

	// ==================== 9. 可研报告生成 ====================
	{
		id: "feasibility_report_generation",
		name: "可研报告生成",
		icon: "FileText",
		scope: "通用",
		category: "通用能力",
		description:
			"汇总项目基础资料、专业分析结果及改造成果，按照可研报告编制要求组织章节内容，形成结构化、可编辑的可研报告初稿。",
		scenarios: [
			{ title: "装置改造可研编制", desc: "项目方案基本确定，需要形成正式可研初稿。", icon: "FileText" },
			{
				title: "工程成果汇总",
				desc: "需要将诊断、方案、设备改造和投资估算统一形成工程文档。",
				icon: "ClipboardCheck",
			},
			{ title: "前期资料盘点", desc: "需要快速判断当前资料是否足够支撑可研编制。", icon: "Search" },
			{ title: "报告版本更新", desc: "方案或专业数据更新后，需要同步更新可研内容。", icon: "RefreshCw" },
		],
		capabilities: [
			{ title: "项目资料归集", desc: "整理项目基础信息、设计资料及各阶段专业成果。" },
			{ title: "报告章节映射", desc: "将已有资料及算法输出匹配到对应可研章节。" },
			{ title: "缺失资料识别", desc: "识别当前报告编制仍缺少的输入资料。" },
			{ title: "章节内容生成", desc: "根据规范及已有依据生成各章节初稿。" },
			{ title: "报告成果整合", desc: "形成结构统一、可继续修改审核的完整可研报告初稿。" },
		],
		requiredMaterials: ["项目基础信息", "改造方案及主要技术成果"],
		recommendedMaterials: [
			"企业及现有装置资料",
			"相关规范及编制要求",
			"设备改造成果",
			"投资估算成果",
			"专业算法输出",
			"用户补充说明",
		],
		tools: [],
		toolEmptyText: "当前专业工具配置待补充。",
		outputs: [
			{ id: "o1", name: "可研报告初稿", desc: "生成结构化、可继续编辑的完整报告。", preview: "report" },
			{ id: "o2", name: "资料缺口清单", desc: "标识仍需要用户补充或确认的资料。", preview: "table" },
			{ id: "o3", name: "章节资料映射", desc: "展示各章节内容来源及依据。", preview: "table" },
			{ id: "o4", name: "项目成果汇总", desc: "汇总诊断、改造、投资等各阶段核心结果。", preview: "report" },
		],
		sampleTask: {
			title: "异戊烯装置扩产改造可研报告生成",
			description:
				"基于项目基础资料、装置诊断结果、改造方案、设备改造成果及投资估算结果，形成装置扩产改造可研报告初稿。",
			preparedMaterials: ["项目基础信息", "装置诊断结果", "改造方案", "设备改造成果", "投资估算结果"],
		},
		relatedSkills: ["investment_estimation", "scheme_generator", "plant_cognition"],
		useMode: "direct",
	},
];

// 根据 id 获取 Skill
export function getSkillById(id) {
	return skills.find((s) => s.id === id);
}

// 根据关键词搜索 Skill（匹配名称、描述、场景标签）
export function searchSkills(keyword) {
	if (!keyword) return skills;
	const t = keyword.toLowerCase();
	return skills.filter((s) => {
		const haystack = [
			s.name,
			s.description,
			s.category,
			s.scope,
			...s.scenarios.map((sc) => `${sc.title} ${sc.desc}`),
		]
			.join(" ")
			.toLowerCase();
		return haystack.includes(t);
	});
}
